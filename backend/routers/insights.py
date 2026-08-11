"""POST /clients/{id}/insights — AI-narrated plain-language insight,
plus an append-only compliance/audit-log entry for this recommendation
generation event (Backend Schema doc).

Runs the shared optimizer -> recommendation_matcher -> groq_client
pipeline (services/insights_service.py), then records exactly which
deterministic numbers and which strategy fed the AI narrative into
backend/data/audit_log.json.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from services import audit_log
from services.client_store import ClientNotFoundError, StrategyNotFoundError
from services.insights_service import compute_insights, compute_structured_insights
from services.market_data_service import MarketDataUnavailableError

logger = logging.getLogger(__name__)

router = APIRouter()


def _summarize_narrative(narrative: str, max_len: int = 220) -> str:
    """Deterministic truncation of the AI's own narrative text for the audit
    log's ai_output_summary field — NOT a second AI call, just plain string
    handling. Takes the first sentence if it's short enough, otherwise a
    character-capped truncation."""
    stripped = " ".join(narrative.split())
    period_index = stripped.find(". ")
    if 0 < period_index <= max_len:
        return stripped[: period_index + 1]
    return (stripped[:max_len] + "...") if len(stripped) > max_len else stripped


@router.post("/clients/{client_id}/insights")
def generate_insights(client_id: str) -> dict:
    try:
        result = compute_insights(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StrategyNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MarketDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    analysis = result["analysis"]
    narrative = result["narrative"]
    narrative_error = result["narrative_error"]

    # Recommendations are deterministic and were already computed even if
    # narration failed, so the audit trail still records this event — the
    # summary just notes the AI narration was unavailable instead of
    # silently omitting the entry (App Flow doc: the app must never block
    # on the AI call, and every recommendation-generation event is logged).
    audit_log.append_entry(
        client_id=client_id,
        action="recommendation_generated",
        inputs_used={
            "holdings_snapshot_id": result["client"].get("uploaded_at"),
            "market_data_timestamp": result["fetched_at"],
            "strategy_id": result["strategy"]["id"],
        },
        deterministic_outputs={
            "diversification_score": analysis["diversification_score"],
            "health_score": analysis["health_score"],
            "drift": analysis["drift"],
        },
        ai_output_summary=(
            _summarize_narrative(narrative) if narrative else f"AI narrative unavailable: {narrative_error}"
        ),
    )

    logger.info("Generated insights for %s using %s prices.", client_id, result["source"])

    return {
        "client_id": client_id,
        "market_data_source": result["source"],
        "as_of": result["fetched_at"],
        "analysis": analysis,
        "recommendations": result["recommendations"],
        "narrative": narrative,
        "narrative_error": narrative_error,
    }


@router.post("/clients/{client_id}/insights/cards")
def generate_structured_insights(client_id: str) -> dict:
    """Lazy-loaded by the frontend only when the advisor opens the AI
    recommendations panel's "Cards" tab — not fetched on every dashboard
    load, since it costs a second AI call beyond POST /insights. See
    services/insights_service.py's compute_structured_insights."""
    try:
        result = compute_structured_insights(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StrategyNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MarketDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "client_id": client_id,
        "market_data_source": result["source"],
        "cards": result["cards"],
        "insights_error": result["insights_error"],
    }
