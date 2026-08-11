"""Deterministic portfolio optimizer.

Computes current allocation, drift vs. target, a diversification risk score,
and an investment health score from a client's stored holdings, cash
balance, live market prices, and target allocation. Pure arithmetic only —
per the TRD's hard constraint, Gemini (or any AI) never generates these
numbers; it only explains/narrates them after the fact (see Phase 6).
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from services.holdings import total_cost_basis, total_quantity

# --- Asset-class classification ---------------------------------------------
# There's no live sector/constituent data source wired up yet (that would
# require e.g. Finnhub's /stock/profile2 endpoint or similar). For this
# demo's known ticker universe we classify by a small lookup table, with a
# bond-ETF name-pattern heuristic as a fallback. Anything unrecognized
# defaults to "equities", since most individual stock tickers are equities.
_KNOWN_ASSET_CLASS: dict[str, str] = {
    "AAPL": "equities",
    "MSFT": "equities",
    "VOO": "equities",
    "BND": "fixed_income",
}
_FIXED_INCOME_NAME_HINTS = ("BND", "AGG", "TIP", "BOND", "TLT", "SHY", "IEF")

# Common industry rule-of-thumb ceiling for single-position risk. Used by
# _score_health below. Not fund-look-through aware — see its docstring.
REASONABLE_CONCENTRATION_THRESHOLD_PCT = 0.25

# Total-drift (in percentage points, summed across all 3 buckets) at or
# beyond which the health score's drift component bottoms out at 0.
MAX_MEANINGFUL_TOTAL_DRIFT_PP = 30.0

# Distinct-ticker count at which the diversification score's breadth
# component reaches full credit (100).
BREADTH_TICKER_CAP = 5


def classify_asset_class(ticker: str) -> str:
    """Return "equities" or "fixed_income" for a ticker."""
    ticker = ticker.upper()
    if ticker in _KNOWN_ASSET_CLASS:
        return _KNOWN_ASSET_CLASS[ticker]
    if any(hint in ticker for hint in _FIXED_INCOME_NAME_HINTS):
        return "fixed_income"
    return "equities"


def analyze_portfolio(
    holdings: list[dict[str, Any]],
    cash_balance: float,
    prices: dict[str, float],
    target_allocation: dict[str, float],
    cash_account_type: str = "cash",
) -> dict[str, Any]:
    """Run the full deterministic analysis for one client.

    `holdings` is the client's stored holdings list (ticker/quantity/etc.,
    per the Backend Schema doc). `prices` maps ticker -> live current price
    (from the Finnhub/yfinance market-data service). Raises ValueError if a
    holding's ticker has no matching price, or if total portfolio value is 0.
    """
    position_values: dict[str, float] = {}
    value_by_account_type: dict[str, float] = {}
    equities_value = 0.0
    fixed_income_value = 0.0
    cost_basis_total = 0.0

    for holding in holdings:
        ticker = holding["ticker"]
        price = prices.get(ticker)
        if price is None:
            raise ValueError(f"No live price available for '{ticker}'; cannot compute allocation.")

        value = total_quantity(holding) * price
        position_values[ticker] = position_values.get(ticker, 0.0) + value
        account_type = holding["account_type"]
        value_by_account_type[account_type] = value_by_account_type.get(account_type, 0.0) + value
        cost_basis_total += total_cost_basis(holding)

        if classify_asset_class(ticker) == "equities":
            equities_value += value
        else:
            fixed_income_value += value

    value_by_account_type[cash_account_type] = value_by_account_type.get(cash_account_type, 0.0) + cash_balance
    # Cash has no cost basis of its own — it contributes dollar-for-dollar
    # to invested capital, i.e. zero unrealized gain, so it's added to the
    # cost basis total at face value (not left out, which would overstate
    # the total return by treating cash balance as pure gain).
    cost_basis_total += cash_balance

    total_value = equities_value + fixed_income_value + cash_balance
    if total_value <= 0:
        raise ValueError("Portfolio total value is zero; cannot compute allocation.")

    total_return_dollar = total_value - cost_basis_total
    total_return_pct = total_return_dollar / cost_basis_total if cost_basis_total > 0 else 0.0

    current_allocation = {
        "equities": equities_value / total_value,
        "fixed_income": fixed_income_value / total_value,
        "cash": cash_balance / total_value,
    }

    drift = {
        bucket: current_allocation[bucket] - target_allocation.get(bucket, 0.0)
        for bucket in ("equities", "fixed_income", "cash")
    }

    diversification_score = _score_diversification(position_values=position_values, equities_value=equities_value)
    health_score, health_score_components = _score_health(
        drift=drift, position_values=position_values, total_value=total_value
    )

    return {
        "current_allocation": {k: round(v, 4) for k, v in current_allocation.items()},
        "target_allocation": {k: round(v, 4) for k, v in target_allocation.items()},
        "drift": {k: round(v, 4) for k, v in drift.items()},
        "diversification_score": diversification_score,
        "health_score": health_score,
        "health_score_components": health_score_components,
        "total_portfolio_value": round(total_value, 2),
        "position_values": {k: round(v, 2) for k, v in position_values.items()},
        "total_cost_basis": round(cost_basis_total, 2),
        "total_return_dollar": round(total_return_dollar, 2),
        "total_return_pct": round(total_return_pct, 4),
        "value_by_account_type": {k: round(v, 2) for k, v in value_by_account_type.items()},
    }


def _score_diversification(position_values: dict[str, float], equities_value: float) -> int:
    """Diversification risk score (0-100, higher = better diversified / lower
    concentration risk). Two weighted components:

      1. Concentration penalty (70% weight) — the largest single ticker's
         share of the *equities* bucket specifically (fixed income and cash
         are separately-managed buckets, so equities-internal concentration
         is the relevant diversification question here). 0% concentration
         (an evenly split equities book) scores 100 on this component; 100%
         concentration (all equities in one ticker) scores 0.
      2. Breadth bonus (30% weight) — rewards holding more distinct tickers
         overall, capped at BREADTH_TICKER_CAP (5) for full credit
         (diminishing returns beyond that for a 2-10-client demo portfolio).

    score = 0.7 * (1 - largest_equity_position / equities_value) * 100
          + 0.3 * min(distinct_ticker_count / 5, 1.0) * 100

    Documented limitation: this does not look through a fund's underlying
    holdings, so a broad index fund (e.g. VOO) is scored for concentration
    exactly like a single-name stock (e.g. AAPL) would be — both count as
    "one position." It also has no real sector data, so two tickers in the
    same industry aren't penalized differently from two unrelated ones.
    Both would require a market-data provider with sector/constituent data,
    which isn't wired up in this phase. This is why a portfolio can hold
    several equity tickers (e.g. AAPL, MSFT, VOO) without that alone
    guaranteeing a high score — if one of them dominates the equities
    bucket, the concentration component pulls the score back down.
    """
    if equities_value > 0:
        equity_position_values = [
            value for ticker, value in position_values.items() if classify_asset_class(ticker) == "equities"
        ]
        largest_equity_position = max(equity_position_values, default=0.0)
        equities_concentration = largest_equity_position / equities_value
    else:
        equities_concentration = 0.0

    concentration_component = (1 - equities_concentration) * 100
    breadth_component = min(len(position_values) / BREADTH_TICKER_CAP, 1.0) * 100

    score = 0.7 * concentration_component + 0.3 * breadth_component
    return round(max(0.0, min(100.0, score)))


def _score_health(
    drift: dict[str, float],
    position_values: dict[str, float],
    total_value: float,
) -> tuple[int, dict[str, int]]:
    """Investment health score (0-100, higher = healthier). Two weighted
    components:

      1. Allocation-drift component (60% weight) — total absolute drift
         across all three buckets, in percentage points, normalized against
         MAX_MEANINGFUL_TOTAL_DRIFT_PP (30pp). 0 total drift scores 100;
         drift at or beyond the ceiling scores 0.
      2. Concentration-threshold component (40% weight) — flags whether any
         single position exceeds REASONABLE_CONCENTRATION_THRESHOLD_PCT (25%)
         of the *total portfolio* value, a common industry rule-of-thumb
         ceiling for single-position risk. Scores 100 if no position breaches
         the threshold, decaying linearly to 0 as the largest position's
         share climbs from the threshold to 100% of the portfolio.

    score = 0.6 * max(0, 100 - (total_drift_pp / 30) * 100)
          + 0.4 * (100 if largest_position_pct <= 0.25
                    else 100 * (1 - (largest_position_pct - 0.25) / 0.75))

    Shares the same fund-look-through limitation documented in
    `_score_diversification` above.
    """
    total_drift_pp = sum(abs(v) for v in drift.values()) * 100
    drift_component = max(0.0, 100 - (total_drift_pp / MAX_MEANINGFUL_TOTAL_DRIFT_PP) * 100)

    largest_position_pct = (max(position_values.values(), default=0.0) / total_value) if total_value > 0 else 0.0
    if largest_position_pct <= REASONABLE_CONCENTRATION_THRESHOLD_PCT:
        concentration_component = 100.0
    else:
        headroom = 1.0 - REASONABLE_CONCENTRATION_THRESHOLD_PCT
        overage = largest_position_pct - REASONABLE_CONCENTRATION_THRESHOLD_PCT
        concentration_component = max(0.0, 100 * (1 - overage / headroom))

    score = 0.6 * drift_component + 0.4 * concentration_component
    return round(max(0.0, min(100.0, score))), {
        "allocation_drift": round(drift_component),
        "concentration": round(concentration_component),
    }


def simulate_post_trade_scores(
    holdings: list[dict[str, Any]],
    cash_balance: float,
    prices: dict[str, float],
    target_allocation: dict[str, float],
    recommendations: list[dict[str, Any]],
    cash_account_type: str = "cash",
) -> dict[str, Any] | None:
    """Re-run analyze_portfolio on a hypothetical *post-trade* holdings
    snapshot built by literally applying every recommended SELL/BUY —
    consuming the exact same lots recommendation_matcher.py already chose
    (HIFO) for SELLs, and adding a new lot at today's live price for BUYs.

    This exists to give the AI recommendations "Cards" view a real,
    deterministic "if these trades were accepted" score delta (e.g. a real
    "Δ health +6 pts" tag) instead of an invented number — it's never shown
    as the client's actual current state, only used to compute that delta.
    Returns None if there are no recommendations to simulate.
    """
    if not recommendations:
        return None

    holdings_by_ticker = {h["ticker"]: copy.deepcopy(h) for h in holdings}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for rec in recommendations:
        holding = holdings_by_ticker.get(rec["ticker"])
        if holding is None:
            continue

        if rec["action"] == "SELL" and rec.get("tax_detail"):
            consumed = [(lot["cost_basis_per_share"], lot.get("purchase_date")) for lot in rec["tax_detail"]["lots"]]
            remaining_to_remove = {key: rec["tax_detail"]["lots"][i]["quantity"] for i, key in enumerate(consumed)}
            for lot in holding["lots"]:
                key = (lot["cost_basis_per_share"], lot.get("purchase_date"))
                take = remaining_to_remove.get(key, 0)
                if take:
                    lot["quantity"] -= take
            holding["lots"] = [lot for lot in holding["lots"] if lot["quantity"] > 0]
        elif rec["action"] == "BUY":
            price = prices.get(rec["ticker"])
            if price is not None:
                holding["lots"].append(
                    {"quantity": rec["quantity"], "cost_basis_per_share": price, "purchase_date": today}
                )

    post_trade_holdings = list(holdings_by_ticker.values())
    return analyze_portfolio(
        holdings=post_trade_holdings,
        cash_balance=cash_balance,
        prices=prices,
        target_allocation=target_allocation,
        cash_account_type=cash_account_type,
    )
