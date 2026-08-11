"""AI Chat panel — two modes, both driven by real client data, neither able
to silently fabricate a number.

VERIFIED mode: the model is given 6 tools, each a thin wrapper around an
already-existing deterministic function (optimizer.py, recommendation_matcher.py,
scenario_simulator.py, compliance.py, sector_classification.py, projection.py —
the exact same functions the Dashboard's own cards call). The model can only
state a figure that came back from one of those tool calls; if no tool
answers the question, the system instruction requires it to say so rather
than guess. This is the identical "AI narrates, never invents" split used
throughout the rest of this app (see gemini_client.py) applied to a
conversational, multi-turn tool-calling loop instead of a single narration
call.

EXPLORATORY mode: the model may reason and estimate freely (general market/
industry questions this app has no deterministic tool for), but the FIRST
message after a conversation switches into this mode gets a one-time real
context block injected — the client's actual holdings, live prices,
allocation, scores, and recent recommendations, captured from the same
deterministic pipeline the tools use. Every subsequent exploratory turn
still carries that same captured context (so the model doesn't "forget" it
mid-conversation), and the system instruction requires any number NOT drawn
from that block to be explicitly phrased as an estimate, never as a verified
fact about this client.

Chat history and the flagged-for-report bit are the only state this module
persists (the chat_messages/chat_state tables, see database.py/models.py) —
nothing here is ever read by report generation (routers/reports.py); see
that file's own docstring for the report-generation pipeline, which has no
chat dependency.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Iterator

from database import session_scope
from models import ChatMessage, ChatState
from services import compliance, gemini_client, insights_service, projection, scenario_simulator, sector_classification
from services.holdings import total_quantity

logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 4

# Human-readable labels shown in the UI's "Source: {tool}" pill and
# "Checking {tool}..." indicator — the same label is persisted onto the
# stored assistant message (tools_used) as the single source of truth, so
# the frontend never needs its own copy of this mapping.
TOOL_LABELS: dict[str, str] = {
    "get_analysis": "Portfolio analysis",
    "get_recommendations": "Trade recommendations",
    "run_scenario": "Scenario simulator",
    "get_compliance_flags": "Compliance flags",
    "get_sector_exposure": "Sector exposure",
    "get_projection": "Retirement projection",
}

TOOLS_SPEC: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_analysis",
            "description": (
                "Get this client's current deterministic portfolio analysis: current vs. target allocation, "
                "drift, diversification score, health score, total portfolio value, and total return."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recommendations",
            "description": (
                "Get the deterministic list of currently recommended rebalancing trades (BUY/SELL) for this "
                "client, each with dollar amount and tax detail (long/short-term gain)."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_scenario",
            "description": (
                "Run a deterministic what-if market scenario (e.g. a rate hike, a recession, a tech selloff, a "
                "geopolitical/war shock, a dollar move) against this client's real current holdings and return "
                "the projected dollar/percent impact."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "scenario_query": {
                        "type": "string",
                        "description": (
                            "A short free-text description of the market scenario to test, e.g. "
                            "'a 100 basis point rate hike' or 'a recession'."
                        ),
                    }
                },
                "required": ["scenario_query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_compliance_flags",
            "description": (
                "Get this client's current deterministic, rules-based compliance flags: single-position "
                "concentration and wash-sale risk."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sector_exposure",
            "description": (
                "Get this client's blended sector exposure across direct stock holdings and fund look-through "
                "weights (e.g. how much of the portfolio is Technology, Financials, etc.)."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_projection",
            "description": (
                "Get the Monte Carlo retirement funding projection: current-vs-target growth trajectory and "
                "probability of reaching the goal amount."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]

_VERIFIED_SYSTEM_INSTRUCTION = """You are a portfolio-analysis assistant for a professional wealth advisor, answering questions about ONE specific client's real portfolio.

You have 6 tools available. Each one returns real numbers already computed by deterministic backend code for this exact client — you never calculate, estimate, or invent a number yourself.

