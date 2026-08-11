"""Builds the "insight facts" list that gemini_client.py's structured Cards
narration is allowed to describe (see POST /clients/{id}/insights/cards).

Every number in every fact here is already computed elsewhere in this
codebase (optimizer.py, sector_classification.py, recommendation_matcher.py)
— this module's only job is to package them and assign a *deterministic*
severity and tag, so Gemini never has any influence over severity, tags, or
any number: it only ever writes a title + one-paragraph description for a
fact it's handed, using nothing but that fact's own "numbers" dict.
"""
from __future__ import annotations

from typing import Any

# Documented, flat assumed tax rates for the "tax drag" fact — same
# assumption-not-live-data spirit as projection.py's
# ASSUMED_RETURN_DISTRIBUTION. A real implementation would need the
# client's actual marginal rate, which this app doesn't collect anywhere.
ASSUMED_LONG_TERM_TAX_RATE = 0.15
ASSUMED_SHORT_TERM_TAX_RATE = 0.32

SECTOR_CONCENTRATION_THRESHOLD_PCT = 0.25


def _drift_facts(analysis: dict[str, Any], strategy: dict[str, Any]) -> list[dict[str, Any]]:
    facts = []
    threshold_pp = strategy["rebalancing_threshold_pct"]
    for bucket, drift in analysis["drift"].items():
        drift_pp = drift * 100
        if abs(drift_pp) <= threshold_pp:
            continue
        severity = "high" if abs(drift_pp) > threshold_pp * 2 else "medium"
        direction = "above" if drift_pp > 0 else "below"
        facts.append(
            {
                "id": f"drift-{bucket}",
                "kind": "allocation_drift",
                "severity": severity,
                "numbers": {
                    "bucket": bucket,
                    "current_pct": round(analysis["current_allocation"][bucket] * 100, 1),
                    "target_pct": round(analysis["target_allocation"][bucket] * 100, 1),
                    "drift_pp": round(drift_pp, 1),
                    "band_pp": threshold_pp,
                },
                "tag": f"{drift_pp:+.1f}pp",
                "source_label": "Optimizer · drift model",
                "fallback_title": f"{bucket.replace('_', ' ').title()} is {abs(drift_pp):.1f}pp {direction} target",
                "fallback_description": (
                    f"Currently {analysis['current_allocation'][bucket] * 100:.1f}% against a "
                    f"{analysis['target_allocation'][bucket] * 100:.1f}% target, outside the {threshold_pp:.0f}pp band."
                ),
            }
        )
    return facts


def _sector_fact(sector_exposure: dict[str, Any] | None) -> dict[str, Any] | None:
    if not sector_exposure:
        return None
    technology = sector_exposure["equity_sectors"].get("Technology")
    if not technology or technology["pct_of_portfolio"] <= SECTOR_CONCENTRATION_THRESHOLD_PCT:
        return None
    pct = technology["pct_of_portfolio"]
    severity = "high" if pct > SECTOR_CONCENTRATION_THRESHOLD_PCT * 1.5 else "medium"
    return {
        "id": "sector-technology",
        "kind": "sector_concentration",
        "severity": severity,
        "numbers": {
            "sector": "Technology",
            "pct_of_portfolio": round(pct * 100, 1),
            "cap_pct": round(SECTOR_CONCENTRATION_THRESHOLD_PCT * 100, 0),
            "look_through_note": sector_exposure["look_through_note"],
        },
        "tag": f"{pct * 100:.1f}%",
        "source_label": "Sector look-through",
        "fallback_title": f"Technology is {pct * 100:.1f}% of the portfolio, above the {SECTOR_CONCENTRATION_THRESHOLD_PCT * 100:.0f}% cap",
        "fallback_description": sector_exposure["look_through_note"],
    }


