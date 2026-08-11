"""Read/write access to generated reports — backed by the SQLite database
(see database.py/models.py) rather than per-report JSON files."""
from __future__ import annotations

from typing import Any

from database import session_scope
from models import Report


class ReportNotFoundError(LookupError):
    """Raised when no stored report exists for a given report id."""


def _report_to_dict(report: Report) -> dict[str, Any]:
    return {
        "id": report.id,
        "client_id": report.client_id,
        "generated_at": report.generated_at,
        "status": report.status,
        "approved_at": report.approved_at,
        "currency_display": report.currency_display,
        "content": report.content,
    }


def next_report_id() -> str:
    with session_scope() as session:
        existing_nums = []
        for (report_id,) in session.query(Report.id).all():
            try:
                existing_nums.append(int(report_id.split("-")[1]))
            except (IndexError, ValueError):
                continue
        return f"report-{max(existing_nums, default=0) + 1:04d}"


def save_report(report: dict[str, Any]) -> None:
    with session_scope() as session:
        row = session.query(Report).filter_by(id=report["id"]).one_or_none()
        if row is None:
            row = Report(id=report["id"])
            session.add(row)
        row.client_id = report["client_id"]
        row.generated_at = report["generated_at"]
        row.status = report["status"]
        row.approved_at = report.get("approved_at")
        row.currency_display = report.get("currency_display", "USD")
        row.content = report["content"]


def load_report(report_id: str) -> dict[str, Any]:
    with session_scope() as session:
        row = session.query(Report).filter_by(id=report_id).one_or_none()
        if row is None:
            raise ReportNotFoundError(f"Report '{report_id}' not found.")
        return _report_to_dict(row)


def list_reports(client_id: str | None = None) -> list[dict[str, Any]]:
    """Every stored report, optionally filtered by client_id, newest first."""
    with session_scope() as session:
        query = session.query(Report)
        if client_id is not None:
            query = query.filter_by(client_id=client_id)
        reports = [_report_to_dict(row) for row in query.all()]
    return sorted(reports, key=lambda report: report["generated_at"], reverse=True)


def delete_report(report_id: str) -> None:
    """Used only by DELETE /clients/{id}?force=true — removing a client's
    own referencing reports is the one case this app deliberately allows
    report data to be destroyed, and only on the advisor's explicit,
    force-confirmed request (see routers/clients.py's delete_client)."""
    with session_scope() as session:
        row = session.query(Report).filter_by(id=report_id).one_or_none()
        if row is not None:
            session.delete(row)
