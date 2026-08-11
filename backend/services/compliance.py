"""Rules-based (deterministic, no AI) compliance checker.

Every flag here is produced by a fixed rule against real portfolio/lot data
— nothing here is generated, judged, or worded by the AI. This mirrors the
same "AI never invents numbers" architecture as optimizer.py /
scenario_simulator.py / recommendation_matcher.py / projection.py.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# Same rule-of-thumb ceiling used by optimizer.py's health score, reused
# here as an explicit, standalone compliance flag rather than just a score
# input.
CONCENTRATION_THRESHOLD_PCT = 0.25

# IRS wash-sale rule: a loss sale is disallowed if a "substantially
# identical" security was bought within 30 days before or after the sale.
WASH_SALE_WINDOW_DAYS = 30


def _days_ago(purchase_date: str, as_of) -> int | None:
    try:
        parsed = datetime.strptime(purchase_date, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    return (as_of - parsed).days


def check_concentration(position_values: dict[str, float], total_value: float) -> list[dict[str, Any]]:
    """Flags any single ticker position exceeding CONCENTRATION_THRESHOLD_PCT
    of the total portfolio value."""
    flags = []
    for ticker, value in sorted(position_values.items(), key=lambda kv: -kv[1]):
        pct = value / total_value if total_value else 0.0
        if pct > CONCENTRATION_THRESHOLD_PCT:
            flags.append(
                {
                    "id": f"concentration-{ticker.lower()}",
                    "severity": "high" if pct > CONCENTRATION_THRESHOLD_PCT * 1.5 else "medium",
                    "category": "concentration",
                    "message": (
                        f"{ticker} is {pct:.1%} of the total portfolio, above the "
                        f"{CONCENTRATION_THRESHOLD_PCT:.0%} single-position guideline."
                    ),
                }
            )
    return flags


def check_wash_sale_risk(
    holdings: list[dict[str, Any]], recommendations: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Flags a ticker if a recommended SELL would realize a loss on at
    least one lot, AND that same ticker has a separate lot purchased within
    WASH_SALE_WINDOW_DAYS of today.

    Documented simplification: this checks purchase-date proximity across
    ALL of the ticker's lots, not specifically which lots would remain held
    after a hypothetical partial sale — the wash-sale rule is triggered by
    the mere existence of a replacement-window purchase, regardless of that
    lot's later fate, so this is a faithful (if conservative) risk flag,
    not a precise final IRS determination. A real implementation would
    need the full post-trade lot ledger and professional tax advice.
    """
    today = datetime.now(timezone.utc).date()
    flags: list[dict[str, Any]] = []
    holdings_by_ticker = {holding["ticker"]: holding for holding in holdings}

    for rec in recommendations:
        if rec["action"] != "SELL":
            continue
        tax_detail = rec.get("tax_detail")
        if not tax_detail:
            continue

        loss_lots = [lot for lot in tax_detail["lots"] if lot["gain"] < 0]
        if not loss_lots:
            continue

        ticker = rec["ticker"]
        holding = holdings_by_ticker.get(ticker)
        if not holding:
            continue

        recent_purchases = [
            lot
            for lot in holding["lots"]
            if lot.get("purchase_date")
            and (days := _days_ago(lot["purchase_date"], today)) is not None
            and 0 <= days <= WASH_SALE_WINDOW_DAYS
        ]
        if not recent_purchases:
            continue

        total_loss = sum(lot["gain"] for lot in loss_lots)
        flags.append(
            {
                "id": f"wash-sale-{ticker.lower()}",
                "severity": "medium",
                "category": "wash_sale",
                "message": (
                    f"Selling {ticker} would realize a loss of ${abs(total_loss):,.2f} on at least one lot, "
                    f"while another {ticker} lot was purchased within the last {WASH_SALE_WINDOW_DAYS} days — "
                    "this risks wash-sale disallowance of that loss under IRS rules."
                ),
            }
        )
    return flags


def standard_disclosures() -> list[dict[str, Any]]:
    """The same fictional-data / no-custodian disclosures used in generated
    reports (routers/reports.py), surfaced here as low-severity flags too."""
    return [
        {
            "id": "disclosure-demo-data",
            "severity": "low",
            "category": "disclosure",
            "message": "Fictional client data for demonstration purposes.",
        },
        {
            "id": "disclosure-no-custodian",
            "severity": "low",
            "category": "disclosure",
            "message": "No custodian API is connected in this prototype.",
        },
    ]


def compute_compliance_flags(
    holdings: list[dict[str, Any]],
    position_values: dict[str, float],
    total_value: float,
    recommendations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return every compliance flag for this client, most-severe first."""
    flags = [
        *check_concentration(position_values, total_value),
        *check_wash_sale_risk(holdings, recommendations),
        *standard_disclosures(),
    ]
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(flags, key=lambda flag: severity_rank.get(flag["severity"], 99))
