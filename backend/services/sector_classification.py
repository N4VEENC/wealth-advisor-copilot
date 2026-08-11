"""Sector look-through classification and blended portfolio sector exposure.

Real fund look-through (a fund's actual current constituent weights) would
need a market-data provider with holdings-based sector data (e.g. a fund
factsheet API), which isn't wired up in this build. Every fund below is
instead approximated using a static, documented snapshot of commonly-cited
sector composition — NOT live data. Anywhere this is surfaced, it must be
labeled "approximate index composition" so the approximation is visible
rather than silently presented as precise, per the same "no invented
numbers" spirit as optimizer.py — this isn't invented, but it IS a
snapshot, and that limitation must stay visible.

Direct-stock sector assignments below follow GICS sector conventions (the
same taxonomy the fund weight snapshots below use), not colloquial "tech
company" labels — e.g. Alphabet and Verizon are Communication Services,
Amazon and Tesla are Consumer Discretionary, not Technology, matching how
S&P/MSCI actually classify them.
"""
from __future__ import annotations

from typing import Any

from services.holdings import total_quantity

# Direct sector classification for individual-stock tickers in this demo's
# known universe. GICS-style categories, matching the fund weight snapshots
# below so a direct holding and a fund's look-through contribution land in
# the same bucket names.
DIRECT_TICKER_SECTOR: dict[str, str] = {
    "AAPL": "Technology",
    "MSFT": "Technology",
    "NVDA": "Technology",
    "GOOGL": "Communication Services",  # Alphabet — GICS Communication Services, not Technology
    "AMZN": "Consumer Discretionary",  # GICS Consumer Discretionary, not Technology
    "TSLA": "Consumer Discretionary",  # auto manufacturer — GICS Consumer Discretionary
    "JNJ": "Healthcare",
    "UNH": "Healthcare",
    "PG": "Consumer Staples",
    "KO": "Consumer Staples",
    "VZ": "Communication Services",  # telecom — GICS Communication Services
    "XOM": "Energy",
    "JPM": "Financials",
}

# Bond funds/ETFs, not an equity sector at all — kept out of
# DIRECT_TICKER_SECTOR and handled as their own non-equity bucket, per the
# instruction to flag them distinctly rather than lump them in with
# "sectors."
NON_EQUITY_TICKER_BUCKET: dict[str, str] = {
    "BND": "Fixed Income",
    "AGG": "Fixed Income",
}

# Approximate sector weights per broad fund/ETF — static, illustrative
# snapshots of commonly-cited sector composition (~2024-2025 vintage), NOT
# live look-through data. Each sums to 1.0. Same documented-approximation
# pattern as VOO's original snapshot, extended per-fund since a Nasdaq-100
# fund, a dividend-tilted fund, and an ex-US fund each have genuinely
# different real sector compositions — reusing one fund's weights for
# another would be a worse approximation than giving each its own.
FUND_APPROXIMATE_SECTOR_WEIGHTS: dict[str, dict[str, float]] = {
    # S&P 500 — broad large-cap US.
    "VOO": {
        "Technology": 0.32,
        "Financials": 0.13,
        "Healthcare": 0.11,
        "Consumer Discretionary": 0.10,
        "Communication Services": 0.09,
        "Industrials": 0.08,
        "Consumer Staples": 0.06,
        "Energy": 0.04,
        "Utilities": 0.03,
        "Real Estate": 0.02,
        "Materials": 0.02,
    },
    # Nasdaq-100 — mega-cap growth/tech concentrated, materially more
    # Technology-heavy than the S&P 500.
    "QQQ": {
        "Technology": 0.50,
        "Communication Services": 0.16,
        "Consumer Discretionary": 0.14,
        "Healthcare": 0.06,
        "Consumer Staples": 0.05,
        "Industrials": 0.05,
        "Financials": 0.02,
        "Utilities": 0.01,
        "Materials": 0.005,
        "Energy": 0.005,
    },
    # Total US stock market — broader than the S&P 500 (includes mid/small
    # caps), but still large-cap-dominated by weight, so its sector mix
    # sits close to VOO's with a slightly smaller Technology concentration.
    "VTI": {
        "Technology": 0.30,
        "Financials": 0.14,
        "Healthcare": 0.12,
        "Consumer Discretionary": 0.10,
        "Industrials": 0.09,
        "Communication Services": 0.08,
        "Consumer Staples": 0.06,
        "Energy": 0.04,
        "Real Estate": 0.03,
        "Utilities": 0.02,
        "Materials": 0.02,
    },
    # Total international ex-US (developed + emerging) — real-world
    # composition is meaningfully less Technology-concentrated and more
    # Financials/Industrials-weighted than the US market. This app has no
    # geography dimension of its own, so an international fund's exposure
    # still lands in these same GICS-style sector buckets, just with a
    # different real-world weighting than a US fund would have.
    "VXUS": {
        "Financials": 0.20,
        "Industrials": 0.13,
        "Technology": 0.12,
        "Consumer Discretionary": 0.11,
        "Healthcare": 0.09,
        "Consumer Staples": 0.08,
        "Materials": 0.07,
        "Communication Services": 0.06,
        "Energy": 0.06,
        "Utilities": 0.04,
        "Real Estate": 0.04,
    },
    # Dividend-tilted large-cap value (e.g. Schwab US Dividend Equity) —
    # historically underweight Technology, overweight Financials/
    # Healthcare/Industrials/Consumer Staples relative to the broad market.
    "SCHD": {
        "Financials": 0.19,
        "Healthcare": 0.15,
        "Industrials": 0.14,
        "Consumer Staples": 0.12,
        "Technology": 0.09,
        "Energy": 0.09,
        "Consumer Discretionary": 0.08,
        "Communication Services": 0.06,
        "Materials": 0.04,
        "Utilities": 0.03,
        "Real Estate": 0.01,
    },
    # High-dividend-yield large-cap (e.g. Vanguard High Dividend Yield) —
    # same dividend-tilt direction as SCHD (underweight Technology,
    # overweight Financials/Consumer Staples/Healthcare), distinct enough
    # in degree from SCHD to warrant its own snapshot rather than reuse.
    "VYM": {
        "Financials": 0.20,
        "Healthcare": 0.14,
        "Consumer Staples": 0.13,
        "Industrials": 0.12,
        "Technology": 0.09,
        "Energy": 0.08,
        "Consumer Discretionary": 0.07,
        "Utilities": 0.06,
        "Communication Services": 0.05,
        "Materials": 0.04,
        "Real Estate": 0.02,
    },
}

