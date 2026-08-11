"""AI narration layer — narrates already-calculated numbers. Runs on Groq
(not actually Gemini — see naming note below).

Hard constraint (TRD/PRD): the model must never generate, calculate, or
invent any financial number. Every figure in its output must trace back to
a value already present in the structured data passed into
generate_narrative() (from optimizer.py, recommendation_matcher.py, and
optionally scenario_simulator.py). This module only builds a prompt around
that data and returns the model's plain-language narrative — it never asks
it to "estimate," "calculate," or "project" anything itself. This rule is a
prompting discipline, not something tied to any specific provider, which is
exactly why swapping providers below didn't require touching it.

Naming note: this module/file is still named for Gemini, and the exception
class below is still `GeminiError`, even though the actual calls now go to
Groq's API. Swapped 2026-08-06 after Google deprecated the previously-pinned
gemini-2.5-flash for new API keys/projects (a live 404 "no longer available
to new users") on top of the free tier's persistently tight quota (20
requests/day on some models) — recurring friction unrelated to anything in
this app's own code. Left the module/class names as-is to keep this a
narrow, low-risk swap rather than a rename sweeping every file that imports
`gemini_client` or references "Gemini" in a comment; rename later if it's
worth the touched-files diff.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from typing import Any, Callable, TypeVar

from groq import Groq

logger = logging.getLogger(__name__)

# Every narration call here is a pure function of its input JSON: the same
# analysis/recommendations/flags always produce the same real numbers, so
# there's no "staleness" risk in reusing a past response the way there
# would be for live market data — the cache key already encodes the exact
# state. This mirrors services/market_data_service.py's single-flight TTL
# cache (same rationale: collapse redundant concurrent/repeat calls onto
# one real fetch), but the TTL here exists only to bound memory for
# clients/inputs no longer in use, not for correctness — a "stale" hit is
# definitionally still correct since the input hasn't changed.
_NARRATION_CACHE_TTL_SECONDS = 600

T = TypeVar("T")

_narration_cache: dict[str, tuple[Any, float]] = {}
_narration_cache_locks: dict[str, threading.Lock] = {}
_narration_cache_locks_guard = threading.Lock()


def _cache_key(fn_name: str, payload: Any) -> str:
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    return f"{fn_name}:{digest}"


def _cached(fn_name: str, payload: Any, compute: Callable[[], T]) -> T:
    key = _cache_key(fn_name, payload)

    cached = _narration_cache.get(key)
    if cached is not None and cached[1] > time.monotonic():
        return cached[0]

    with _narration_cache_locks_guard:
        lock = _narration_cache_locks.setdefault(key, threading.Lock())

    with lock:
        cached = _narration_cache.get(key)
        if cached is not None and cached[1] > time.monotonic():
            return cached[0]

        result = compute()
        _narration_cache[key] = (result, time.monotonic() + _NARRATION_CACHE_TTL_SECONDS)
        return result


# llama-3.3-70b-versatile: a solid, well-tested instruction-follower on
# Groq's free tier, confirmed live against this app's actual key
# (2026-08-06) for both plain narration and JSON-object mode. Groq also
# rotates/retires hosted models over time (same category of risk Gemini
# just demonstrated) — if this one goes away, check
# https://console.groq.com/docs/models for what's currently served, or list
# live via `GET https://api.groq.com/openai/v1/models` with the real key.
MODEL_NAME = "llama-3.3-70b-versatile"

_SYSTEM_INSTRUCTION = """You are a financial-analysis narration assistant for a professional wealth advisor.

You will be given a JSON object containing portfolio analysis numbers and trade recommendations, and optionally a scenario projection. Every figure in it was already calculated by deterministic backend code, not by you. Your only job is to explain these exact numbers in clear, plain language for a financial advisor to read.

