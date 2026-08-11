"""Deterministic rebalancing recommendation matcher.

Compares a client's current allocation/drift (from optimizer.py) against
their risk profile's strategy (strategies.json) and produces structured
trade suggestions to correct any bucket whose drift exceeds that strategy's
own rebalancing_threshold_pct. Pure arithmetic only — same as optimizer.py
and scenario_simulator.py. No AI/LLM is involved anywhere in this file.
groq_client.py (wired in via /insights) only narrates the suggestions this
file already computed; it never generates or adjusts them.

Rebalance-to-target methodology: once a bucket's drift exceeds the
strategy's rebalancing_threshold_pct, the correction is sized to bring that
bucket's dollar value all the way back to its target_allocation share of the
portfolio — not just back within the tolerance band. This mirrors common
real-world rebalancing practice: the threshold decides *whether* to
rebalance, the target allocation decides *how far*.

Lot-consumption order for SELLs: HIFO (Highest-cost-basis In, First Out),
not FIFO. An automated rebalancing suggestion should default to minimizing
realized taxable gain — that's the tax-conscious choice a real advisor would
make — whereas FIFO would sell the oldest (usually cheapest, highest-gain)
shares first purely by chronology, ignoring tax impact entirely. HIFO is
also what naturally surfaces small recent high-cost-basis lots first, which
is exactly the lot-level detail this phase is meant to expose.

Every consumed lot's gain is classified long-term vs. short-term using the
standard "held more than one year" rule, approximated here as > 365 days
(a real implementation would use the calendar-exact one-year mark).

Only equities/fixed_income are ticker-tradable buckets in this model; cash
drift isn't correctable via a BUY/SELL ticker suggestion, so it's excluded.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from services.holdings import total_quantity
from services.optimizer import classify_asset_class

TRADABLE_BUCKETS = ("equities", "fixed_income")

# Display-friendly bucket names for note text — bucket keys are snake_case
# internal identifiers (e.g. "fixed_income"), not meant to be shown verbatim.
_BUCKET_DISPLAY_NAME: dict[str, str] = {
    "equities": "equities",
    "fixed_income": "fixed income",
    "cash": "cash",
}

# IRS rule is "more than one year"; approximated here as a fixed 365-day
# threshold rather than a calendar-exact anniversary.
LONG_TERM_HOLDING_DAYS = 365


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _classify_term(purchase_date: str | None, as_of: date) -> str:
    """Returns "long_term" or "short_term". A missing/unparseable
    purchase_date (e.g. from an Excel upload with no date column) is
    treated as "short_term" — the more conservative (higher-tax)
    assumption when a lot's true age is unknown."""
    if not purchase_date:
        return "short_term"
    try:
        purchased = datetime.strptime(purchase_date, "%Y-%m-%d").date()
    except ValueError:
        return "short_term"
    held_days = (as_of - purchased).days
    return "long_term" if held_days > LONG_TERM_HOLDING_DAYS else "short_term"


def _positions_by_bucket(
    holdings: list[dict[str, Any]], prices: dict[str, float]
) -> dict[str, list[dict[str, Any]]]:
    """Group holdings by asset-class bucket, each annotated with live price/value."""
    buckets: dict[str, list[dict[str, Any]]] = {"equities": [], "fixed_income": []}
    for holding in holdings:
        ticker = holding["ticker"]
        price = prices.get(ticker)
        if price is None:
            raise ValueError(f"No live price available for '{ticker}'; cannot generate recommendations.")
        quantity = total_quantity(holding)
        bucket = classify_asset_class(ticker)
        buckets.setdefault(bucket, []).append(
            {**holding, "quantity": quantity, "price": price, "market_value": quantity * price}
        )
    return buckets


