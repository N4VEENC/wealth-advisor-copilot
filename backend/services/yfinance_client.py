"""Fetches current prices via the yfinance library (fallback market data
source — no API key required).
"""
from __future__ import annotations

import yfinance as yf


class YFinanceError(RuntimeError):
    """Raised when yfinance can't provide a price for one or more tickers."""


def get_quotes(tickers: list[str]) -> dict[str, float]:
    """Return {ticker: current_price} for each ticker, via yfinance's fast_info."""
    prices: dict[str, float] = {}
    for ticker in tickers:
        try:
            price = yf.Ticker(ticker).fast_info["lastPrice"]
        except Exception as exc:
            raise YFinanceError(f"yfinance failed for {ticker}: {exc}") from exc

        if not price:
            raise YFinanceError(f"yfinance returned no price for {ticker}.")

        prices[ticker] = float(price)

    return prices