Strict rules, no exceptions:
- Never calculate, estimate, infer, or invent any number that is not already present in the JSON data given to you — no percentages, dollar amounts, scores, share counts, or dates.
- Never perform arithmetic on the given numbers to produce a new figure (do not add, subtract, average, or project anything yourself) — only reference numbers exactly as given in the data, rounded for readability if you like, but never changed or fabricated.
- Never recommend a trade, action, or number that is not already present in the data.
- Structure your narrative as short paragraphs covering, in order: (1) overall diversification and health summary, (2) allocation drift explanation, (3) the specific trade recommendations and why (referencing their notes), and (4) scenario impact, only if scenario data is provided in the input.
- Plain language, minimal jargon (briefly explain any technical term you use), appropriate for an advisor to read quickly or relay to a client.
"""


class GeminiError(RuntimeError):
    """Raised when the AI narration call can't be used (missing key, API failure, empty response)."""


def _get_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise GeminiError("GROQ_API_KEY is not set in backend/.env.")
    return Groq(api_key=api_key)


def get_groq_client() -> Groq:
    """Public accessor for callers outside this module that need the raw
    Groq client for a call shape this module doesn't already provide (e.g.
    services/chat_service.py's tool-calling loop) — keeps the API-key
    loading/validation in exactly one place rather than duplicated."""
    return _get_client()


def _chat(client: Groq, system_instruction: str, prompt: str, *, json_mode: bool = False) -> str:
    """Shared chat-completion call — every function below just supplies its
    own system instruction/prompt/error label around this."""
    kwargs: dict[str, Any] = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt},
        ],
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = client.chat.completions.create(**kwargs)
    return response.choices[0].message.content or ""


def generate_narrative(
    analysis: dict[str, Any],
    recommendations: list[dict[str, Any]],
    scenario: dict[str, Any] | None = None,
) -> str:
    """Return the model's plain-language narrative of already-calculated data.

    `analysis` is optimizer.analyze_portfolio()'s output, `recommendations`
    is recommendation_matcher.generate_recommendations()'s output, and the
    optional `scenario` is scenario_simulator.simulate_scenario()'s output.
    None of these are recalculated or altered here — they're serialized
    as-is and handed to the model strictly to narrate under the system
    instruction above.
    """
    payload: dict[str, Any] = {
        "portfolio_analysis": analysis,
        "trade_recommendations": recommendations,
    }
    if scenario is not None:
        payload["scenario_projection"] = scenario

    def compute() -> str:
        client = _get_client()
        prompt = (
            "Here is the calculated portfolio data for one client. Narrate it "
            "following the system rules exactly — do not add any number that "
            "isn't already in this JSON:\n\n" + json.dumps(payload, indent=2)
        )
        try:
            text = _chat(client, _SYSTEM_INSTRUCTION, prompt)
        except Exception as exc:  # the SDK raises several distinct exception types
            raise GeminiError(f"Gemini request failed: {exc}") from exc

        if not text:
            raise GeminiError("Gemini returned no narrative text.")
        return text

    return _cached("generate_narrative", payload, compute)


_STRUCTURED_SYSTEM_INSTRUCTION = """You are a financial-analysis narration assistant for a professional wealth advisor.

You will be given a JSON array of "facts". Each fact has an id, a kind, and a "numbers" object — every number in it was already calculated by deterministic backend code, not by you. Your only job is to write a short title and a one-to-two-sentence description for EACH fact, using only the numbers already present in that fact's own "numbers" object.

Strict rules, no exceptions:
- Return ONLY a JSON object shaped exactly {"results": [{"id": "<same id as the input fact>", "title": "<title>", "description": "<description>"}, ...]} — one array entry per input fact, no other top-level fields, no markdown fences.
- title: 8 words or fewer, no trailing period.
- description: plain language, 1-2 sentences, minimal jargon.
- Never invent, estimate, or infer ANY number, percentage, or dollar figure not already present in that fact's "numbers" object — including a confidence score, since none is computed anywhere in this system.
- Never invent a date, ticker, account, or recommendation not already present in the input.
- Never perform arithmetic to produce a new figure — reference the given numbers as-is (rounded for readability if you like, but not changed).
- One results entry per input fact, in the same order, matched by id.
"""


