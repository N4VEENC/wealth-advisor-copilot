"""GET /clients/{id}/market-data — live prices for a client's holdings.

Tries Finnhub first (primary); on any failure, error, or rate limit, falls
back to yfinance automatically (see services/market_data_service.py). Does
not persist fetched prices into the client's stored JSON record — that
happens in GET /clients/{id}/analysis (Phase 4), which needs the prices for
its own calculations anyway.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from services.client_store import ClientNotFoundError, load_client
from services.market_data_service import MarketDataUnavailableError, fetch_prices_with_fallback

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/clients/{client_id}/market-data")
def get_market_data(client_id: str) -> dict:
    try:
        client = load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    tickers = sorted({holding["ticker"] for holding in client.get("holdings", [])})
    if not tickers:
        return {"client_id": client_id, "source": None, "prices": {}}

    try:
        prices, source = fetch_prices_with_fallback(tickers)
    except MarketDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}") from exc

    logger.info("Served market data for %s via %s: %s", client_id, source, list(prices.keys()))

    return {
        "client_id": client_id,
        "source": source,
        "prices": prices,
    }