Strict rules, no exceptions:
- Call whichever tool(s) are needed to answer the advisor's question. Only state a number, percentage, or dollar figure that came back from a tool result.
- If none of the 6 tools can answer the question (e.g. it's a general market/industry question, or about something outside this client's own portfolio), say plainly that you don't have a verified way to answer that here — do not guess or estimate.
- You may combine or compare numbers that are both already present in tool results, but never introduce a new base figure that wasn't returned by a tool.
- Keep answers concise and advisor-facing: a few sentences, plain language, unless the question calls for a short list.
"""

_EXPLORATORY_SYSTEM_INSTRUCTION = """You are a conversational assistant for a professional wealth advisor in EXPLORATORY mode — open-ended discussion, general market/industry knowledge, and informed estimates, not verified calculations.

A one-time real snapshot of this specific client's actual portfolio may appear earlier in this conversation, marked "[REAL CLIENT CONTEXT — captured ...]". Every number inside that block is a verified real fact about this client and may be stated plainly.

Strict rule, no exceptions: for ANY other number, statistic, or figure you mention that is NOT drawn from that real context block, you MUST explicitly mark it as an estimate or general observation (e.g. "roughly," "as a general market pattern," "this isn't a figure computed from this client's actual holdings") — never phrase it as if it were a verified calculation about this specific client. When in doubt, add the disclaimer.
"""


class ChatMessageNotFoundError(LookupError):
    """Raised when a message id doesn't exist in a client's chat history."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _message_to_dict(row: ChatMessage) -> dict[str, Any]:
    return {
        "id": row.msg_id,
        "role": row.role,
        "mode": row.mode,
        "content": row.content,
        "tools_used": row.tools_used or [],
        "created_at": row.created_at,
        "flagged_for_report": row.flagged_for_report,
        "flagged_at": row.flagged_at,
    }


def _insert_message(client_id: str, message: dict[str, Any]) -> None:
    with session_scope() as session:
        session.add(
            ChatMessage(
                client_id=client_id,
                msg_id=message["id"],
                role=message["role"],
                mode=message["mode"],
                content=message["content"],
                tools_used=message["tools_used"],
                created_at=message["created_at"],
                flagged_for_report=message["flagged_for_report"],
                flagged_at=message["flagged_at"],
            )
        )


def _load_chat_state(client_id: str) -> dict[str, Any]:
    with session_scope() as session:
        state = session.query(ChatState).filter_by(client_id=client_id).one_or_none()
        if state is None:
            return {
                "exploratory_context_injected": False,
                "exploratory_context": None,
                "exploratory_context_captured_at": None,
            }
        return {
            "exploratory_context_injected": state.exploratory_context_injected,
            "exploratory_context": state.exploratory_context,
            "exploratory_context_captured_at": state.exploratory_context_captured_at,
        }


def _save_chat_state(client_id: str, state: dict[str, Any]) -> None:
    with session_scope() as session:
        row = session.query(ChatState).filter_by(client_id=client_id).one_or_none()
        if row is None:
            row = ChatState(client_id=client_id)
            session.add(row)
        row.exploratory_context_injected = state["exploratory_context_injected"]
        row.exploratory_context = state["exploratory_context"]
        row.exploratory_context_captured_at = state["exploratory_context_captured_at"]


def _summarize_text(text: str, max_len: int = 220) -> str:
    """Deterministic truncation for the audit log's ai_output_summary field
    — not a second AI call, same approach as routers/insights.py's own
    _summarize_narrative."""
    stripped = " ".join(text.split())
    period_index = stripped.find(". ")
    if 0 < period_index <= max_len:
        return stripped[: period_index + 1]
    return (stripped[:max_len] + "...") if len(stripped) > max_len else stripped


