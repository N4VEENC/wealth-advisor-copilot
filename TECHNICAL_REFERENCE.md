# Wealth Advisor Copilot — Complete Technical Reference

*Verified against the live codebase on 2026-08-19. Every claim below was checked directly against source files as they exist right now — not recalled from memory of earlier work — and the measurements in Section 9 are real, wrapped-in-a-timer numbers from an actual running instance, not estimates.*

---

## 1. Tech Stack

### Backend (Python 3.11)

| Package | Purpose |
|---|---|
| `fastapi` | Web framework — every router/endpoint in `backend/routers/` |
| `uvicorn` | ASGI server that runs the FastAPI app |
| `sqlalchemy` | ORM — all persistence (`backend/models.py`, `database.py`) |
| `alembic` | Database schema migrations (`backend/alembic/`) |
| `pandas` | Excel/CSV holdings-file parsing (`excel_parser.py`) |
| `openpyxl` | `.xlsx` file reading (pandas' Excel engine) |
| `numpy` | Portfolio math, Monte Carlo random draws (`optimizer.py`, `projection.py`) |
| `scipy` | Statistical helpers used in projection/optimizer math |
| `yfinance` | Fallback live market-data source (no API key needed) |
| `requests` | HTTP calls to Finnhub and the currency-rate APIs |
| `groq` | Official Groq SDK — the sole AI-narration provider |
| `python-dotenv` | Loads `backend/.env` at startup |
| `python-multipart` | Multipart form parsing for file uploads |
| `pydantic` | Request/response validation for FastAPI |
| `httpx` / `httpcore` / `h11` | HTTP client stack (used by `groq`, `requests`, `uvicorn`) |
| `cryptography` | TLS support dependency |
| `watchfiles` | File-watching for `uvicorn --reload` |
| `websockets` | WebSocket protocol support (uvicorn dependency, not used by app routes directly) |
| `peewee` | Present in requirements but not used by any current backend module (legacy/orphaned dependency) |

### Frontend (React 19 + TypeScript, Vite)

| Package | Purpose |
|---|---|
| `react` / `react-dom` | UI framework, v19 |
| `react-router-dom` | Client-side routing (v7) |
| `vite` | Dev server and build tool (v8) |
| `typescript` | Type-checking (`tsc -b` as part of the build) |
| `@vitejs/plugin-react` | Vite's React integration |
| `tailwindcss` + `@tailwindcss/vite` | Utility-first CSS, v4 (CSS-based `@theme` config, no JS config file) |
| `tailwind-merge` / `clsx` / `class-variance-authority` | Class-name composition utilities used throughout components |
| `radix-ui` | Headless accessible UI primitives (shadcn/ui is built on this) |
| `shadcn` | Component-generation CLI (components copied into `frontend/src/components/ui/`, not a runtime dependency) |
| `lucide-react` | Icon set |
| `tw-animate-css` | Tailwind-compatible animation utility classes |
| `@fontsource-variable/ibm-plex-sans` | UI/body font |
| `@fontsource/ibm-plex-mono` | Numeric/ticker/tabular font (400 + 500 weights only) |
| `@fontsource-variable/fraunces` | Serif font, used only in the client-facing report view |
| `@fontsource-variable/geist` | **Installed but unused** — zero references anywhere in `frontend/src` (confirmed by grep); an orphaned dependency, not part of the active design system |
| `oxlint` | Linter |

---

## 2. Goal and Problem Statement

In plain terms: this app solves the problem of a solo financial advisor spending hours manually assembling a client portfolio review — pulling current holdings, checking allocation drift against a target, running "what if the market drops" scenarios, checking for basic compliance issues, projecting retirement funding odds, and writing it all up into a document the client can read — by doing every deterministic piece of that automatically from real data, and using an AI model only to turn already-computed numbers into readable prose.

It's built for **one advisor, managing a handful of real (or realistic-demo) clients, running entirely on their own laptop** — there's no multi-user login, no hosted backend, no real custodian integration. The explicit non-goal, stated throughout the codebase's own docstrings and enforced in the AI's system prompts, is that the AI is never trusted to produce a number a client might act on — every dollar figure, percentage, and score comes from plain arithmetic in `backend/services/`, and the AI's only role is explaining what that arithmetic already produced.

---

## 3. Full Data Flow, Excel to PDF

In order, with exact function names and file citations:

1. **Upload** — `POST /clients/{id}/holdings/upload` (`backend/routers/clients.py:178`, `upload_holdings`). Reads the raw file bytes, calls `excel_parser.parse_holdings_file(io.BytesIO(raw_bytes), safe_filename)`.

2. **Parse** — `backend/services/excel_parser.py`, `parse_holdings_file()` (line 118). Column headers are matched through `_COLUMN_ALIASES` (ticker/quantity/cost_basis_per_share/account_type/purchase_date, each with several accepted spellings — e.g. `"Symbol"`, `"Qty"`, `"Cost Basis"`), and account-type values through `_ACCOUNT_TYPE_ALIASES` (`"401(k)"` → `401k`, `"Roth IRA"` → `roth_ira`, etc.). Returns a plain Python list of holding dicts, each with a single-lot `lots` list (a typical brokerage export gives one blended quantity/cost-basis per ticker, not per-tax-lot detail).

3. **Original file retained** — the raw uploaded bytes are saved to `backend/data/clients/{client_id}/uploads/{filename}` (`clients.py:202-205`), independent of the SQLite migration, so the sidebar's "Data source" link can re-serve the exact original file.

4. **SQLite storage** — `client["holdings"] = holdings; save_client(client_id, client)` (`clients.py:207-211`). `save_client()` (`backend/services/client_store.py:99`) does a full-replace: deletes every existing `HoldingLot` row for the client and reinserts one row per lot (`client_store.py:139-144`). The live database is a single SQLite file at `%LOCALAPPDATA%\WealthAdvisorCopilot\wealth_advisor.db` (see Section 6 below for why).

5. **Dashboard calculation** — when the Dashboard loads, `GET /clients/{id}/analysis` triggers `optimizer.analyze_portfolio(holdings, cash_balance, prices, target_allocation, cash_account_type)` (`backend/services/optimizer.py:54`) — pure arithmetic, returns current/target allocation, drift, diversification score, health score, total value, position values, cost basis, returns. See Section 10 for every formula.

6. **Report generation** — `POST /clients/{id}/reports` (`backend/routers/reports.py:58`, `generate_report`), in order:
   - `compute_deterministic_analysis(client_id)` — loads client, fetches live prices, runs the optimizer and `recommendation_matcher.generate_recommendations`.
   - `projection.run_monte_carlo_projection(...)` — the retirement funding projection.
   - `compliance.compute_compliance_flags(...)` — minus the standing disclosure flags (the report has its own disclosures section).
   - **Two concurrent Groq calls** via `ThreadPoolExecutor(max_workers=2)`: `groq_client.generate_narrative(...)` and `groq_client.narrate_compliance_flags(...)` — measured real concurrency evidence in Section 9.
   - If the narrative call fails, the whole request hard-fails with 503 (unlike the Dashboard, which tolerates a missing narrative).
   - Optional advisor notes attached only if `flagged_message_ids` was explicitly supplied (see Section 7).
   - Report saved with `"status": "draft"`, `"approved_at": None`.

7. **Approval** — `PATCH /reports/{id}/approve` (`reports.py:235`) — sets `status = "approved"` and `approved_at` to the current timestamp. This is the human-in-the-loop gate; nothing is "final" before this.

8. **PDF export** — `frontend/src/pages/report-view-page.tsx`, the "Download PDF" button calls `window.print()` directly (line ~562). There is no PDF-generation library anywhere (no jsPDF, no html2canvas, no server-side render) — it is the browser's own native "Save as PDF" print pipeline, styled via `print:` Tailwind variants and a dedicated `.report-paper` CSS block that forces a pure-white, always-light theme regardless of the app's current light/dark setting.

---

## 4. Target Allocation Mechanism

**Confirmed: `target_allocation` is never AI-generated and never derived from a client's own current holdings. It is always a fixed lookup from the `strategies` table, keyed only by the client's `risk_profile` string, set once at client creation.**

- `backend/services/client_store.py:202`, `load_strategy_for_risk_profile(risk_profile)` — an exact-match query: `session.query(Strategy).filter_by(id=risk_profile).one_or_none()`. The `Strategy.id` primary key literally *is* the risk-profile string (`conservative`, `balanced`, `moderate-growth`, `aggressive-growth`, `esg-tilted`).
- `backend/routers/clients.py:113,128` (`create_client`): `strategy = load_strategy_for_risk_profile(payload.risk_profile)`, then `"target_allocation": strategy["target_allocation"]` is baked into the new client row. The endpoint's own docstring states it plainly: *"there's no more honest default than 'whatever this risk profile's strategy targets'."*
- No endpoint anywhere in `backend/routers/` recomputes `target_allocation` from holdings. `upload_holdings` only touches `holdings`/`holdings_source`/`original_filename`; there is no "rebalance my target" or "recompute allocation" mutation anywhere.
- `groq_client.py` never appears in the full grep for `target_allocation` — no AI code path reads or writes this field at all.
- Every consumer (`optimizer.analyze_portfolio`, `recommendation_matcher.generate_recommendations`, `projection.run_monte_carlo_projection`, every AI Chat tool) receives it as a pure input parameter it never derives internally.

---

## 5. Retirement Goal Amount Mechanism

**`backend/services/projection.py:70`, `resolve_goal_amount(client)`** — the single source of truth:

```python
def resolve_goal_amount(client: dict[str, Any]) -> float | None:
    """The single source of truth for whether a client has a REAL,
    advisor-provided retirement goal dollar amount. Every caller of
    run_monte_carlo_projection ... must resolve `goal_amount` through
    this function rather than reading `target_retirement_amount` off
    the client record itself — so a real value is never silently
    ignored, and none of those callers can drift out of sync on what
    counts as "set."
    """
    return client.get("target_retirement_amount")
```

**When present:** the advisor-entered `target_retirement_amount` is used as-is, and `goal_amount_source = "advisor_provided"`.

**When absent (the fallback formula), `projection.py:158-166`:**

```python
deterministic_target_rate = sum(
    target_allocation.get(asset_class, 0.0) * mean
    for asset_class, (mean, _stdev) in ASSUMED_RETURN_DISTRIBUTION.items()
)
deterministic_value = total_portfolio_value
for _ in range(n_years):
    deterministic_value = deterministic_value * (1 + deterministic_target_rate) + annual_contribution
goal_amount = deterministic_value
```

In plain language: take the client's *target* allocation, blend it against the assumed mean returns per asset class (7% equities / 3% fixed income / 1% cash), and compound the current portfolio value forward at that single blended rate for every year until the goal year, adding the annual contribution each year. `goal_amount_source = "estimated"` in this case.

**Every confirmed consumer, all funneling through this one function — no divergence found anywhere:**
1. Dashboard's `GET /clients/{id}/projection` — `backend/routers/portfolio.py:186`
2. Report generation — `backend/routers/reports.py:82`
3. AI Chat's `get_projection` tool — `backend/services/chat_service.py:368`
4. AI Chat's Exploratory-mode one-time context block — `backend/services/chat_service.py:518`

A full grep for the raw `target_retirement_amount` field outside `resolve_goal_amount` turns up only its legitimate CRUD path (the `ClientCreate` request field, and `client_store.py`'s read/write of the stored value) — never a second, competing read for Monte Carlo purposes.

---

## 6. Client ID Generation and Lifecycle

### ID generation
- `backend/services/client_store.py:147`, `create_client()`: allocates the id from `AppMeta` (a tiny key/value table, `backend/models.py:172`), key `"next_client_number"` — a **monotonically incrementing persistent counter**, not `MAX(id)+1` and not derived from row count.
  ```python
  meta = session.query(AppMeta).filter_by(key="next_client_number").one()
  number = int(meta.value)
  meta.value = str(number + 1)
  client_id = f"WAC-{number:04d}"
  ```
  The counter increment and the client insert happen in the same transaction, so the counter only actually advances if the insert succeeds.

- **Live-tested tonight, not just inferred from code:** with the counter at 135, I created a throwaway client via the real API → got `WAC-0135`. Deleted it. Created a second throwaway client → got `WAC-0136`, **not** a reused `WAC-0135`. Both throwaway clients were then deleted, leaving the app's real client list untouched. This empirically confirms deleted IDs are never reissued, exactly as the code's own separate, never-decremented counter implies.

### Delete behavior
`DELETE /clients/{id}` (`backend/routers/clients.py:139`, `delete_client`):
- **Default:** returns `409` if the client has any reports (`"Cannot delete '{id}': {n} report(s) still reference this client."`) — a deliberate refuse-don't-guess default, since the app has no general cascading-delete story for compliance data.
- **`force=true` override:** first deletes the client's own reports (`delete_report(report["id"])` for each), then deletes the `Client` row itself — whose deletion then cascades at the real database foreign-key level.

**Exact cascade behavior, from `backend/models.py`:**
- `holdings_lots`, `reports`, `chat_messages`, `chat_state` all use `ForeignKey("clients.id", ondelete="CASCADE")` **and** `relationship(..., cascade="all, delete-orphan", passive_deletes=True)` — real database-level cascading deletes (SQLite's `foreign_keys` pragma is explicitly turned on in `database.py`).
- `audit_log` (`AuditLogEntry.client_id`) is **deliberately a plain indexed string, not a ForeignKey** — per the model's own docstring: *"the compliance audit trail must survive a client being deleted (real historical data already contains entries for a client no longer in the clients table), so it's never part of the cascade."*

### New client creation — every table touched, in order
`create_client()` (`client_store.py:147`) touches exactly **two** tables in one transaction:
1. `app_meta` — the counter row is read and incremented.
2. `clients` — the new row is inserted.

No `holdings_lots`, `reports`, `chat_messages`, or `chat_state` rows are created at this point — a brand-new client genuinely has none of those until, respectively: holdings are uploaded/entered, a report is generated, or a chat turn happens.

---

## 7. AI Chat — Full Mechanism, Both Modes

### Verified mode

**6 tools** (`backend/services/chat_service.py:61`, `TOOLS_SPEC`), each a thin wrapper around an already-existing deterministic function:

| Tool name | UI label | Wraps |
|---|---|---|
| `get_analysis` | Portfolio analysis | `optimizer.analyze_portfolio` result |
| `get_recommendations` | Trade recommendations | `recommendation_matcher.generate_recommendations` result |
| `run_scenario` | Scenario simulator | `scenario_simulator.resolve_scenario_with_ai_fallback` + `simulate_scenario` |
| `get_compliance_flags` | Compliance flags | `compliance.compute_compliance_flags` result |
| `get_sector_exposure` | Sector exposure | `sector_classification.compute_sector_exposure` result |
| `get_projection` | Retirement projection | `projection.run_monte_carlo_projection` (via `resolve_goal_amount`) |

**The loop** (`_run_verified_turn_stream`, `chat_service.py:394`), up to `MAX_TOOL_ITERATIONS = 4` iterations:
1. Calls Groq with the system instruction, full conversation history, and `tools=TOOLS_SPEC, tool_choice="auto"`.
2. If the model answers with plain text (no tool calls) → done, that's the final answer.
3. If it requests tool call(s): each is dispatched to a real Python closure (`fn(**args)`), the JSON result is appended to the conversation as a `role: "tool"` message keyed to `tool_call_id`, and the loop repeats — the model sees the real tool result on its next turn.
4. A repeat-call guard: if the model calls the *exact same* tool+arguments twice in one turn, `force_finalize = True` strips the `tools` param from the next call, forcing a text answer from what it already has (guards against a real observed model quirk of re-issuing identical calls instead of concluding).
5. If all 4 iterations pass without a plain-text answer, a fixed give-up message is returned: *"I wasn't able to settle on a verified answer using the available tools — try rephrasing or ask something more specific about this client's portfolio."*

**System instruction (`_VERIFIED_SYSTEM_INSTRUCTION`, verbatim):**
> You are a portfolio-analysis assistant for a professional wealth advisor, answering questions about ONE specific client's real portfolio.
>
> You have 6 tools available. Each one returns real numbers already computed by deterministic backend code for this exact client — you never calculate, estimate, or invent a number yourself.
>
> Strict rules, no exceptions:
> - Call whichever tool(s) are needed to answer the advisor's question. Only state a number, percentage, or dollar figure that came back from a tool result.
> - If none of the 6 tools can answer the question (e.g. it's a general market/industry question, or about something outside this client's own portfolio), say plainly that you don't have a verified way to answer that here — do not guess or estimate.
> - You may combine or compare numbers that are both already present in tool results, but never introduce a new base figure that wasn't returned by a tool.
> - Keep answers concise and advisor-facing: a few sentences, plain language, unless the question calls for a short list.

### Exploratory mode

**One-time context injection** (`_build_exploratory_context_block`, `chat_service.py:500`): the *first* message after switching into Exploratory mode for a conversation triggers a real, fresh `compute_deterministic_analysis()` call and a real Monte Carlo projection, packaged into a JSON block containing: `client_name`, `as_of`, `holdings` (ticker/account/quantity), `live_prices`, `cash_balance`, `current_allocation`, `target_allocation`, `diversification_score`, `health_score`, `total_portfolio_value`, `retirement_goal_amount`, `retirement_goal_amount_source`, `probability_of_reaching_goal_at_target_allocation`, `recent_recommendations`.

This is gated by `chat_state["exploratory_context_injected"]` (persisted in the `ChatState` table, one row per client) — set `True` only after a successful capture, so it fires **exactly once per conversation**. Every subsequent Exploratory turn reuses the frozen `exploratory_context` string and its `exploratory_context_captured_at` timestamp, re-injected verbatim as a system message — never re-fetched. If the AI call itself fails, the capture is discarded (never persisted), so the next attempt gets a fresh snapshot rather than reusing one that was never actually delivered.

**System instruction (`_EXPLORATORY_SYSTEM_INSTRUCTION`, verbatim):**
> You are a conversational assistant for a professional wealth advisor in EXPLORATORY mode — open-ended discussion, general market/industry knowledge, and informed estimates, not verified calculations.
>
> A one-time real snapshot of this specific client's actual portfolio may appear earlier in this conversation, marked "[REAL CLIENT CONTEXT — captured ...]". Every number inside that block is a verified real fact about this client and may be stated plainly.
>
> Strict rule, no exceptions: for ANY other number, statistic, or figure you mention that is NOT drawn from that real context block, you MUST explicitly mark it as an estimate or general observation (e.g. "roughly," "as a general market pattern," "this isn't a figure computed from this client's actual holdings") — never phrase it as if it were a verified calculation about this specific client. When in doubt, add the disclaimer.

### Flag for report reference — confirmed fully opt-in, never automatic

- Flagging (`POST /clients/{id}/chat/{message_id}/flag-for-report`) only sets a boolean + timestamp on a stored chat message. It has zero connection to report generation — confirmed by the module docstring: *"This ONLY sets a flag on the stored chat message; nothing here writes to, or is read by, report generation."*
- `routers/reports.py`'s own module docstring states the boundary explicitly: *"Chat independence: generate_report() takes an OPTIONAL `flagged_message_ids` list. Left empty (the default...), this function's code path never imports or calls into services/chat_service... `services.chat_service` is only ever imported below, inside the `if flagged_message_ids:` branch, specifically so that omission is enforced by the code structure, not just by convention."*
- The `from services import chat_service` import line is textually inside the `if flagged_message_ids:` block — a report generated with no notes attached never even imports the chat module.
- Attaching a note fires its own audit-log entry, `"report_advisor_notes_attached"` — the one exception to ordinary report generation writing nothing to the audit log, because "an advisor chose to attach unverified AI estimates to a client-facing document, and that choice itself belongs in the compliance trail" (code comment, `reports.py:198-204`).

### Current AI model

`backend/services/groq_client.py:83`: **`MODEL_NAME = "openai/gpt-oss-120b"`**. The preceding comment documents the swap: `llama-3.3-70b-versatile` (used until 2026-08-19) was fully retired by Groq — confirmed via a live 404 `model_not_found` from this app's real key, and its absence from a live `GET /openai/v1/models` listing. The replacement was tested for all three capabilities this app needs (plain narration, JSON-object mode, tool-calling) before being adopted. It's a reasoning model — responses carry a separate `reasoning` field alongside `content`; the app only ever reads `.content`, so the reasoning trace never leaks into narration text.

---

## 8. Architecture Principle — AI Never Invents a Number

**Module docstring, `backend/services/groq_client.py:1-12`:**
> Hard constraint (TRD/PRD): the model must never generate, calculate, or invent any financial number. Every figure in its output must trace back to a value already present in the structured data passed into `generate_narrative()`... This module only builds a prompt around that data and returns the model's plain-language narrative — it never asks it to "estimate," "calculate," or "project" anything itself.

**Every one of the four system instructions, quoted in full:**

`_SYSTEM_INSTRUCTION` (for `generate_narrative`):
> You are a financial-analysis narration assistant for a professional wealth advisor.
>
> You will be given a JSON object containing portfolio analysis numbers and trade recommendations, and optionally a scenario projection. Every figure in it was already calculated by deterministic backend code, not by you. Your only job is to explain these exact numbers in clear, plain language for a financial advisor to read.
>
> Strict rules, no exceptions:
> - Never calculate, estimate, infer, or invent any number that is not already present in the JSON data given to you — no percentages, dollar amounts, scores, share counts, or dates.
> - Never perform arithmetic on the given numbers to produce a new figure (do not add, subtract, average, or project anything yourself) — only reference numbers exactly as given in the data, rounded for readability if you like, but never changed or fabricated.
> - Never recommend a trade, action, or number that is not already present in the data.
> - Structure your narrative as short paragraphs covering, in order: (1) overall diversification and health summary, (2) allocation drift explanation, (3) the specific trade recommendations and why (referencing their notes), and (4) scenario impact, only if scenario data is provided in the input.
> - Plain language, minimal jargon (briefly explain any technical term you use), appropriate for an advisor to read quickly or relay to a client.

`_STRUCTURED_SYSTEM_INSTRUCTION` (for `generate_structured_insights`, the Dashboard's "Cards" view):
> You are a financial-analysis narration assistant for a professional wealth advisor.
>
> You will be given a JSON array of "facts". Each fact has an id, a kind, and a "numbers" object — every number in it was already calculated by deterministic backend code, not by you. Your only job is to write a short title and a one-to-two-sentence description for EACH fact, using only the numbers already present in that fact's own "numbers" object.
>
> Strict rules, no exceptions:
> - Return ONLY a JSON object shaped exactly {"results": [{"id": "<same id as the input fact>", "title": "<title>", "description": "<description>"}, ...]} — one array entry per input fact, no other top-level fields, no markdown fences.
> - title: 8 words or fewer, no trailing period.
> - description: plain language, 1-2 sentences, minimal jargon.
> - Never invent, estimate, or infer ANY number, percentage, or dollar figure not already present in that fact's "numbers" object — including a confidence score, since none is computed anywhere in this system.
> - Never invent a date, ticker, account, or recommendation not already present in the input.
> - Never perform arithmetic to produce a new figure — reference the given numbers as-is (rounded for readability if you like, but not changed).
> - One results entry per input fact, in the same order, matched by id.

`_SCENARIO_CLASSIFIER_SYSTEM_INSTRUCTION` (for `classify_scenario`):
> You are a strict classifier for a financial-scenario library.
>
> You will be given an advisor's free-text question and a fixed list of existing scenario ids with their labels. Every one of those scenarios already has its own deterministic, pre-computed shock model — you are not calculating or narrating anything here.
>
> Strict rules, no exceptions:
> - Output ONLY one existing id from the given list, exactly as written, OR the literal text "no_match" if genuinely nothing in the list fits.
> - Never invent a new scenario id that isn't in the given list.
> - Never output a magnitude, percentage, dollar amount, or any other number.
> - Never output an explanation, punctuation, or any text beyond the single id (or "no_match").

`_COMPLIANCE_NARRATION_SYSTEM_INSTRUCTION` (for `narrate_compliance_flags`):
> You are a plain-language compliance-flag narrator for a professional wealth advisor.
>
> You will be given a JSON array of real compliance flags. Every flag was already raised by a deterministic, rules-based check — you did not decide that any of them apply, and you never add or remove a flag. Each flag has an id, a category, and a "message" that already states the real numbers behind it (percentages, dollar amounts, day counts). Your only job is to write a short, clear explanation of EACH flag for an advisor to read, using only the numbers already present in that flag's own "message".
>
> Strict rules, no exceptions:
> - Return ONLY a JSON object shaped exactly {"results": [{"id": "<same id as the input flag>", "narrative": "<explanation>"}, ...]} — one array entry per input flag, no other top-level fields, no markdown fences.
> - narrative: 1-2 plain-language sentences, minimal jargon (briefly explain any technical term you use).
> - Never invent, estimate, or infer ANY number, percentage, dollar amount, or date not already present in that flag's own "message".
> - Never invent a new compliance flag, ticker, category, or recommendation not already given.
> - Never soften, dismiss, or add legal/financial advice beyond explaining what the flag's own numbers already mean.
> - One results entry per input flag, in the same order, matched by id.

---

## 9. Real Measured API/Token/Timing Data

**Methodology:** temporary logging was added directly to `groq_client.py`'s `_chat()` and `chat_service.py`'s two direct Groq call sites, wrapping each real call with `time.perf_counter()` and logging Groq's own returned `usage` object (which every Groq response includes: `prompt_tokens`, `completion_tokens`, `total_tokens`, plus Groq's own internal `queue_time`/`prompt_time`/`completion_time`/`total_time` breakdown). The backend was then hit live, via real HTTP requests, for client **WAC-0131 (Elena, 10 holdings)**. All instrumentation was fully reverted afterward — nothing was left in the shipped code.

### Summary table

| Action | External calls made | Real tokens used (prompt / completion / total) | Real wall-clock time |
|---|---|---|---|
| Dashboard load — `/analysis` (cold) | 1× Finnhub | — | 8.446s |
| Dashboard load — `/projection` | 0 (pure math) | — | 0.229s |
| Dashboard load — `/sector-exposure` | 0 (pure math) | — | 0.214s |
| Dashboard load — `/compliance` (cold) | 1× Groq (`narrate_compliance_flags`) | 488 / 225 / 713 | 1.843s (Groq call itself: 1.166s) |
| Dashboard load — `POST /insights` (cold) | 1× Groq (`generate_narrative`) | 2331 / 1459 / 3790 | 3.984s (Groq call itself: 3.404s) |
| Holdings page load (cold) | 1× Finnhub | — | 8.193s |
| Report generation (cold, 2 concurrent Groq calls) | 1× Finnhub (via internal analysis) + 2× Groq concurrently | Compliance: 488/168/656; Narrative: 2331/1145/3476 | 3.715s total (compliance call 0.864s, narrative call 2.998s — run concurrently, so total ≈ max, not sum) |
| Verified-mode AI Chat turn (3 tool-calling loop iterations before final answer) | 3× Groq (one per loop iteration) | Iter 1: 1773/59/1832; Iter 2: 2123/34/2157; Iter 3: 3454/273/3727 | 4.117s total |
| Exploratory-mode AI Chat turn (1st message — context capture + AI call) | 1× Finnhub (context build) + 1× Groq | 3737 / 1218 / 4955 | **41.875s total (anomalous — see note below)** |
| Exploratory-mode AI Chat turn (2nd message, same conversation) | 1× Groq only (context reused, not rebuilt) | 4888 / 1992 / 6880 | 7.433s total (Groq call itself: 6.843s) |
| Scenario free-text classification — no match found | 1× Groq (`classify_scenario`) | 798 / 234 / 1032 | 1.223s total (Groq call itself: 0.672s) |
| Scenario free-text classification — successful match | 1× Finnhub (cold) + 1× Groq | 798 / 108 / 906 | 8.899s total (Groq call itself: 0.711s; the rest is the cold market-data fetch) |

**Anomaly, reported honestly rather than smoothed over:** the first Exploratory-mode call showed a 41.3-second gap between my own wall-clock timer around the Groq SDK call and Groq's *own* self-reported `total_time` for that same call (2.733s). The very next Exploratory call in the same session showed a much more proportionate gap (6.8s wall-clock vs. 4.4s Groq-reported). This looks like a one-off network/connection-establishment hiccup rather than a systemic pattern, but it is a real, reproduced-tonight data point, not smoothed away — a large first-message context payload plus an unlucky network moment is the most likely explanation, not a confirmed root cause.

### Caching behavior — real evidence, not assumed

**Market-data cache** (`backend/services/market_data_service.py`, 60-second TTL, single-flight per ticker set):
- Cold `/analysis` call: **8.446s**
- Immediate repeat `/analysis` call: **0.227s** — a ~37× speedup, confirming the cache. (The module's own code comment separately documents a previously-measured ~3.9s cold / ~0.2s warm pair — tonight's fresh cold measurement of 8.4s shows real run-to-run variance in the external API's actual latency, underscoring why "measure, don't repeat an old number" mattered here.)

**Groq content-hash narration cache** (`groq_client.py`'s `_cached()` wrapper, 600-second TTL, keyed by a SHA-256 hash of the exact input payload):
- Cold `POST /insights` call: **3.984s**, with a real new Groq API call logged (2331/1459/3790 tokens).
- Immediate repeat `POST /insights` call (same client, same analysis/recommendations payload): **0.232s**, with **zero new Groq log entries** — direct proof the second call never reached the network at all, served entirely from the in-process cache.

---

## 10. Full Math Appendix

All formulas below are exact quotes/derivations from the real source, with a real worked example using client **WAC-0131 (Elena)**'s actual measured data from tonight (total portfolio value **$846,527**, 92.3% equities / 7.7% fixed income / 0% cash against a 20% / 60% / 20% target).

### Diversification score — `backend/services/optimizer.py`, `_score_diversification`
Convention: 0–100, **higher = better diversified**.
```
concentration_component = (1 - largest_equity_position / equities_value) * 100
breadth_component = min(distinct_ticker_count / 5, 1.0) * 100
score = 0.7 * concentration_component + 0.3 * breadth_component
```
`BREADTH_TICKER_CAP = 5`. No fund look-through here — VOO counts as one position, same as AAPL.
*Elena's real result: diversification score 72.*

### Investment health score — `backend/services/optimizer.py`, `_score_health`
Convention: 0–100, **higher = healthier**. Two components:
```
total_drift_pp = sum(abs(drift[bucket]) for each bucket) * 100
drift_component = max(0, 100 - (total_drift_pp / 30) * 100)

largest_position_pct = largest single position / total portfolio value
concentration_component = 100                                        if largest_position_pct <= 0.25
                         = 100 * (1 - (largest_position_pct - 0.25) / 0.75)   otherwise

score = 0.6 * drift_component + 0.4 * concentration_component
```
*Elena's real result: health score 34/100 — allocation-drift component 0, concentration component 85. (Her equity drift is +72.3pp, which would normally crush the drift component, but the health score's drift term only counts up to the 30pp ceiling before flooring at 0 — so severe drift and *extremely* severe drift score identically at the drift-component floor; concentration is what's actually still discriminating her low score.)*

### Drift — `backend/services/optimizer.py`
**Confirmed: an absolute subtraction in percentage points, never a relative/ratio calculation.**
```
drift[bucket] = current_allocation[bucket] - target_allocation[bucket]
```
*Elena's real equities drift: 0.9231 - 0.20 = +0.7231 → displayed as +72.3pp.*

### Total return — `backend/services/optimizer.py`
```
total_return_dollar = total_market_value - total_cost_basis
total_return_pct = total_return_dollar / total_cost_basis
```
Entirely unrealized — a mark-to-market on currently-held lots. **"Realized YTD" is a hardcoded frontend `0`** (`portfolio-summary-cards.tsx`), not a bug or omission: there is no sale-history/transaction-ledger table anywhere in the schema, so the app has no mechanism to ever compute a nonzero realized figure. It's documented as "an honest real zero," not a placeholder for missing functionality.

### Rebalancing trade-sizing — `backend/services/recommendation_matcher.py`
**Threshold** is read per-client from their strategy's own `rebalancing_threshold_pct` — *not* a hardcoded 5pp constant:
```python
if abs(drift_pp) <= threshold_pct:
    continue  # within tolerance, no trade suggested
```
**Sizing**, once triggered, corrects the bucket all the way to its target share (not just back to the tolerance edge):
```python
target_value = target_allocation[bucket] * total_value
current_value = current_allocation[bucket] * total_value
dollar_delta = current_value - target_value   # positive = sell, negative = buy
```
**HIFO lot selection** — sorts a ticker's lots by cost basis per share, **descending**, consuming highest-cost lots first (minimizes realized gain):
```python
for lot in sorted(lots, key=lambda lot: lot["cost_basis_per_share"], reverse=True):
    ...
```

### Monte Carlo projection — `backend/services/projection.py`
`DEFAULT_PATH_COUNT = 10_000`. Per-asset-class (mean, stdev) assumptions:
```python
ASSUMED_RETURN_DISTRIBUTION = {
    "equities": (0.07, 0.16),
    "fixed_income": (0.03, 0.05),
    "cash": (0.01, 0.005),
}
```
Probability of reaching goal:
```python
probability_of_reaching_goal = count(terminal path values >= goal_amount) / path_count
```
computed separately for the current-allocation blend and the target-allocation blend.

### Sector exposure blending — `backend/services/sector_classification.py`
A direct stock's full value goes to its one GICS sector (e.g. AAPL → Technology). A bond ETF's full value goes to "Fixed Income." A fund position's value is *split* across sectors by a static, documented weight table, e.g. VOO:
```python
"VOO": {"Technology": 0.32, "Financials": 0.13, "Healthcare": 0.11, "Consumer Discretionary": 0.10,
        "Communication Services": 0.09, "Industrials": 0.08, "Consumer Staples": 0.06,
        "Energy": 0.04, "Utilities": 0.03, "Real Estate": 0.02, "Materials": 0.02}
```
Blending formula: `sector value += fund_position_value * sector_weight`. Always labeled "approximate index composition," never presented as live look-through data.

### Compliance flags — `backend/services/compliance.py`
**Concentration**: `CONCENTRATION_THRESHOLD_PCT = 0.25`. Triggers above 25% of total portfolio value; escalates to `"high"` severity above **37.5%** (`0.25 * 1.5`), otherwise `"medium"`.
**Wash-sale**: `WASH_SALE_WINDOW_DAYS = 30`. Fires when a recommended SELL would realize a loss on a lot, **and** that same ticker has another held lot purchased within `0 <= days_ago <= 30` of today.

### Scenario archetypes — 5 representative examples (full 44 in Section 14)
- `rate_hike_100bps`: equities −1%, fixed income −5% (duration-based: ~5yr duration × 1.00% yield rise).
- `recession`: equities −25%, fixed income +2%.
- `tech_selloff_25pct`: Technology-sector exposure −25% via fund look-through, everything else unaffected.
- `ai_boom_rally`: Technology +40%, Communication Services +15%, other equities +2%.
- `housing_crash_shock`: Real Estate −50%, Financials −15%, other equities −8%, fixed income −3%.

---

## 11. Dashboard — Literally Every Word, Top to Bottom

*(Cross-verified against a live render of Elena's real Dashboard tonight.)*

**Loading/error/empty states:** `"Loading portfolio data…"`; generic error text or `"Market data temporarily unavailable — please retry shortly."`; no-holdings state `"No portfolio data yet — upload holdings to see analysis."` + `"Go to Holdings"` link; stale-price banner `"Market data temporarily unavailable — showing last known prices."`

**Row 1 — four summary cards:**
- **Total corpus**: `"{n} accounts"` badge, `"Market value as of {date}"`, big number (total portfolio value), `"+/-{$} all-time"`, per-account-type segmented bar (Taxable/401(k)/IRA/Roth IRA/Cash), footer `"Invested (cost basis)"`.
- **Total returns**: qualifier badge (`Good` ≥15%, `Fair` ≥0%, `Down` negative), `"Gain over invested capital"`, big signed number, `"{cost basis} → {market value}"`, two mini-boxes `"Unrealized"` (real) / `"Realized YTD"` (hardcoded $0), footer signed % `"all-time"`.
- **Diversification risk**: band badge (Low/Moderate/Watch/Elevated/High), `"Concentration-weighted, vs. her target allocation"`, semicircle gauge with `"LOW RISK"`/`"HIGH RISK"` axis captions, stat boxes `"Top-3 weight"` and `"Tech sector"` (flagged if >25%).
- **Investment health score**: `"Two weighted components, recomputed on every analysis"`, donut with `"/ 100"` and qualifier (`GOOD`/`FAIR`/`NEEDS ATTENTION`), two factor bars `"Allocation drift"` / `"Concentration"`.

**Row 2:**
- **Allocation vs. target**: donut showing current % / target % per bucket, per-bucket drift rows, footer `"Rebalance to target moves {$}"`.
- **Sector exposure**: `"Direct equity holdings blended with fund look-through weights, across the whole portfolio."`, optional over-25% flag banner, `"Equity sectors"` / `"Non-equity"` sections, footer note about VOO/QQQ/etc. using an approximate static snapshot.

**Row 3 — Financial modeling**: `"Financial modeling — projected portfolio value to {goal_year}"`, `"Monte Carlo median of {n} paths · nominal"`, dual-line chart (`"Current path"` / `"After recommended changes"`), 4 stat cells: median value, uplift vs. current, volatility before→after, probability of funding goal before→after.

**Row 4:**
- **AI recommendations**: `"Language model explains; all figures computed by the optimizer"`, Cards/Briefing tabs. Briefing shows the real narrative or `"Insights unavailable, please retry. The trade suggestions below are unaffected — they come from the deterministic optimizer, not the language model."`, footnote `"Narrative generated from optimizer output. No figure in this text was produced by the model."` Trades list with BUY/SELL badges, Accept/Dismiss buttons, and the disclosure line **`"Nothing is traded or sent to the client without your explicit approval. Accepted trades stage to the blotter for sign-off."`**
- **Scenario analysis**: `"Deterministic stress tests — numbers come from the simulator, not the AI."`, preset chips, free-text input.
- **Retirement funding**: `"Retirement funding · {goal_year}"`, progress bar, `"Goal {$} (advisor-provided)"` or `"Need {$}"` depending on `goal_amount_source`.
- **Compliance flags**: title + `"{n} open"` badge, per-flag category title (`Position concentration breach` / `Wash-sale risk` / `Disclosure`) and narrative/message.

**Bottom — AI Chat panel**: `"Ask about this portfolio"`, `"Verified mode only answers using real, already-computed portfolio data."`, Verified/Exploratory toggle, flagged-notes expander, `"Clear conversation"`, Exploratory-mode banner: *"Exploratory mode: answers may include AI estimates, not verified calculations. Nothing here is used in a report unless you explicitly review and flag it."*

---

## 12. Every Other Page — Same Treatment

**Holdings**: `"Client holdings"`, `"{name} · {accounts} · {n} positions"`, real tax-lot table (Ticker/Name/Quantity/Cost basis/Market value/Weight/Return/Account), TOTAL row. The "Add holding" button is **permanently disabled** with `title="Adding holdings isn't wired to a backend mutation yet — holdings are imported via the client's Excel upload."`

**Reports (list)**: `"Reports"`, `"{name} · {n} generated"`, table (Generated/Status/Health/Diversification/Funding odds/View), empty state `"No reports generated yet"`.

**Client Report / PDF view**: toolbar (`"Draft — not yet approved"` / `"Approved · {date}"`, `"Download PDF"`), letterhead (`"Wealth Advisor Copilot"`, `"NAVEEN C, Financial Advisor"` — hardcoded in three separate places, not a shared constant), headline `"Your portfolio review"`, stats row (Total value / Retirement funding / Health score — **funding % uses the Monte Carlo probability, not a raw trajectory-over-goal ratio, after tonight's fix**), allocation section (`"Stocks — growth over the long run"` / `"Bonds — steadier income"` / `"Cash — available for near-term needs"`), `"Tracking toward {goal_year}"` projection section, `"What we suggest"` (accepted trades only), compliance section, optional `"Advisor notes"` section, single closing disclosures footer.

**Clients**: `"Clients"`, search box, `"Add client"` dialog (name/email/age/risk profile/accounts/goal year/**target retirement amount (optional)** with hint *"Leave blank to estimate automatically from current holdings and target allocation"*/notes), per-row delete with a 409-aware two-step confirm (*"{name} has {n} report(s) that will also be permanently deleted — are you sure?"*), footer hint about live prices fetching on first Dashboard open.

**Explanations**: 24 base glossary terms + 13 extended "how this app actually computes it" entries with real formulas and source citations, search + category filter (All/Risk/Returns/Tax/Accounts/Modeling).

**AI Chat panel** (embedded in Dashboard): see Section 7 and 11 above for full mechanism and copy.

---

## 13. Glossary — Every Term, Plain Definition

- **pp (percentage points)**: an absolute subtraction between two percentages (e.g. 92% actual − 20% target = **72pp**), not a relative/ratio comparison. This app's drift is always expressed this way, never as "actual is 4.6× target."
- **Drift**: how far current allocation has wandered from target, in pp, per bucket.
- **IRA**: Individual Retirement Account — a tax-advantaged account type.
- **Roth IRA**: an IRA funded with after-tax dollars; qualified withdrawals are tax-free.
- **401(k)**: an employer-sponsored tax-advantaged retirement account.
- **Realized YTD**: always shown as $0.00 — this app has no transaction-ledger/sale-history data model, so it can genuinely never compute a nonzero realized gain; it's an honest zero, not a bug.
- **Unrealized gain**: paper profit on a still-held position — market value minus cost basis.
- **HIFO**: Highest-In-First-Out — when sizing a sell, the highest-cost-basis lots are sold first, to minimize the taxable gain realized.
- **Long-term vs. short-term capital gain**: a position held over 12 months is taxed at the (usually lower) long-term rate; 12 months or less is short-term, taxed as ordinary income. A lot with no recorded purchase date defaults to short-term (the more conservative assumption).
- **Basis points (bps)**: 1 bp = 0.01% = 0.0001. "+100bps" means a one-percentage-point move.
- **Diversification score vs. the risk gauge**: the Diversification score itself is 0–100 with **higher = better** (less concentrated). The Dashboard's risk *gauge* deliberately displays `100 - diversification_score`, so the gauge's "LOW RISK ↔ HIGH RISK" axis reads in the opposite direction from the raw score — this is an intentional UI inversion, not a bug, and is exactly why the Explanations page calls this out explicitly.
- **Verified mode**: AI Chat mode where the model can only answer using one of 6 tools backed by real computed data; says so plainly if none can answer.
- **Exploratory mode**: AI Chat mode for open-ended discussion; every non-real-data figure must be explicitly framed as an estimate.
- **Flag for report reference**: marking an AI Chat message as advisor-reviewed; never automatically inserted anywhere.

---

## 14. Full Scenario Library

**44 archetypes total**, confirmed by exact count of `backend/services/scenario_simulator.py`'s `SCENARIOS` dict. Grouped by category, with id, shock, and the deterministic free-text trigger phrases that route to each (via `_KEYWORD_ROUTES`, checked top-to-bottom, most-specific-phrase-first) before falling back to AI classification for anything unmatched.

**Rate / monetary policy**
- `rate_hike_100bps` (equities −1%, FI −5%) — triggers: "rate hike", "rates go up", "raise rates", "interest rate", "rate increase", "fed hike"
- `rate_hike_200bps` (−3% / −10%) — "200bps", "200 bps", "two hundred basis", "big rate hike", "large rate hike"
- `rate_cut_easing` (+3% / +5%) — "rate cut", "rates go down", "lower rates", "easing cycle", "fed cut"
- `quantitative_tightening` (−4% / −3%) — "quantitative tightening", "balance sheet runoff"
- `quantitative_easing` (+8% / +3%) — "quantitative easing", "stimulus"

**Broad market / macro cycle**
- `recession` (−25% / +2%) — "recession", "economic slowdown"
- `correction` (−10% / +1%) — "correction", "pullback"
- `crash` (−40% / +3%) — "2008", "black monday", "market collapse", "stock market crash", "market crash"
- `flash_crash_shock` (−10% / +1%) — "flash crash", "sudden crash", "brief crash"
- `stagflation` (−15% / −8%) — "stagflation"
- `expansion_bull_market` (+20% / −2%) — "bull market", "expansion", "economic boom"
- `deflation` (−12% / +6%) — "deflation", "falling prices"
- `soft_landing` (+6% / +1%) — "soft landing"

**Sector-specific**
- `tech_selloff_25pct` (Technology −25%) — "tech selloff", "tech sell-off", "tech crash", "technology stocks", "tech stocks", "nasdaq"
- `energy_shock` (Energy +30%, other equities −3%) — "energy shock", "oil spike"
- `financials_banking_crisis` (Financials −35%, other −8%, FI +2%) — "banking crisis", "bank crisis", "bank run", "svb", "financial crisis"
- `healthcare_policy_shock` (Healthcare −15%, other −1%) — "healthcare policy", "drug pricing", "healthcare regulation"
- `real_estate_housing_downturn` (RE −30%, Financials −5%, other −3%) — "housing downturn", "real estate crash", "property downturn"
- `housing_crash_shock` (RE −50%, Financials −15%, other −8%, FI −3%) — "housing crash", "housing market crash", "housing bubble bursts", "real estate collapse"
- `ai_boom_rally` (Tech +40%, Comm Svcs +15%, other +2%) — "ai boom", "ai rally", "artificial intelligence rally"
- `tech_regulation_crackdown` (Tech −18%, Comm Svcs −10%) — "tech regulation", "antitrust", "regulatory crackdown"

**Currency / inflation**
- `dollar_strength_shock` (intl −10%, domestic −2%) — "dollar strength", "dollar surges", "dollar rallies", "strong dollar"
- `dollar_weakness_shock` (intl +10%, domestic +2%) — "dollar weakness", "dollar crashes", "dollar falls", "weak dollar"
- `dollar_collapse_shock` (intl +25%, domestic +5%) — "dollar collapse", "dollar collapses", "currency collapse", "dollar implodes"
- `currency_crisis` (intl −25%, domestic −3%, FI +1%) — "currency crisis", "emerging market crisis", "em crisis"
- `inflation_spike` (equities −5%, FI −12%) — "inflation spike", "inflation surges", "high inflation"

**Credit / liquidity**
- `credit_crunch` (equities −18%, FI −10%) — "credit crunch", "credit freeze"
- `corporate_credit_spread_widening` (−8% / −6%) — "credit spread", "spread widening"
- `sovereign_debt_crisis` (−20% / −15%) — "sovereign debt", "debt crisis"

**Commodity / geopolitical**
- `oil_price_spike` (Energy +25%, other −4%, FI −2%) — "oil price spike", "oil prices spike", "oil surge"
- `oil_price_collapse` (Energy −35%, other +3%, FI +1%) — "oil collapse", "oil crash", "oil price collapse", "oil prices collapse"
- `regional_conflict_shock` (equities −8%, Energy +8%, Industrials +2%, FI +2%) — "geopolitical", "regional conflict", "military conflict", "armed conflict", "invasion", "war risk"
- `major_conflict_escalation_shock` (equities −25%, Energy +25%, Industrials +10%, FI +8%) — "major war", "war breaks out", "full-scale war", "major conflict", "war escalates", "escalation"
- `trade_war_tariff` (equities −10%, Industrials −15%, Consumer Disc. −12%, FI +2%) — "trade war", "tariff", "tariffs"
- `commodity_supercycle` (Energy +20%, Materials +20%, other +2%, FI −4%) — "commodity supercycle", "commodity boom", "commodity surge"

**Tail-risk / black swan**
- `pandemic_shock` (Consumer Disc. −35%, other −15%, Healthcare −5%, Tech −8%, FI +3%) — "pandemic", "epidemic", "outbreak"
- `cyber_infrastructure_shock` (Tech −20%, other −8%, FI +2%) — "cyberattack", "cyber attack", "infrastructure disruption", "power grid"
- `sovereign_default` (equities −22%, FI −25%) — "sovereign default", "government default", "default on debt"

**Labor / macro signals / systemic**
- `labor_market_shock_layoffs` (Tech −12%, Consumer Disc. −15%, other −5%, FI +5%) — "layoffs", "mass layoffs", "job losses", "labor market shock", "unemployment spike"
- `yield_curve_inversion_signal_shock` (equities −4%, Financials extra −10%) — "yield curve invert", "yield curve inversion", "inverted yield curve", "curve inversion"
- `liquidity_crisis_bank_contagion_shock` (Financials −30%, other −10%, FI −8%) — "liquidity crisis", "banks freeze lending", "interbank lending freeze", "bank contagion", "credit freeze between banks"
- `asset_bubble_burst_shock` (Tech −30%, Comm Svcs −25%, Consumer Disc. −20%, other −5%, FI +2%) — "asset bubble", "bubble bursts", "speculative bubble", "speculative stocks crash", "meme stock crash"
- `government_shutdown_fiscal_standoff_shock` (equities −3%, FI +1%) — "government shutdown", "government shuts down", "fiscal standoff", "debt ceiling standoff", "budget impasse" *(live-tested tonight: an unmatched phrase, "lawmakers cannot agree on next year's spending bill," correctly AI-classified to this exact scenario in 0.71s)*
- `election_political_uncertainty_shock` (equities −5%, FI +1%) — "election uncertainty", "political uncertainty", "election volatility", "contested election"

Bare, dangerously generic words ("crash", "war", "downturn" alone) are deliberately excluded from keyword routing — ambiguous phrases fall through to AI classification rather than risk a wrong deterministic match.

---

## 15. Design System

*(All values confirmed live from `frontend/src/index.css` — the single global CSS file; this is Tailwind v4's CSS-based `@theme` config, there is no JS config file.)*

### Colors

**Light mode** (`:root`):
| Token | Hex |
|---|---|
| `--background` | `#f2eee4` |
| `--foreground` | `#241f1a` |
| `--card` | `#faf8f3` |
| `--primary` | `#2f5d46` |
| `--secondary` | `#96591a` |
| `--positive` | `#2f6b45` |
| `--destructive` | `#9b3b2e` |
| `--muted` | `#ede8dc` |
| `--accent` | `#e4ebe4` |
| `--border` | `#e0d9cb` |

**Dark mode** (`.dark`):
| Token | Hex |
|---|---|
| `--background` | `#16130f` |
| `--foreground` | `#f4efe6` |
| `--card` | `#1d1915` |
| `--primary` | `#7ba98b` |
| `--secondary` | `#d9a05b` |
| `--positive` | `#7cc49a` |
| `--destructive` | `#e08d7e` |
| `--muted` | `#262019` |
| `--accent` | `#22302a` |
| `--border` | `#332c24` |

**Report/PDF view** (`.report-paper`, always pure-light regardless of app theme): `--background: #ffffff`, `--foreground: #241f1a`, `--primary: #2f5d46`, forces `color-scheme: light`.

### Fonts (3 active, 1 orphaned)
- **IBM Plex Sans Variable** — body/UI text (global default).
- **IBM Plex Mono** (400 + 500 only) — all numeric/ticker/tabular data.
- **Fraunces Variable** — client-facing report view *only* (client name, headline total-value figure).
- **Geist** (`@fontsource-variable/geist`) is installed in `package.json` but has zero references anywhere in the codebase — an orphaned dependency, not an active design-system font.

### Radius
`--radius: 0.625rem` (10px) base, with `--radius-sm` (6px), `--radius-md` (8px), `--radius-lg` (10px), `--radius-xl` (14px) derived from it. Identical in light and dark. Many components also use one-off arbitrary values (`rounded-[14px]` etc.) outside this scale.

### Shadows
| Token | Light | Dark |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(36,31,26,0.07)` | `0 1px 2px rgba(0,0,0,0.5)` |
| `--shadow-elevated` | `0 8px 30px rgba(36,31,26,0.14)` | `0 8px 30px rgba(0,0,0,0.6)` |

### Spacing
No custom spacing scale — default Tailwind v4 spacing throughout, with heavy use of one-off arbitrary values per component. One notable token: `--text-2xs: 0.6875rem` (11px), documented as the absolute floor for any UI text.

### Animation durations
Exactly two real durations are used anywhere in the app: **150ms** (the overwhelming majority — button hover/press scale, dialog enter animations) and **200ms** (page/section-level fade-ins). Plus a one-off **280ms** `flash-highlight` keyframe for in-place number updates, and the standard `0.01ms` floor under `prefers-reduced-motion: reduce`.