def generate_structured_insights(facts: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Returns [{id, title, description}, ...] — the model's narration of
    each fact in `facts`, using only the numbers already in that fact's own
    "numbers" dict (see services/insight_facts.py). Severity and tag are
    computed deterministically there and are never sent to or influenced by
    the model — this function only ever asks it to write prose for numbers
    we already picked. Returns an empty list if `facts` is empty (nothing to
    narrate, so no API call is made).
    """
    if not facts:
        return []

    payload = [{"id": f["id"], "kind": f["kind"], "numbers": f["numbers"]} for f in facts]

    def compute() -> list[dict[str, str]]:
        client = _get_client()
        prompt = (
            "Here are the facts to narrate, one JSON object per fact. Follow the "
            "system rules exactly — return one results entry per input fact, "
            "matched by id, with no invented numbers:\n\n" + json.dumps(payload, indent=2)
        )
        try:
            text = _chat(client, _STRUCTURED_SYSTEM_INSTRUCTION, prompt, json_mode=True)
        except Exception as exc:  # the SDK raises several distinct exception types
            raise GeminiError(f"Gemini request failed: {exc}") from exc

        if not text:
            raise GeminiError("Gemini returned no structured insight text.")

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise GeminiError(f"Gemini returned non-JSON output: {exc}") from exc

        results = parsed.get("results") if isinstance(parsed, dict) else None
        if not isinstance(results, list):
            raise GeminiError('Gemini\'s structured insight response had no "results" array.')

        narrations: dict[str, dict[str, str]] = {}
        for item in results:
            if isinstance(item, dict) and "id" in item and "title" in item and "description" in item:
                narrations[item["id"]] = {"title": str(item["title"]), "description": str(item["description"])}

        # Only ever return narration for facts we actually asked about, in
        # our own order — if the model skipped or mismatched an id, that
        # fact is just dropped rather than shown with mismatched text.
        return [{"id": f["id"], **narrations[f["id"]]} for f in facts if f["id"] in narrations]

    return _cached("generate_structured_insights", payload, compute)


_SCENARIO_CLASSIFIER_SYSTEM_INSTRUCTION = """You are a strict classifier for a financial-scenario library.

You will be given an advisor's free-text question and a fixed list of existing scenario ids with their labels. Every one of those scenarios already has its own deterministic, pre-computed shock model — you are not calculating or narrating anything here.

Strict rules, no exceptions:
- Output ONLY one existing id from the given list, exactly as written, OR the literal text "no_match" if genuinely nothing in the list fits.
- Never invent a new scenario id that isn't in the given list.
- Never output a magnitude, percentage, dollar amount, or any other number.
- Never output an explanation, punctuation, or any text beyond the single id (or "no_match").
"""


def classify_scenario(free_text: str, scenarios: list[dict[str, str]]) -> str | None:
    """Return the single best-matching scenario id for `free_text` from
    `scenarios` (a list of {"id", "label"} dicts — see
    services.scenario_simulator.SCENARIOS), or None if nothing genuinely
    matches.

    The model is used here strictly as a CLASSIFIER: it selects which of the
    already-existing, already-computed scenario archetypes best matches the
    advisor's free text — it never invents a new scenario, a magnitude, or
    any number. The caller (routers/scenarios.py) still validates the
    returned id is actually one of the known ones before trusting it, since
    an LLM can still hallucinate a plausible-looking id outside the list
    despite the instruction not to.
    """
    payload = {"free_text": free_text, "scenarios": scenarios}

    def compute() -> str:
        client = _get_client()
        options_text = "\n".join(f"- {s['id']}: {s['label']}" for s in scenarios)
        prompt = (
            "An advisor typed this free-text market scenario question:\n\n"
            f'"{free_text}"\n\n'
            "Here is the full list of available scenario ids (id: label):\n"
            f"{options_text}\n\n"
            "Which single id above best matches what the advisor is asking about? "
            "Respond with ONLY that id, or exactly \"no_match\" if nothing fits."
        )
        try:
            text = _chat(client, _SCENARIO_CLASSIFIER_SYSTEM_INSTRUCTION, prompt)
        except Exception as exc:  # the SDK raises several distinct exception types
            raise GeminiError(f"Gemini scenario classification failed: {exc}") from exc

        if not text:
            raise GeminiError("Gemini returned no scenario classification text.")
        return text.strip().strip('"').strip("'").strip(".").lower()

    candidate = _cached("classify_scenario", payload, compute)
    if candidate == "no_match":
        return None
    return candidate


_COMPLIANCE_NARRATION_SYSTEM_INSTRUCTION = """You are a plain-language compliance-flag narrator for a professional wealth advisor.

You will be given a JSON array of real compliance flags. Every flag was already raised by a deterministic, rules-based check — you did not decide that any of them apply, and you never add or remove a flag. Each flag has an id, a category, and a "message" that already states the real numbers behind it (percentages, dollar amounts, day counts). Your only job is to write a short, clear explanation of EACH flag for an advisor to read, using only the numbers already present in that flag's own "message".

Strict rules, no exceptions:
- Return ONLY a JSON object shaped exactly {"results": [{"id": "<same id as the input flag>", "narrative": "<explanation>"}, ...]} — one array entry per input flag, no other top-level fields, no markdown fences.
- narrative: 1-2 plain-language sentences, minimal jargon (briefly explain any technical term you use).
- Never invent, estimate, or infer ANY number, percentage, dollar amount, or date not already present in that flag's own "message".
- Never invent a new compliance flag, ticker, category, or recommendation not already given.
- Never soften, dismiss, or add legal/financial advice beyond explaining what the flag's own numbers already mean.
- One results entry per input flag, in the same order, matched by id.
"""


def narrate_compliance_flags(flags: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a copy of `flags` (see services/compliance.py) with a
    "narrative" key added to every flag: a short plain-language explanation
    of that flag's own real numbers, for advisor-facing display.
    compliance.py itself never calls the AI model and stays fully
    deterministic — this is a separate narration pass layered on top, the
    same "AI narrates, never invents" split used everywhere else in this
    app (see generate_narrative/generate_structured_insights above).

    "disclosure"-category flags are the two fixed legal disclosure lines
    (services/compliance.py's standard_disclosures()) and are deliberately
    excluded from narration — they are never sent to the model, so they can
    never come back reworded, and always get narrative=None.

    This never raises: a narration failure (rate limit, no key, bad
    response) just leaves narrative=None on the real flags it couldn't
    reach, since a compliance flag itself must always display with or
    without AI — the same graceful-degradation behavior generate_narrative's
    callers already rely on when ai_narrative is null.
    """
    narratable = [flag for flag in flags if flag["category"] != "disclosure"]
    narrations: dict[str, str] = {}

    if narratable:
        payload = [{"id": f["id"], "category": f["category"], "message": f["message"]} for f in narratable]

        def compute() -> dict[str, str]:
            client = _get_client()
            prompt = (
                "Here are the real compliance flags to narrate, one JSON object per flag. Follow the "
                "system rules exactly — return one results entry per input flag, matched by id, with no "
                "invented numbers or flags:\n\n" + json.dumps(payload, indent=2)
            )
            text = _chat(client, _COMPLIANCE_NARRATION_SYSTEM_INSTRUCTION, prompt, json_mode=True)
            if not text:
                raise GeminiError("Gemini returned no compliance narration text.")
            parsed = json.loads(text)
            results = parsed.get("results") if isinstance(parsed, dict) else None
            if not isinstance(results, list):
                raise GeminiError('Gemini\'s compliance narration response had no "results" array.')
            result: dict[str, str] = {}
            for item in results:
                if isinstance(item, dict) and "id" in item and "narrative" in item:
                    result[item["id"]] = str(item["narrative"])
            return result

        # Deliberately broad and never raised to the caller — a compliance
        # flag itself must always display with or without AI narration.
        # Failures are never cached (only compute()'s return value is), so
        # the next call retries for real rather than being stuck on null.
        try:
            narrations = _cached("narrate_compliance_flags", payload, compute)
        except Exception as exc:  # noqa: BLE001 - deliberately broad; narration is best-effort
            logger.warning("Compliance flag narration unavailable: %s", exc)

    # Only ever attach narrative for a flag we actually asked about, in our
    # own order — if the model skipped/mismatched an id, that flag just
    # keeps narrative=None rather than showing mismatched text.
    return [{**flag, "narrative": narrations.get(flag["id"])} for flag in flags]
