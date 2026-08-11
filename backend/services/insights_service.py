"""Shared orchestration pipeline: load a client, fetch live prices, run the
deterministic optimizer + recommendation matcher, and get Gemini's narration
of the result.

Used by both POST /clients/{id}/insights (which additionally appends an
audit-log entry) and POST /clients/{id}/reports (which assembles this into a
shareable report) — so this pipeline exists in exactly one place rather than
being duplicated per router.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services import gemini_client, insight_facts, optimizer, recommendation_matcher, sector_classification
from services.client_store import load_client, load_strategy_for_risk_profile, save_client
from services.market_data_service import fetch_prices_with_fallback


def compute_deterministic_analysis(client_id: str) -> dict[str, Any]:
    """The non-AI half of the pipeline: load a client, fetch live prices,
    run the optimizer + recommendation matcher, and persist the fetched
    prices back onto the client record. No Gemini call happens here — split
    out from compute_insights specifically so a caller that needs MORE than
    one Gemini call for the same analysis (routers/reports.py needs both
    the narrative AND compliance-flag narration) can fire them concurrently
    instead of paying for two sequential network round-trips, since neither
    one depends on the other's output — both only depend on this function's
    deterministic result.

    Raises (uncaught — callers translate these to HTTP responses):
    ClientNotFoundError, StrategyNotFoundError, MarketDataUnavailableError,
    ValueError (no holdings / no live price / zero portfolio value).
    """
    client = load_client(client_id)

    holdings = client.get("holdings", [])
    tickers = sorted({holding["ticker"] for holding in holdings})
    if not tickers:
        raise ValueError(f"Client '{client_id}' has no holdings to analyze.")

    prices, source = fetch_prices_with_fallback(tickers)

    cash_balance = client.get("cash_balance", 0.0)
    target_allocation = client["target_allocation"]

    analysis = optimizer.analyze_portfolio(
        holdings=holdings,
        cash_balance=cash_balance,
        prices=prices,
        target_allocation=target_allocation,
        cash_account_type=client.get("cash_account_type", "cash"),
    )
    strategy = load_strategy_for_risk_profile(client["risk_profile"])
    recommendations = recommendation_matcher.generate_recommendations(
        holdings=holdings,
        cash_balance=cash_balance,
        prices=prices,
        current_allocation=analysis["current_allocation"],
        target_allocation=analysis["target_allocation"],
        drift=analysis["drift"],
        strategy=strategy,
    )
    # Recommendations are regenerated fresh every call (no stored id), so the
    # advisor's real Accept/Dismiss choice — persisted via PUT
    # /clients/{id}/trade-decisions, keyed by ticker+action — is reattached
    # here rather than left to reset to "pending" on every reload. This is
    # also what lets a generated report reflect real decisions instead of
    # showing every suggestion as if it were accepted.
    trade_decisions = client.get("trade_decisions", {})
    for rec in recommendations:
        rec["decision"] = trade_decisions.get(f"{rec['ticker']}:{rec['action']}", "pending")

    # Persist fetched prices onto the stored client record now that we've
    # actually used them (Backend Schema: last_price / last_price_updated_at
    # are populated at request time).
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for holding in holdings:
        price = prices.get(holding["ticker"])
        if price is not None:
            holding["last_price"] = price
            holding["last_price_updated_at"] = fetched_at
    client["holdings"] = holdings
    save_client(client_id, client)

    return {
        "client": client,
        "holdings": holdings,
        "prices": prices,
        "source": source,
        "fetched_at": fetched_at,
        "analysis": analysis,
        "strategy": strategy,
        "recommendations": recommendations,
    }


def compute_insights(client_id: str) -> dict[str, Any]:
    """Run the full pipeline for one client and return everything a caller
    might need (client record, prices, source, analysis, strategy,
    recommendations, narrative, narrative_error, fetch timestamp).

    Raises (uncaught — callers translate these to HTTP responses):
    ClientNotFoundError, StrategyNotFoundError, MarketDataUnavailableError,
    ValueError (no holdings / no live price / zero portfolio value).
    gemini_client.GeminiError is caught internally — see `narrative_error`.
    """
    base = compute_deterministic_analysis(client_id)

    # Per the App Flow doc's error-state requirement, a Gemini failure must
    # never block the deterministic output — only the narrative itself goes
    # missing. Callers that require a narrative (e.g. client-facing report
    # generation) check `narrative_error` themselves and fail there instead.
    try:
        narrative = gemini_client.generate_narrative(
            analysis=base["analysis"], recommendations=base["recommendations"]
        )
        narrative_error = None
    except gemini_client.GeminiError as exc:
        narrative = None
        narrative_error = str(exc)

    return {**base, "narrative": narrative, "narrative_error": narrative_error}


def compute_structured_insights(client_id: str) -> dict[str, Any]:
    """Real, per-fact structured narration for the AI recommendations
    "Cards" view — see services/insight_facts.py for how each fact's numbers
    are computed and services/gemini_client.py's generate_structured_insights
    for how Gemini is only ever asked to write prose for numbers we already
    picked. Severity and tag come from insight_facts.py, never from Gemini.

    Deliberately a separate, on-demand pipeline (not folded into
    compute_insights/POST /insights) because it costs a second Gemini call —
    the Cards tab is lazy-loaded by the frontend only when an advisor
    actually opens it, not fetched on every dashboard load, given Gemini's
    free-tier daily request quota.

    Raises the same exceptions as compute_insights (ClientNotFoundError,
    StrategyNotFoundError, MarketDataUnavailableError, ValueError).
    gemini_client.GeminiError is caught internally — see `insights_error`.
    """
    client = load_client(client_id)

    holdings = client.get("holdings", [])
    tickers = sorted({holding["ticker"] for holding in holdings})
    if not tickers:
        raise ValueError(f"Client '{client_id}' has no holdings to analyze.")

    prices, source = fetch_prices_with_fallback(tickers)

    cash_balance = client.get("cash_balance", 0.0)
    target_allocation = client["target_allocation"]
    cash_account_type = client.get("cash_account_type", "cash")

    analysis = optimizer.analyze_portfolio(
        holdings=holdings,
        cash_balance=cash_balance,
        prices=prices,
        target_allocation=target_allocation,
        cash_account_type=cash_account_type,
    )
    strategy = load_strategy_for_risk_profile(client["risk_profile"])
    recommendations = recommendation_matcher.generate_recommendations(
        holdings=holdings,
        cash_balance=cash_balance,
        prices=prices,
        current_allocation=analysis["current_allocation"],
        target_allocation=analysis["target_allocation"],
        drift=analysis["drift"],
        strategy=strategy,
    )
    sector_exposure = sector_classification.compute_sector_exposure(
        holdings=holdings, prices=prices, cash_balance=cash_balance
    )
    post_trade_analysis = optimizer.simulate_post_trade_scores(
        holdings=holdings,
        cash_balance=cash_balance,
        prices=prices,
        target_allocation=target_allocation,
        recommendations=recommendations,
        cash_account_type=cash_account_type,
    )

    facts = insight_facts.build_insight_facts(
        analysis=analysis,
        strategy=strategy,
        recommendations=recommendations,
        sector_exposure=sector_exposure,
        post_trade_analysis=post_trade_analysis,
    )

    try:
        narrations = gemini_client.generate_structured_insights(facts)
        insights_error = None
    except gemini_client.GeminiError as exc:
        narrations = []
        insights_error = str(exc)

    # If Gemini didn't narrate a given fact (whole call failed, or that
    # fact's id was missing/mismatched in its response), fall back to a
    # plain deterministic title/description templated from the fact's own
    # real numbers — the Cards view stays useful even with zero AI
    # narration, same "never block on the AI call" principle as Briefing.
    narrations_by_id = {n["id"]: n for n in narrations}
    cards = [
        {
            "id": fact["id"],
            "kind": fact["kind"],
            "severity": fact["severity"],
            "tag": fact["tag"],
            "source_label": fact["source_label"],
            "title": narrations_by_id.get(fact["id"], {}).get("title", fact["fallback_title"]),
            "description": narrations_by_id.get(fact["id"], {}).get("description", fact["fallback_description"]),
            "ai_generated": fact["id"] in narrations_by_id,
        }
        for fact in facts
    ]

    return {
        "source": source,
        "cards": cards,
        "insights_error": insights_error,
    }
