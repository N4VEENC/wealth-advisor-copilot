"""Shared helpers for reading tax-lot holdings.

Each holding stores a list of individual purchase lots (quantity,
cost_basis_per_share, purchase_date) rather than a single averaged
quantity/cost_basis_per_share, so real per-lot tax calculations are
possible (see services/recommendation_matcher.py). This module centralizes
the handful of "sum across lots" operations needed by services that only
care about the holding's total position, not its lot detail.
"""
from __future__ import annotations

from typing import Any


def total_quantity(holding: dict[str, Any]) -> float:
    return sum(lot["quantity"] for lot in holding["lots"])


def weighted_average_cost_basis(holding: dict[str, Any]) -> float:
    quantity = total_quantity(holding)
    if quantity <= 0:
        return 0.0
    total_cost = sum(lot["quantity"] * lot["cost_basis_per_share"] for lot in holding["lots"])
    return total_cost / quantity


def total_cost_basis(holding: dict[str, Any]) -> float:
    return sum(lot["quantity"] * lot["cost_basis_per_share"] for lot in holding["lots"])


# Real, public issuer/fund names for this demo's known ticker universe —
# reference data about real securities (not fabricated per-client data),
# same spirit as optimizer.py's _KNOWN_ASSET_CLASS lookup. Falls back to the
# ticker itself for anything outside this small demo universe.
_TICKER_NAME: dict[str, str] = {
    "AAPL": "Apple Inc.",
    "MSFT": "Microsoft Corp.",
    "VOO": "Vanguard S&P 500 ETF",
    "BND": "Vanguard Total Bond Market ETF",
}


def display_name(ticker: str) -> str:
    return _TICKER_NAME.get(ticker.upper(), ticker.upper())


def summarize_for_list(client: dict[str, Any]) -> dict[str, Any]:
    """Cheap per-client summary for the Clients list page — corpus and
    return %, without a live price fetch (the list page would otherwise
    trigger one live-price round trip per client just to render a table).
    Uses each holding's last_price (populated the last time /analysis or
    /holdings ran for that client); a holding never priced yet falls back to
    its own cost basis (0% assumed gain) rather than guessing a live price,
    so an unpriced position never fabricates a return. This is real stored
    data, just possibly a little stale until the client's Dashboard is next
    opened — not fabricated.

    A client with zero holdings has no real portfolio to summarize yet —
    corpus/return_pct come back None (never 0 or cash_balance) so the
    Clients table renders the App Flow doc's empty state instead of a
    number, even if the client has an advisor-provided target_retirement_amount."""
    holdings = client.get("holdings", [])
    has_holdings = len(holdings) > 0

    if not has_holdings:
        return {
            "has_holdings": False,
            "holdings_count": 0,
            "corpus": None,
            "return_pct": None,
        }

    cash_balance = client.get("cash_balance", 0.0)
    cost_basis_total = cash_balance
    market_value_total = cash_balance
    for holding in holdings:
        cost_basis_total += total_cost_basis(holding)
        last_price = holding.get("last_price")
        if last_price is not None:
            market_value_total += total_quantity(holding) * last_price
        else:
            market_value_total += total_cost_basis(holding)

    return_pct = (
        (market_value_total - cost_basis_total) / cost_basis_total if cost_basis_total > 0 else None
    )

    return {
        "has_holdings": True,
        "holdings_count": len(holdings),
        "corpus": round(market_value_total, 2),
        "return_pct": round(return_pct, 4) if return_pct is not None else None,
    }


def build_holdings_rows(
    holdings: list[dict[str, Any]],
    prices: dict[str, float],
    total_portfolio_value: float,
) -> list[dict[str, Any]]:
    """One row per stored holding (ticker + account_type), for the Holdings
    page table. Every figure here is plain arithmetic over real quantities/
    cost bases/live prices already used by analyze_portfolio — this does not
    duplicate or diverge from that pipeline, just presents it per-position
    instead of aggregated."""
    rows = []
    for holding in holdings:
        ticker = holding["ticker"]
        price = prices.get(ticker)
        quantity = total_quantity(holding)
        cost_basis = total_cost_basis(holding)
        market_value = quantity * price if price is not None else None
        gain_dollar = (market_value - cost_basis) if market_value is not None else None
        gain_pct = (gain_dollar / cost_basis) if gain_dollar is not None and cost_basis > 0 else None
        rows.append(
            {
                "ticker": ticker,
                "name": display_name(ticker),
                "account_type": holding["account_type"],
                "quantity": round(quantity, 4),
                "average_cost_basis_per_share": round(weighted_average_cost_basis(holding), 2),
                "cost_basis": round(cost_basis, 2),
                "current_price": price,
                "market_value": round(market_value, 2) if market_value is not None else None,
                "weight": round(market_value / total_portfolio_value, 4)
                if market_value is not None and total_portfolio_value > 0
                else None,
                "gain_dollar": round(gain_dollar, 2) if gain_dollar is not None else None,
                "gain_pct": round(gain_pct, 4) if gain_pct is not None else None,
            }
        )
    return rows
