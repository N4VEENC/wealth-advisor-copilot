"""Append-only compliance/audit trail — backed by the SQLite database's
audit_log table (see database.py/models.py) rather than a single JSON file.

Every AI-generated recommendation (POST /clients/{id}/insights) appends one
entry here recording exactly which deterministic numbers and which strategy
fed it — the compliance/audit trail required by the PRD and shaped exactly
per the Backend Schema doc.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from database import session_scope
from models import AuditLogEntry

# A DB transaction alone doesn't stop two concurrent /insights calls (e.g.
# React StrictMode's dev-mode double-invoke) from both computing the same
# "next id" before either commits — same race the old file-based version's
# docstring described, still real with SQLite's single-writer model. This
# lock serializes the count-then-insert critical section exactly like the
# old version's threading.Lock did.
_LOCK = threading.Lock()


def append_entry(
    client_id: str,
    action: str,
    inputs_used: dict[str, Any],
    deterministic_outputs: dict[str, Any],
    ai_output_summary: str,
) -> dict[str, Any]:
    """Append and persist one audit-log entry (advisor_action starts null —
    Phase 8 populates it when the advisor accepts/dismisses trades in the
    UI). Returns the entry that was written."""
    with _LOCK:
        with session_scope() as session:
            next_id = f"audit-{session.query(AuditLogEntry).count() + 1:04d}"
            entry = AuditLogEntry(
                id=next_id,
                client_id=client_id,
                timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                action=action,
                inputs_used=inputs_used,
                deterministic_outputs=deterministic_outputs,
                ai_output_summary=ai_output_summary,
                advisor_action=None,
            )
            session.add(entry)
            session.flush()
            return {
                "id": entry.id,
                "client_id": entry.client_id,
                "timestamp": entry.timestamp,
                "action": entry.action,
                "inputs_used": entry.inputs_used,
                "deterministic_outputs": entry.deterministic_outputs,
                "ai_output_summary": entry.ai_output_summary,
                "advisor_action": entry.advisor_action,
            }