def load_history(client_id: str) -> dict[str, Any]:
    """Public: GET /clients/{id}/chat-history — only the messages are
    frontend-relevant, the exploratory-context bookkeeping fields are
    internal to this module."""
    with session_scope() as session:
        rows = (
            session.query(ChatMessage)
            .filter_by(client_id=client_id)
            .order_by(ChatMessage.id)
            .all()
        )
        messages = [_message_to_dict(row) for row in rows]
    return {"client_id": client_id, "messages": messages}


def clear_history(client_id: str) -> None:
    """Public: DELETE /clients/{id}/chat-history — resets the conversation
    AND the one-time exploratory-context injection flag, so the next
    exploratory message in a fresh conversation captures a fresh snapshot
    rather than reusing a stale one from before the clear."""
    with session_scope() as session:
        session.query(ChatMessage).filter_by(client_id=client_id).delete()
        state = session.query(ChatState).filter_by(client_id=client_id).one_or_none()
        if state is not None:
            session.delete(state)


def flag_message_for_report(client_id: str, message_id: str) -> dict[str, Any]:
    """Public: POST /clients/{id}/chat/{message_id}/flag-for-report — marks
    a message as advisor-reviewed. This ONLY sets a flag on the stored chat
    message; nothing here writes to, or is read by, report generation (see
    module docstring)."""
    with session_scope() as session:
        row = session.query(ChatMessage).filter_by(client_id=client_id, msg_id=message_id).one_or_none()
        if row is None:
            raise ChatMessageNotFoundError(f"No chat message '{message_id}' for client '{client_id}'.")
        row.flagged_for_report = True
        row.flagged_at = _now_iso()
        session.flush()
        return _message_to_dict(row)


def get_flagged_messages(client_id: str) -> list[dict[str, Any]]:
    """Public: GET /clients/{id}/chat/flagged — every message this advisor
    has flagged, each paired with the question that prompted it (the
    nearest preceding message in the conversation, whichever role it is —
    almost always the user's question, but a failed turn can leave a user
    message with no assistant reply between two others, so this walks
    backward rather than assuming strict alternation).

    This is a pure read of chat data — retrieving this list has nothing to
    do with report generation and never touches it (see module docstring
    and routers/reports.py's own docstring for the actual hard boundary:
    routers/reports.py only ever calls into this module when an advisor has
    explicitly supplied message ids to attach)."""
    with session_scope() as session:
        rows = (
            session.query(ChatMessage)
            .filter_by(client_id=client_id)
            .order_by(ChatMessage.id)
            .all()
        )
        flagged: list[dict[str, Any]] = []
        for i, row in enumerate(rows):
            if not row.flagged_for_report:
                continue
            prompted_by = next((prev.content for prev in reversed(rows[:i]) if prev.role == "user"), None)
            flagged.append(
                {
                    "id": row.msg_id,
                    "content": row.content,
                    "created_at": row.created_at,
                    "flagged_at": row.flagged_at,
                    "prompted_by": prompted_by,
                }
            )
        return flagged


def get_flagged_messages_by_ids(client_id: str, message_ids: list[str]) -> list[dict[str, Any]]:
    """Used only by routers/reports.py, and only when an advisor has
    explicitly supplied message ids to attach to a report. Re-checks
    `flagged_for_report` itself rather than trusting the caller's ids
    blindly — an id that isn't (or is no longer) actually flagged is
    silently skipped, never included, so a report can never end up with a
    note the advisor didn't actually flag. Order follows `message_ids`,
    not conversation order, so the advisor's selection order is preserved."""
    by_id = {m["id"]: m for m in get_flagged_messages(client_id)}
    return [by_id[mid] for mid in message_ids if mid in by_id]


