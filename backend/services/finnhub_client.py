"""Fetches live current prices from the Finnhub API (primary market data source).

Requires FINNHUB_API_KEY to be set in backend/.env.
"""
from __future__ import annotations

import os

import requests

FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote"
REQUEST_TIMEOUT_SECONDS = 5


class FinnhubError(RuntimeError):
    """Raised when Finnhub can't be used: missing key, rate limited, or request failed."""


def get_quotes(tickers: list[str]) -> dict[str, float]:
    """Return {ticker: current_price} for each ticker, via Finnhub's /quote endpoint.

    Raises FinnhubError (without fetching anything from yfinance itself — that
    fallback is the caller's responsibility) if the API key is missing, any
    request fails, is rate limited (HTTP 429), or returns no usable price.
    """
    api_key = os.getenv("FINNHUB_API_KEY", "").strip()
    if not api_key:
        raise FinnhubError("FINNHUB_API_KEY is not set in backend/.env.")

    prices: dict[str, float] = {}
    for ticker in tickers:
        try:
            response = requests.get(
                FINNHUB_QUOTE_URL,
                params={"symbol": ticker, "token": api_key},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise FinnhubError(f"Finnhub request failed for {ticker}: {exc}") from exc

        if response.status_code == 429:
            raise FinnhubError("Finnhub rate limit hit (HTTP 429).")
        if response.status_code == 401:
            raise FinnhubError("Finnhub rejected the API key (HTTP 401 — check FINNHUB_API_KEY).")
        if response.status_code != 200:
            raise FinnhubError(f"Finnhub returned HTTP {response.status_code} for {ticker}.")

        data = response.json()
        price = data.get("c")
        if not price:
            raise FinnhubError(f"Finnhub returned no current price for {ticker}.")

        prices[ticker] = float(price)

    return prices
