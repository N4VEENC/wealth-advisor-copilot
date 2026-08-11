"""GET /clients/{id}/analysis — deterministic portfolio optimizer output.
GET /clients/{id}/projection — illustrative current-vs-target growth trajectory.

Both fetch live prices (reusing the Phase 3 Finnhub/yfinance fallback logic
via services/market_data_service.py) and run the deterministic optimizer;
/analysis also persists the fetched prices back onto the client's stored
holdings (last_price / last_price_updated_at, per the Backend Schema doc).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from services import compliance, groq_client, holdings as holdings_service, optimizer, projection, recommendation_matcher, sector_classification
from services.client_store import (
    ClientNotFoundError,
    StrategyNotFoundError,
    load_client,
    load_strategy_for_risk_profile,
    save_client,
)
from services.market_data_service import MarketDataUnavailableError, fetch_prices_with_fallback

logger = logging.getLogger(__name__)

router = APIRouter()


def _load_and_analyze(client_id: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, float], str]:
    """Shared by /analysis and /projection: load client, fetch live prices,
    run the optimizer. Raises HTTPException on any failure."""
    try:
        client = load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    holdings = client.get("holdings", [])
    tickers = sorted({holding["ticker"] for holding in holdings})
    if not tickers:
        raise HTTPException(status_code=422, detail=f"Client '{client_id}' has no holdings to analyze.")

    try:
        prices, source = fetch_prices_with_fallback(tickers)
    except MarketDataUnavailableError as exc:
        # Both live sources are down. Rather than hard-failing the whole
        # dashboard, fall back to each holding's last stored live price
        # (Backend Schema's last_price/last_price_updated_at, persisted by a
        # previous successful fetch below) — a real, previously-fetched
        # price, never a fabricated one. Only a ticker with no stored price
        # at all (never successfully priced) leaves a genuine gap we can't
        # paper over.
        stale_prices = {
            holding["ticker"]: holding["last_price"]
            for holding in holdings
            if holding.get("last_price") is not None
        }
        missing = [ticker for ticker in tickers if ticker not in stale_prices]
        if missing:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Market data unavailable: {exc} No previously-fetched price on file for "
                    f"{', '.join(missing)}."
                ),
            ) from exc
        logger.warning("Live market data unavailable for %s; using last known prices.", client_id)
        prices, source = stale_prices, "stale"

    try:
        result = optimizer.analyze_portfolio(
            holdings=holdings,
            cash_balance=client.get("cash_balance", 0.0),
            prices=prices,
            target_allocation=client["target_allocation"],
            cash_account_type=client.get("cash_account_type", "cash"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return client, result, prices, source


@router.get("/clients/{client_id}/analysis")
def get_client_analysis(client_id: str) -> dict:
    client, result, prices, source = _load_and_analyze(client_id)
    holdings = client["holdings"]

    # Persist fetched prices onto the stored client record now that we've
    # actually used them (Backend Schema: last_price / last_price_updated_at
    # are populated at request time, not kept stale between calls). Skipped
    # when source is "stale" — those prices are the already-stored values
    # themselves (both live sources were down), so re-saving would stamp a
    # false "just fetched" timestamp on data that's actually unchanged.
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if source != "stale":
        for holding in holdings:
            price = prices.get(holding["ticker"])
            if price is not None:
                holding["last_price"] = price
                holding["last_price_updated_at"] = fetched_at
        client["holdings"] = holdings
        save_client(client_id, client)

    logger.info("Analyzed portfolio for %s using %s prices.", client_id, source)

    return {
        "client_id": client_id,
        "market_data_source": source,
        "as_of": fetched_at,
        **result,
    }


@router.get("/clients/{client_id}/holdings")
def get_client_holdings(client_id: str) -> dict:
    """Per-position rows for the Holdings page table — one row per stored
    holding (ticker + account_type) plus a synthetic cash row, all built from
    the same live prices and real tax-lot data /analysis uses (see
    services/holdings.build_holdings_rows). Also persists fetched prices,
    same as /analysis."""
    client, result, prices, source = _load_and_analyze(client_id)
    holdings = client["holdings"]

    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for holding in holdings:
        price = prices.get(holding["ticker"])
        if price is not None:
            holding["last_price"] = price
            holding["last_price_updated_at"] = fetched_at
    client["holdings"] = holdings
    save_client(client_id, client)

    total_portfolio_value = result["total_portfolio_value"]
    rows = holdings_service.build_holdings_rows(holdings, prices, total_portfolio_value)

    cash_balance = client.get("cash_balance", 0.0)
    cash_row = None
    if cash_balance > 0:
        cash_row = {
            "ticker": None,
            "name": "Settlement cash",
            "account_type": client.get("cash_account_type", "cash"),
            "quantity": None,
            "average_cost_basis_per_share": None,
            "cost_basis": None,
            "current_price": None,
            "market_value": round(cash_balance, 2),
            "weight": round(cash_balance / total_portfolio_value, 4) if total_portfolio_value > 0 else None,
            "gain_dollar": None,
            "gain_pct": None,
        }

    logger.info("Built holdings table for %s (%d rows) using %s prices.", client_id, len(rows), source)

    return {
        "client_id": client_id,
        "market_data_source": source,
        "as_of": fetched_at,
        "rows": rows,
        "cash_row": cash_row,
        "total_positions": len(rows) + (1 if cash_row else 0),
        "total_portfolio_value": total_portfolio_value,
        "total_cost_basis": result["total_cost_basis"],
        "total_return_dollar": result["total_return_dollar"],
        "total_return_pct": result["total_return_pct"],
    }


@router.get("/clients/{client_id}/projection")
def get_client_projection(client_id: str) -> dict:
    """Lightweight endpoint: reuses projection.py's Monte Carlo simulation
    directly without assembling a full report (see routers/reports.py for
    that). Does not persist prices — this is a read-only projection, not an
    authoritative analysis refresh."""
    client, result, _prices, source = _load_and_analyze(client_id)

    monte_carlo = projection.run_monte_carlo_projection(
        total_portfolio_value=result["total_portfolio_value"],
        current_allocation=result["current_allocation"],
        target_allocation=result["target_allocation"],
        annual_contribution=client.get("annual_contribution", 0.0),
        goal_year=client["goal_year"],
        goal_amount=projection.resolve_goal_amount(client),
    )

    logger.info(
        "Projected trajectory for %s using %s prices (%d Monte Carlo paths).",
        client_id,
        source,
        monte_carlo["path_count"],
    )

    return {
        "client_id": client_id,
        "market_data_source": source,
        **monte_carlo,
    }


@router.get("/clients/{client_id}/sector-exposure")
def get_client_sector_exposure(client_id: str) -> dict:
    """Blended sector exposure: direct holdings (AAPL, MSFT) + VOO's
    approximate look-through weights, with Fixed Income and Cash kept as
    separate non-equity buckets. See services/sector_classification.py for
    the documented approximation this relies on for VOO."""
    client, _result, prices, source = _load_and_analyze(client_id)

    try:
        exposure = sector_classification.compute_sector_exposure(
            holdings=client["holdings"],
            prices=prices,
            cash_balance=client.get("cash_balance", 0.0),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    logger.info("Computed sector exposure for %s using %s prices.", client_id, source)

    return {
        "client_id": client_id,
        "market_data_source": source,
        **exposure,
    }


@router.get("/clients/{client_id}/compliance")
def get_client_compliance(client_id: str) -> dict:
    """Rules-based compliance flags: single-position concentration,
    wash-sale risk (checked against real recommended trades + lot data),
    and standard disclosures. Every flag itself is decided deterministically
    by services/compliance.py, never by the AI; the AI is only layered on
    top afterward to narrate each real (non-disclosure) flag in plain
    language — see groq_client.narrate_compliance_flags."""
    client, result, prices, source = _load_and_analyze(client_id)

    try:
        strategy = load_strategy_for_risk_profile(client["risk_profile"])
    except StrategyNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    recommendations = recommendation_matcher.generate_recommendations(
        holdings=client["holdings"],
        cash_balance=client.get("cash_balance", 0.0),
        prices=prices,
        current_allocation=result["current_allocation"],
        target_allocation=result["target_allocation"],
        drift=result["drift"],
        strategy=strategy,
    )

    flags = compliance.compute_compliance_flags(
        holdings=client["holdings"],
        position_values=result["position_values"],
        total_value=result["total_portfolio_value"],
        recommendations=recommendations,
    )
    flags = groq_client.narrate_compliance_flags(flags)

    logger.info("Computed %d compliance flag(s) for %s.", len(flags), client_id)

    return {
        "client_id": client_id,
        "market_data_source": source,
        "flags": flags,
    }