def _build_tool_fns(base: dict[str, Any]) -> dict[str, Callable[..., Any]]:
    """One thin wrapper per tool, closing over `base` (this turn's already-
    computed deterministic analysis — see insights_service.compute_deterministic_analysis)
    so every tool is real arithmetic over this client's real holdings/live
    prices, computed once per chat turn and shared across however many tools
    the model decides to call in that turn."""
    holdings = base["holdings"]
    prices = base["prices"]
    client = base["client"]
    analysis = base["analysis"]
    recommendations = base["recommendations"]

    def get_analysis() -> dict[str, Any]:
        return analysis

    def get_recommendations() -> dict[str, Any]:
        return {"recommendations": recommendations}

    def get_compliance_flags() -> dict[str, Any]:
        flags = compliance.compute_compliance_flags(
            holdings=holdings,
            position_values=analysis["position_values"],
            total_value=analysis["total_portfolio_value"],
            recommendations=recommendations,
        )
        return {"flags": flags}

    def get_sector_exposure() -> dict[str, Any]:
        return sector_classification.compute_sector_exposure(
            holdings=holdings, prices=prices, cash_balance=client.get("cash_balance", 0.0)
        )

    def get_projection() -> dict[str, Any]:
        return projection.run_monte_carlo_projection(
            total_portfolio_value=analysis["total_portfolio_value"],
            current_allocation=analysis["current_allocation"],
            target_allocation=analysis["target_allocation"],
            annual_contribution=client.get("annual_contribution", 0.0),
            goal_year=client["goal_year"],
            goal_amount=projection.resolve_goal_amount(client),
        )

    def run_scenario(scenario_query: str) -> dict[str, Any]:
        scenario_id = scenario_simulator.resolve_scenario_with_ai_fallback(scenario_query)
        return scenario_simulator.simulate_scenario(
            scenario_input=scenario_id,
            holdings=holdings,
            cash_balance=client.get("cash_balance", 0.0),
            prices=prices,
        )

    return {
        "get_analysis": get_analysis,
        "get_recommendations": get_recommendations,
        "get_compliance_flags": get_compliance_flags,
        "get_sector_exposure": get_sector_exposure,
        "get_projection": get_projection,
        "run_scenario": run_scenario,
    }


