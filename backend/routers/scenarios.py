"""POST /clients/{id}/scenario — deterministic scenario impact simulation.

Reuses the client-store and market-data-service helpers already built in
Phases 3-4, so this router only orchestrates: resolve free text to a known
scenario id -> load client -> fetch live prices -> run the scenario
simulator -> return the projected impact. Unlike /analysis, this does not
persist anything to the client's stored JSON — a scenario is a hypothetical
"what if," not a fact about the client's actual holdings.

Free-text resolution order: exact id/label match, then
scenario_simulator's own non-AI keyword fallback, then — only if both of
those fail — the AI as a pure CLASSIFIER over the existing scenario list
(services.groq_client.classify_scenario). The AI never invents a
magnitude or a new scenario here; it only ever picks which already-existing,
already-computed archetype best matches the question, or says no match. If
the AI itself is unavailable (e.g. rate-limited), that's treated the same as
no match rather than failing the whole request differently — the advisor
still gets a clear "couldn't match" error either way.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import scenario_simulator
from services.client_store import ClientNotFoundError, load_client
from services.market_data_service import MarketDataUnavailableError, fetch_prices_with_fallback

logger = logging.getLogger(__name__)

router = APIRouter()


class ScenarioRequest(BaseModel):
    scenario: str


@router.post("/clients/{client_id}/scenario")
def run_scenario(client_id: str, request: ScenarioRequest) -> dict:
    try:
        client = load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    holdings = client.get("holdings", [])
    tickers = sorted({holding["ticker"] for holding in holdings})
    if not tickers:
        raise HTTPException(status_code=422, detail=f"Client '{client_id}' has no holdings to simulate against.")

    try:
        scenario_id = scenario_simulator.resolve_scenario_with_ai_fallback(request.scenario)
    except scenario_simulator.UnrecognizedScenarioError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        prices, source = fetch_prices_with_fallback(tickers)
    except MarketDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}") from exc

    try:
        result = scenario_simulator.simulate_scenario(
            scenario_input=scenario_id,
            holdings=holdings,
            cash_balance=client.get("cash_balance", 0.0),
            prices=prices,
        )
    except scenario_simulator.UnrecognizedScenarioError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    result["matched_input"] = request.scenario
    logger.info("Simulated scenario '%s' for %s using %s prices.", result["scenario_id"], client_id, source)

    return {
        "client_id": client_id,
        "market_data_source": source,
        **result,
    }