LOOK_THROUGH_TICKERS = frozenset(FUND_APPROXIMATE_SECTOR_WEIGHTS.keys())

LOOK_THROUGH_NOTE = (
    "Fund positions (VOO, QQQ, VTI, VXUS, SCHD, VYM) use an approximate, static "
    "index-composition snapshot per fund (documented in services/sector_classification.py), "
    "not live fund look-through data."
)


def position_sector_breakdown(ticker: str, value: float) -> dict[str, float]:
    """Split one position's dollar value into sector contributions — the
    same look-through logic compute_sector_exposure applies across a whole
    portfolio, factored out so other services can apply a sector-scoped
    effect to just a fund's PARTIAL exposure to that sector (e.g.
    scenario_simulator's sector-specific shocks: a VOO position isn't 100%
    Technology, so a "tech selloff" scenario should only shock VOO's ~32%
    Technology-weighted slice of its value, not all of it). Returns
    {"Fixed Income": value} for a bond fund, {sector: value} for a direct
    stock, a weighted split for a look-through fund, or
    {"Unclassified": value} for anything outside this demo's known
    universe.
    """
    ticker = ticker.upper()
    if ticker in NON_EQUITY_TICKER_BUCKET:
        return {NON_EQUITY_TICKER_BUCKET[ticker]: value}
    if ticker in FUND_APPROXIMATE_SECTOR_WEIGHTS:
        return {sector: value * weight for sector, weight in FUND_APPROXIMATE_SECTOR_WEIGHTS[ticker].items()}
    if ticker in DIRECT_TICKER_SECTOR:
        return {DIRECT_TICKER_SECTOR[ticker]: value}
    return {"Unclassified": value}


def compute_sector_exposure(
    holdings: list[dict[str, Any]],
    prices: dict[str, float],
    cash_balance: float,
) -> dict[str, Any]:
    """Return blended sector exposure across the whole portfolio (direct
    holdings + each fund's approximate look-through weights combined), plus
    the non-equity Fixed Income and Cash buckets kept separate from true
    equity sectors. Raises ValueError if a holding's ticker has no matching
    price.
    """
    sector_totals: dict[str, float] = {}
    non_equity_totals: dict[str, float] = {"Fixed Income": 0.0, "Cash": float(cash_balance)}

    for holding in holdings:
        ticker = holding["ticker"]
        price = prices.get(ticker)
        if price is None:
            raise ValueError(f"No live price available for '{ticker}'; cannot compute sector exposure.")
        value = total_quantity(holding) * price

        for sector, sector_value in position_sector_breakdown(ticker, value).items():
            if sector == "Fixed Income":
                non_equity_totals[sector] = non_equity_totals.get(sector, 0.0) + sector_value
            else:
                sector_totals[sector] = sector_totals.get(sector, 0.0) + sector_value

    total_value = sum(sector_totals.values()) + sum(non_equity_totals.values())
    if total_value <= 0:
        raise ValueError("Portfolio total value is zero; cannot compute sector exposure.")

    return {
        "total_portfolio_value": round(total_value, 2),
        "equity_sectors": {
            sector: {"value": round(value, 2), "pct_of_portfolio": round(value / total_value, 4)}
            for sector, value in sorted(sector_totals.items(), key=lambda kv: -kv[1])
        },
        "non_equity": {
            bucket: {"value": round(value, 2), "pct_of_portfolio": round(value / total_value, 4)}
            for bucket, value in non_equity_totals.items()
        },
        "look_through_note": LOOK_THROUGH_NOTE,
    }