def _history_as_groq_messages(history_messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [{"role": m["role"], "content": m["content"]} for m in history_messages if m["role"] in ("user", "assistant")]


def _run_verified_turn_stream(client_id: str, history_messages: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    """Yields {'type': 'tool_call'|'tool_result', ...} progress events, then
    exactly one final {'type': 'assistant_result', 'content', 'tools_used'}
    event. `history_messages` already includes the just-appended user
    message as its last entry.

    Raises gemini_client.GeminiError on a Groq failure, ValueError if the
    client has no holdings/live prices (compute_deterministic_analysis) —
    both caught by the caller and turned into an 'error' stream event.
    """
    base = insights_service.compute_deterministic_analysis(client_id)
    tool_fns = _build_tool_fns(base)

    groq_client = gemini_client.get_groq_client()
    groq_messages: list[dict[str, Any]] = [{"role": "system", "content": _VERIFIED_SYSTEM_INSTRUCTION}]
    groq_messages.extend(_history_as_groq_messages(history_messages))

    tools_used_labels: list[str] = []
    # llama-3.3-70b-versatile occasionally re-issues the SAME tool call
    # (identical name+arguments) instead of synthesizing a final answer from
    # a result it already has — a real, observed model quirk, not a bug in
    # the loop above it. called_tool_keys tracks every (name, arguments)
    # pair already executed this turn; once a repeat is seen, the NEXT
    # completion call omits `tools` entirely so the model is forced to
    # answer from what it already has instead of looping again.
    called_tool_keys: set[str] = set()
    force_finalize = False

    for _ in range(MAX_TOOL_ITERATIONS):
        create_kwargs: dict[str, Any] = {
            "model": gemini_client.MODEL_NAME,
            "messages": groq_messages,
            "temperature": 0.2,
        }
        if not force_finalize:
            create_kwargs["tools"] = TOOLS_SPEC
            create_kwargs["tool_choice"] = "auto"
        response = groq_client.chat.completions.create(**create_kwargs)
        message = response.choices[0].message

        if not message.tool_calls:
            content = message.content or "I don't have a verified way to answer that from the available tools."
            yield {"type": "assistant_result", "content": content, "tools_used": tools_used_labels}
            return

        groq_messages.append(
            {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in message.tool_calls
                ],
            }
        )

        for tool_call in message.tool_calls:
            tool_name = tool_call.function.name
            label = TOOL_LABELS.get(tool_name, tool_name)
            yield {"type": "tool_call", "tool": tool_name, "tool_label": label}

            repeat_key = f"{tool_name}:{tool_call.function.arguments}"
            if repeat_key in called_tool_keys:
                force_finalize = True
            called_tool_keys.add(repeat_key)

            try:
                args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            # Groq (like some OpenAI-compatible models) sometimes returns the
            # literal string "null" — not "{}" — for a tool with no
            # parameters, which json.loads happily turns into Python None
            # rather than raising. fn(**None) would then blow up on every
            # zero-argument tool, so this coerces anything that isn't
            # actually a dict of kwargs back to an empty one.
            if not isinstance(args, dict):
                args = {}

            fn = tool_fns.get(tool_name)
            if fn is None:
                result: dict[str, Any] = {"error": f"Unknown tool '{tool_name}'."}
            else:
                try:
                    result = fn(**args)
                except Exception as exc:  # noqa: BLE001 - a tool failure becomes a visible error the model can relay, not a crash
                    result = {"error": str(exc)}

            tools_used_labels.append(label)
            yield {"type": "tool_result", "tool": tool_name, "tool_label": label}

            groq_messages.append(
                {"role": "tool", "tool_call_id": tool_call.id, "content": json.dumps(result, default=str)}
            )

    yield {
        "type": "assistant_result",
        "content": "I wasn't able to settle on a verified answer using the available tools — try rephrasing or ask something more specific about this client's portfolio.",
        "tools_used": tools_used_labels,
    }


def _build_exploratory_context_block(client_id: str) -> str:
    base = insights_service.compute_deterministic_analysis(client_id)
    holdings_summary = [
        {"ticker": h["ticker"], "account_type": h["account_type"], "quantity": round(total_quantity(h), 4)}
        for h in base["holdings"]
    ]
    # Same shared function every other consumer of the retirement goal
    # amount routes through (see projection.resolve_goal_amount's docstring)
    # — Exploratory mode gets the real advisor-provided figure (or the
    # existing derived estimate) in its one-time context, not a separate
    # guess, and goal_amount_source tells the model which case it is so it
    # never phrases an estimate as if it were verified.
    monte_carlo = projection.run_monte_carlo_projection(
        total_portfolio_value=base["analysis"]["total_portfolio_value"],
        current_allocation=base["analysis"]["current_allocation"],
        target_allocation=base["analysis"]["target_allocation"],
        annual_contribution=base["client"].get("annual_contribution", 0.0),
        goal_year=base["client"]["goal_year"],
        goal_amount=projection.resolve_goal_amount(base["client"]),
    )
    context = {
        "client_name": base["client"]["name"],
        "as_of": base["fetched_at"],
        "holdings": holdings_summary,
        "live_prices": base["prices"],
        "cash_balance": base["client"].get("cash_balance", 0.0),
        "current_allocation": base["analysis"]["current_allocation"],
        "target_allocation": base["analysis"]["target_allocation"],
        "diversification_score": base["analysis"]["diversification_score"],
        "health_score": base["analysis"]["health_score"],
        "total_portfolio_value": base["analysis"]["total_portfolio_value"],
        "retirement_goal_amount": monte_carlo["goal_amount"],
        "retirement_goal_amount_source": monte_carlo["goal_amount_source"],
        "probability_of_reaching_goal_at_target_allocation": monte_carlo["probability_of_reaching_goal"],
        "recent_recommendations": base["recommendations"],
    }
    return json.dumps(context, indent=2, default=str)


def _run_exploratory_turn(client_id: str, chat_state: dict[str, Any], history_messages: list[dict[str, Any]]) -> str:
    """Injects the one-time real context block into `chat_state` (mutated in
    place) if this conversation hasn't captured one yet, then runs a single
    free-form Groq completion — no tool-calling loop, per the module
    docstring's Exploratory-mode design. The caller persists `chat_state`
    only after this returns successfully (see stream_chat_turn) — if the
    Groq call below fails, the injection captured here is deliberately
    discarded so the next attempt captures a fresh snapshot instead of
    reusing one that was never actually used in a real reply."""
    if not chat_state.get("exploratory_context_injected"):
        chat_state["exploratory_context"] = _build_exploratory_context_block(client_id)
        chat_state["exploratory_context_captured_at"] = _now_iso()
        chat_state["exploratory_context_injected"] = True

    groq_client = gemini_client.get_groq_client()
    groq_messages: list[dict[str, Any]] = [{"role": "system", "content": _EXPLORATORY_SYSTEM_INSTRUCTION}]
    if chat_state.get("exploratory_context"):
        groq_messages.append(
            {
                "role": "system",
                "content": (
                    f"[REAL CLIENT CONTEXT — captured {chat_state['exploratory_context_captured_at']}]\n"
                    f"{chat_state['exploratory_context']}"
                ),
            }
        )
    groq_messages.extend(_history_as_groq_messages(history_messages))

    response = groq_client.chat.completions.create(model=gemini_client.MODEL_NAME, messages=groq_messages)
    return response.choices[0].message.content or "I don't have anything to add on that."


def stream_chat_turn(client_id: str, message: str, mode: str) -> Iterator[str]:
    """Public: the generator POST /clients/{id}/chat streams as
    newline-delimited JSON. Persists the user message immediately (so it
    survives even if the assistant call then fails), and — only on success —
    persists the assistant reply and appends one audit-log entry, the same
    "every AI turn is logged" discipline routers/insights.py already applies
    to POST /clients/{id}/insights."""
    from services import audit_log  # local import: audit_log has no other reason to load unless chat is actually used

    existing_messages = load_history(client_id)["messages"]
    next_seq = len(existing_messages) + 1

    user_message = {
        "id": f"msg-{next_seq:04d}",
        "role": "user",
        "mode": mode,
        "content": message,
        "tools_used": [],
        "created_at": _now_iso(),
        "flagged_for_report": False,
        "flagged_at": None,
    }
    next_seq += 1
    _insert_message(client_id, user_message)
    yield json.dumps({"type": "user_message", "message": user_message}) + "\n"

    turn_messages = existing_messages + [user_message]

    try:
        if mode == "verified":
            tools_used: list[str] = []
            content = ""
            for event in _run_verified_turn_stream(client_id, turn_messages):
                if event["type"] == "assistant_result":
                    content = event["content"]
                    tools_used = event["tools_used"]
                else:
                    yield json.dumps(event) + "\n"
        else:
            chat_state = _load_chat_state(client_id)
            content = _run_exploratory_turn(client_id, chat_state, turn_messages)
            _save_chat_state(client_id, chat_state)
            tools_used = []
    except Exception as exc:  # noqa: BLE001 - any failure here (Groq error, no holdings, etc.) becomes a visible chat error, never a fabricated reply
        logger.warning("Chat turn failed for %s (mode=%s): %s", client_id, mode, exc)
        yield json.dumps({"type": "error", "detail": str(exc)}) + "\n"
        return

    assistant_message = {
        "id": f"msg-{next_seq:04d}",
        "role": "assistant",
        "mode": mode,
        "content": content,
        "tools_used": tools_used,
        "created_at": _now_iso(),
        "flagged_for_report": False,
        "flagged_at": None,
    }
    _insert_message(client_id, assistant_message)

    audit_log.append_entry(
        client_id=client_id,
        action="chat_turn",
        inputs_used={"mode": mode, "user_message_id": user_message["id"]},
        deterministic_outputs={"tools_used": tools_used},
        ai_output_summary=_summarize_text(content),
    )

    yield json.dumps({"type": "final", "message": assistant_message}) + "\n"