def _tax_drag_fact(recommendations: list[dict[str, Any]]) -> dict[str, Any] | None:
    total_long_term_gain = sum(
        rec["tax_detail"]["long_term_gain"]
        for rec in recommendations
        if rec.get("tax_detail") and rec["tax_detail"]["long_term_gain"] > 0
    )
    total_short_term_gain = sum(
        rec["tax_detail"]["short_term_gain"]
        for rec in recommendations
        if rec.get("tax_detail") and rec["tax_detail"]["short_term_gain"] > 0
    )
    if total_long_term_gain <= 0 and total_short_term_gain <= 0:
        return None

    estimated_drag = (
        total_long_term_gain * ASSUMED_LONG_TERM_TAX_RATE + total_short_term_gain * ASSUMED_SHORT_TERM_TAX_RATE
    )
    return {
        "id": "tax-drag",
        "kind": "tax_drag",
        "severity": "low",
        "numbers": {
            "long_term_gain": round(total_long_term_gain, 2),
            "short_term_gain": round(total_short_term_gain, 2),
            "assumed_long_term_rate_pct": round(ASSUMED_LONG_TERM_TAX_RATE * 100, 0),
            "assumed_short_term_rate_pct": round(ASSUMED_SHORT_TERM_TAX_RATE * 100, 0),
            "estimated_tax_drag": round(estimated_drag, 2),
        },
        "tag": f"~${estimated_drag:,.0f} est. tax drag",
        "source_label": "Tax-lot engine · HIFO",
        "fallback_title": f"Recommended sells realize ~${estimated_drag:,.0f} of estimated tax drag",
        "fallback_description": (
            f"${total_long_term_gain:,.0f} long-term and ${total_short_term_gain:,.0f} short-term gain, at assumed "
            f"{ASSUMED_LONG_TERM_TAX_RATE * 100:.0f}%/{ASSUMED_SHORT_TERM_TAX_RATE * 100:.0f}% rates."
        ),
    }


def _post_trade_impact_fact(
    analysis: dict[str, Any], post_trade_analysis: dict[str, Any] | None
) -> dict[str, Any] | None:
    if not post_trade_analysis:
        return None
    health_delta = post_trade_analysis["health_score"] - analysis["health_score"]
    diversification_delta = post_trade_analysis["diversification_score"] - analysis["diversification_score"]
    if health_delta == 0 and diversification_delta == 0:
        return None
    return {
        "id": "post-trade-impact",
        "kind": "post_trade_impact",
        "severity": "low",
        "numbers": {
            "health_score_before": analysis["health_score"],
            "health_score_after": post_trade_analysis["health_score"],
            "health_score_delta": health_delta,
            "diversification_score_before": analysis["diversification_score"],
            "diversification_score_after": post_trade_analysis["diversification_score"],
            "diversification_score_delta": diversification_delta,
        },
        "tag": f"Δ health {health_delta:+d} pts",
        "source_label": "Post-trade simulation",
        "fallback_title": f"Accepting these trades moves the health score {health_delta:+d} pts",
        "fallback_description": (
            f"Health score would move from {analysis['health_score']} to {post_trade_analysis['health_score']}, "
            f"and diversification from {analysis['diversification_score']} to "
            f"{post_trade_analysis['diversification_score']}, if every recommended trade above is accepted."
        ),
    }


def build_insight_facts(
    analysis: dict[str, Any],
    strategy: dict[str, Any],
    recommendations: list[dict[str, Any]],
    sector_exposure: dict[str, Any] | None,
    post_trade_analysis: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Every real, deterministic fact worth narrating for this client right
    now, most-severe first. Facts with no real numbers behind them (e.g. no
    drift breach, no sector breach) simply aren't included — nothing here is
    ever backfilled with an invented placeholder."""
    facts: list[dict[str, Any]] = []
    facts.extend(_drift_facts(analysis, strategy))

    sector_fact = _sector_fact(sector_exposure)
    if sector_fact:
        facts.append(sector_fact)

    tax_fact = _tax_drag_fact(recommendations)
    if tax_fact:
        facts.append(tax_fact)

    impact_fact = _post_trade_impact_fact(analysis, post_trade_analysis)
    if impact_fact:
        facts.append(impact_fact)

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(facts, key=lambda f: severity_rank.get(f["severity"], 99))