def generate_recommendations(
    holdings: list[dict[str, Any]],
    cash_balance: float,
    prices: dict[str, float],
    current_allocation: dict[str, float],
    target_allocation: dict[str, float],
    drift: dict[str, float],
    strategy: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return structured trade suggestions correcting any tradable bucket
    whose drift exceeds strategy["rebalancing_threshold_pct"].

    Each suggestion: {ticker, action, quantity, account_type, dollar_amount,
    note, tax_detail}. `dollar_amount` is the real executed trade value
    (quantity * price) — the same number the Allocation card's "Rebalance to
    target moves" figure sums, so the two cards never disagree about the
    same trades. `tax_detail` is populated for SELL rows only (None for
    BUY) with {long_term_gain, short_term_gain, lots: [...]}. Returns an
    empty list if every bucket is within tolerance.
    """
    threshold_pct = strategy["rebalancing_threshold_pct"]
    total_value = sum(total_quantity(h) * prices[h["ticker"]] for h in holdings) + cash_balance
    buckets = _positions_by_bucket(holdings, prices)

    recommendations: list[dict[str, Any]] = []

    for bucket in TRADABLE_BUCKETS:
        drift_pp = drift.get(bucket, 0.0) * 100
        if abs(drift_pp) <= threshold_pct:
            continue  # within the strategy's own tolerance band — no trade suggested

        target_value = target_allocation.get(bucket, 0.0) * total_value
        current_value = current_allocation.get(bucket, 0.0) * total_value
        dollar_delta = current_value - target_value  # positive = overweight (sell), negative = underweight (buy)

        if dollar_delta > 0:
            recommendations.extend(_build_sell_suggestions(bucket, dollar_delta, buckets[bucket], drift_pp))
        else:
            recommendations.extend(_build_buy_suggestion(bucket, -dollar_delta, buckets[bucket], drift_pp))

    return recommendations


def _consume_lots_hifo(lots: list[dict[str, Any]], quantity_to_sell: float) -> list[dict[str, Any]]:
    """Return the slices of `lots` consumed to cover quantity_to_sell,
    highest cost-basis-per-share lots first (HIFO). Each returned slice is
    a shallow copy of its source lot with `quantity` reduced to the amount
    actually consumed from it."""
    remaining = quantity_to_sell
    consumed: list[dict[str, Any]] = []
    for lot in sorted(lots, key=lambda lot: lot["cost_basis_per_share"], reverse=True):
        if remaining <= 0:
            break
        take = min(remaining, lot["quantity"])
        if take <= 0:
            continue
        consumed.append({**lot, "quantity": take})
        remaining -= take
    return consumed


def _build_sell_suggestions(
    bucket: str, dollar_to_sell: float, positions: list[dict[str, Any]], drift_pp: float
) -> list[dict[str, Any]]:
    """Trim the largest position(s) in an overweight bucket first, largest
    to smallest, until the needed dollar amount is covered. Trimming the
    largest position first also directly reduces the single-position
    concentration risk optimizer.py flags, not just the allocation drift.

    Within each position sold, lots are consumed HIFO (see module
    docstring) and each consumed lot's gain is classified long-term vs.
    short-term individually — a real sale can realize a mix of both.
    """
    remaining = dollar_to_sell
    suggestions: list[dict[str, Any]] = []
    as_of = _today()

    for position in sorted(positions, key=lambda p: p["market_value"], reverse=True):
        if remaining <= 0:
            break

        sell_value_cap = min(remaining, position["market_value"])
        quantity = int(sell_value_cap // position["price"])  # whole shares only, floored
        if quantity <= 0:
            continue

        consumed_lots = _consume_lots_hifo(position["lots"], quantity)
        actual_quantity = sum(lot["quantity"] for lot in consumed_lots)
        if actual_quantity <= 0:
            continue
        actual_sell_value = actual_quantity * position["price"]

        long_term_gain = 0.0
        short_term_gain = 0.0
        lot_detail = []
        for lot in consumed_lots:
            gain = round((position["price"] - lot["cost_basis_per_share"]) * lot["quantity"], 2)
            term = _classify_term(lot.get("purchase_date"), as_of)
            if term == "long_term":
                long_term_gain += gain
            else:
                short_term_gain += gain
            lot_detail.append(
                {
                    "quantity": lot["quantity"],
                    "cost_basis_per_share": lot["cost_basis_per_share"],
                    "purchase_date": lot.get("purchase_date"),
                    "term": term,
                    "gain": gain,
                }
            )

        note_parts = []
        if long_term_gain:
            note_parts.append(f"long-term gain ${long_term_gain:,.2f}")
        if short_term_gain:
            note_parts.append(f"short-term gain ${short_term_gain:,.2f}")
        gain_phrase = " and ".join(note_parts) if note_parts else "no net gain/loss"

        suggestions.append(
            {
                "ticker": position["ticker"],
                "action": "SELL",
                "quantity": actual_quantity,
                "account_type": position["account_type"],
                "dollar_amount": round(actual_sell_value, 2),
                "note": (
                    f"Est. {gain_phrase} across {len(consumed_lots)} lot(s) (HIFO). "
                    f"Corrects {_BUCKET_DISPLAY_NAME.get(bucket, bucket)} overweight (drift {drift_pp:+.1f}pp vs. target)."
                ),
                "tax_detail": {
                    "long_term_gain": round(long_term_gain, 2),
                    "short_term_gain": round(short_term_gain, 2),
                    "lots": lot_detail,
                },
            }
        )
        remaining -= actual_sell_value

    return suggestions


def _build_buy_suggestion(
    bucket: str, dollar_to_buy: float, positions: list[dict[str, Any]], drift_pp: float
) -> list[dict[str, Any]]:
    """Add to the client's largest existing position in the underweight
    bucket.

    Documented limitation: if the client holds nothing at all in this
    bucket, this returns no suggestion — producing a concrete BUY here
    would need a live price for a ticker outside the client's current
    holdings (e.g. picked from the strategy's typical_holdings), and this
    phase's market-data fetch is scoped only to the client's own tickers.
    """
    if not positions:
        return []

    target_position = max(positions, key=lambda p: p["market_value"])
    quantity = int(dollar_to_buy // target_position["price"])  # whole shares only, floored
    if quantity <= 0:
        return []

    return [
        {
            "ticker": target_position["ticker"],
            "action": "BUY",
            "quantity": quantity,
            "account_type": target_position["account_type"],
            "dollar_amount": round(quantity * target_position["price"], 2),
            "note": f"Corrects {_BUCKET_DISPLAY_NAME.get(bucket, bucket)} underweight (drift {drift_pp:+.1f}pp vs. target).",
            "tax_detail": None,
        }
    ]
