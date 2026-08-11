"""POST /clients/{id}/reports, GET /reports/{id}, PATCH /reports/{id}/approve.

Assembles a shareable report from the same deterministic + AI pipeline
as /insights (services/insights_service.py), plus an illustrative
current-vs-target growth projection (services/projection.py). Reports start
at status "draft" and are not final/shareable until explicitly approved via
PATCH /reports/{id}/approve — the human-in-the-loop compliance gate named
throughout the PRD/TRD/App Flow docs.

Report generation does not itself write to the audit log for the default
case — per the Implementation Plan, audit logging is scoped to POST
/clients/{id}/insights. The ONE exception: attaching flagged chat notes
(below) is itself a real disclosure-worthy event, so that specific action
gets its own audit-log entry — but only when it actually happens.

Chat independence: generate_report() takes an OPTIONAL `flagged_message_ids`
list. Left empty (the default — every existing caller, and every call this
app made before this feature existed), this function's code path never
imports or calls into services/chat_service, exactly as before — the hard
"reports never depend on chat" boundary from the original design still
holds. `services.chat_service` is only ever imported below, inside the
`if flagged_message_ids:` branch, specifically so that omission is enforced
by the code structure, not just by convention.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import audit_log, compliance, groq_client, projection
from services.client_store import ClientNotFoundError, StrategyNotFoundError
from services.insights_service import compute_deterministic_analysis
from services.market_data_service import MarketDataUnavailableError
from services.report_store import ReportNotFoundError, list_reports, load_report, next_report_id, save_report

logger = logging.getLogger(__name__)

router = APIRouter()

# Matches the Backend Schema doc's own example disclosures verbatim.
DISCLOSURES = [
    "Fictional client data for demonstration purposes.",
    "No custodian API is connected in this prototype.",
]


class GenerateReportRequest(BaseModel):
    # Advisor-selected, opt-in — see module docstring. Empty by default, and
    # every existing caller (no body at all, or an empty `{}`) resolves to
    # this same default, so nothing about today's behavior changes for them.
    flagged_message_ids: list[str] = []


@router.post("/clients/{client_id}/reports")
def generate_report(client_id: str, payload: GenerateReportRequest | None = None) -> dict:
    flagged_message_ids = payload.flagged_message_ids if payload is not None else []

    try:
        result = compute_deterministic_analysis(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StrategyNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MarketDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    client = result["client"]
    analysis = result["analysis"]

    monte_carlo = projection.run_monte_carlo_projection(
        total_portfolio_value=analysis["total_portfolio_value"],
        current_allocation=analysis["current_allocation"],
        target_allocation=analysis["target_allocation"],
        annual_contribution=client.get("annual_contribution", 0.0),
        goal_year=client["goal_year"],
        goal_amount=projection.resolve_goal_amount(client),
    )

    # Real compliance flags, same rules-based check the Dashboard's
    # ComplianceCard runs — standard_disclosures() flags are excluded here
    # since this report already has its own dedicated `disclosures` section
    # below; showing the same two sentences twice would be redundant.
    all_flags = compliance.compute_compliance_flags(
        holdings=client["holdings"],
        position_values=analysis["position_values"],
        total_value=analysis["total_portfolio_value"],
        recommendations=result["recommendations"],
    )
    compliance_flags = [flag for flag in all_flags if flag["category"] != "disclosure"]

    # The report needs two independent AI calls — the main narrative and
    # the compliance-flag narration — neither of which depends on the
    # other's output, only on the deterministic analysis/recommendations
    # already computed above. Firing them concurrently instead of one after
    # the other roughly halves the AI-call portion of report generation's
    # latency (measured ~1.2-1.4s per real AI round-trip in this repo,
    # so two sequential calls cost ~2.5s+ versus ~1.3s run together).
    with ThreadPoolExecutor(max_workers=2) as pool:
        narrative_future = pool.submit(
            groq_client.generate_narrative, analysis=analysis, recommendations=result["recommendations"]
        )
        compliance_future = pool.submit(groq_client.narrate_compliance_flags, compliance_flags)

        try:
            narrative = narrative_future.result()
            narrative_error = None
        except groq_client.GroqError as exc:
            narrative = None
            narrative_error = str(exc)
        compliance_flags = compliance_future.result()

    if narrative is None:
        # Unlike the Dashboard's /insights endpoint, a client-facing report
        # is not useful without its narrative, so this is the one place
        # that still turns an AI-narration failure into a hard error. The
        # real exception (narrative_error, which can carry raw provider/HTTP
        # detail) is logged here for debugging — the advisor only ever sees
        # a generic message, never the provider name or raw error text.
        logger.error("AI narrative generation failed for %s: %s", client_id, narrative_error)
        raise HTTPException(status_code=503, detail="Something went wrong generating this report, please try again.")

    # See module docstring: this import only happens when an advisor has
    # actually opted in to attaching notes — the default (empty) case never
    # touches chat_service at all.
    advisor_notes: list[dict] | None = None
    if flagged_message_ids:
        from services import chat_service

        notes = chat_service.get_flagged_messages_by_ids(client_id, flagged_message_ids)
        advisor_notes = [
            {
                "id": note["id"],
                "content": note["content"],
                "created_at": note["created_at"],
                "flagged_at": note["flagged_at"],
                "prompted_by": note["prompted_by"],
                # Frozen verbatim into the snapshot, matching exactly what
                # the report view/PDF renders next to each note — the
                # disclosure travels with the data, not just the UI.
                "label": "AI estimate — reviewed by advisor, not a verified calculation",
            }
            for note in notes
        ]

    report = {
        "id": next_report_id(),
        "client_id": client_id,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "draft",
        "approved_at": None,
        "currency_display": "USD",
        "content": {
            "total_portfolio_value": analysis["total_portfolio_value"],
            "total_cost_basis": analysis["total_cost_basis"],
            "total_return_dollar": analysis["total_return_dollar"],
            "total_return_pct": analysis["total_return_pct"],
            "value_by_account_type": analysis["value_by_account_type"],
            "scores": {
                "diversification": analysis["diversification_score"],
                "health": analysis["health_score"],
            },
            "allocation": {
                "current": analysis["current_allocation"],
                "target": analysis["target_allocation"],
            },
            "projection_chart_data": monte_carlo["projection_chart_data"],
            "monte_carlo": {
                "path_count": monte_carlo["path_count"],
                "goal_amount": monte_carlo["goal_amount"],
                # Frozen at generation time, same as every other figure in
                # this report — if the advisor sets/changes/clears
                # target_retirement_amount later, this report keeps
                # reflecting whichever case was true when it was generated.
                "goal_amount_source": monte_carlo["goal_amount_source"],
                "probability_of_reaching_goal": monte_carlo["probability_of_reaching_goal"],
            },
            # Every recommended trade, each carrying the advisor's real
            # accepted/dismissed/pending decision (see insights_service.py).
            "recommended_trades": result["recommendations"],
            "compliance_flags": compliance_flags,
            "ai_narrative": narrative,
            "disclosures": DISCLOSURES,
            # Only present at all when the advisor actually attached
            # something — omitted (not an empty list) for every default,
            # zero-notes report, so old and new reports' content shapes
            # only differ when this feature was actually used.
            **({"advisor_notes": advisor_notes} if advisor_notes else {}),
        },
    }
    save_report(report)

    if advisor_notes:
        # A real, disclosure-worthy event distinct from ordinary report
        # generation (which doesn't write to the audit log at all, see
        # module docstring) — an advisor chose to attach unverified AI
        # estimates to a client-facing document, and that choice itself
        # belongs in the compliance trail.
        audit_log.append_entry(
            client_id=client_id,
            action="report_advisor_notes_attached",
            inputs_used={"report_id": report["id"], "flagged_message_ids": [note["id"] for note in advisor_notes]},
            deterministic_outputs={"attached_count": len(advisor_notes)},
            ai_output_summary=f"Attached {len(advisor_notes)} advisor-reviewed note(s) to report {report['id']}.",
        )

    logger.info(
        "Generated report %s for %s (status=draft, %d advisor note(s) attached).",
        report["id"],
        client_id,
        len(advisor_notes) if advisor_notes else 0,
    )

    return report


@router.get("/reports")
def get_reports(client_id: str | None = None) -> dict:
    return {"reports": list_reports(client_id)}


@router.get("/reports/{report_id}")
def get_report(report_id: str) -> dict:
    try:
        return load_report(report_id)
    except ReportNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/reports/{report_id}/approve")
def approve_report(report_id: str) -> dict:
    try:
        report = load_report(report_id)
    except ReportNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    report["status"] = "approved"
    report["approved_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    save_report(report)

    logger.info("Approved report %s.", report_id)

    return report
