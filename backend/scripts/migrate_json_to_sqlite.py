"""ONE-TIME migration: reads every real JSON file under backend/data/ and
inserts it into the new SQLite database (backend/data/wealth_advisor.db).

Run once, from backend/, after `alembic upgrade head` has created the empty
schema:

    ./venv/Scripts/python.exe scripts/migrate_json_to_sqlite.py

Refuses to run if the clients table already has rows (this script is not
idempotent and is not meant to be re-run against a populated database).
Does not delete or modify any of the original JSON files — this is a read
from JSON, write to SQLite operation only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import session_scope  # noqa: E402
from models import AppMeta, AuditLogEntry, ChatMessage, ChatState, Client, HoldingLot, Report, Strategy  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CLIENTS_DIR = DATA_DIR / "clients"
REPORTS_DIR = DATA_DIR / "reports"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def migrate_strategies(session) -> int:
    data = _load_json(DATA_DIR / "strategies.json")
    count = 0
    for s in data["strategies"]:
        session.add(
            Strategy(
                id=s["id"],
                label=s["label"],
                target_allocation=s["target_allocation"],
                rebalancing_threshold_pct=s["rebalancing_threshold_pct"],
                typical_holdings=s["typical_holdings"],
            )
        )
        count += 1
    return count


def migrate_clients_and_related(session) -> dict:
    index = _load_json(CLIENTS_DIR / "index.json")
    session.add(AppMeta(key="next_client_number", value=str(index["next_client_number"])))

    counts = {"clients": 0, "holding_lots": 0, "chat_messages": 0, "chat_states": 0}

    for entry in index["clients"]:
        client_id = entry["id"]
        client_data = _load_json(CLIENTS_DIR / f"{client_id}.json")

        session.add(
            Client(
                id=client_data["id"],
                name=client_data["name"],
                email=client_data.get("email"),
                age=client_data.get("age"),
                risk_profile=client_data["risk_profile"],
                goal_year=client_data["goal_year"],
                annual_contribution=client_data.get("annual_contribution", 0.0),
                cash_balance=client_data.get("cash_balance", 0.0),
                cash_account_type=client_data.get("cash_account_type", "taxable"),
                target_allocation=client_data["target_allocation"],
                accounts_note=client_data.get("accounts_note"),
                notes=client_data.get("notes"),
                target_retirement_amount=client_data.get("target_retirement_amount"),
                holdings_source=client_data.get("holdings_source"),
                original_filename=client_data.get("original_filename"),
                uploaded_at=client_data.get("uploaded_at"),
                trade_decisions=client_data.get("trade_decisions", {}),
            )
        )
        counts["clients"] += 1

        for holding in client_data.get("holdings", []):
            for lot in holding["lots"]:
                session.add(
                    HoldingLot(
                        client_id=client_id,
                        ticker=holding["ticker"],
                        account_type=holding["account_type"],
                        quantity=lot["quantity"],
                        cost_basis_per_share=lot["cost_basis_per_share"],
                        purchase_date=lot.get("purchase_date"),
                        last_price=holding.get("last_price"),
                        last_price_updated_at=holding.get("last_price_updated_at"),
                    )
                )
                counts["holding_lots"] += 1

        history_path = CLIENTS_DIR / client_id / "chat_history.json"
        if history_path.exists():
            history = _load_json(history_path)
            for message in history["messages"]:
                session.add(
                    ChatMessage(
                        client_id=client_id,
                        msg_id=message["id"],
                        role=message["role"],
                        mode=message["mode"],
                        content=message["content"],
                        tools_used=message.get("tools_used", []),
                        created_at=message["created_at"],
                        flagged_for_report=message.get("flagged_for_report", False),
                        flagged_at=message.get("flagged_at"),
                    )
                )
                counts["chat_messages"] += 1
            session.add(
                ChatState(
                    client_id=client_id,
                    exploratory_context_injected=history.get("exploratory_context_injected", False),
                    exploratory_context=history.get("exploratory_context"),
                    exploratory_context_captured_at=history.get("exploratory_context_captured_at"),
                )
            )
            counts["chat_states"] += 1

    return counts


def migrate_reports(session) -> int:
    count = 0
    for path in sorted(REPORTS_DIR.glob("report-*.json")):
        report = _load_json(path)
        session.add(
            Report(
                id=report["id"],
                client_id=report["client_id"],
                status=report["status"],
                generated_at=report["generated_at"],
                approved_at=report.get("approved_at"),
                currency_display=report.get("currency_display", "USD"),
                content=report["content"],
            )
        )
        count += 1
    return count


def migrate_audit_log(session) -> int:
    data = _load_json(DATA_DIR / "audit_log.json")
    count = 0
    for entry in data["entries"]:
        session.add(
            AuditLogEntry(
                id=entry["id"],
                client_id=entry["client_id"],
                timestamp=entry["timestamp"],
                action=entry["action"],
                inputs_used=entry["inputs_used"],
                deterministic_outputs=entry["deterministic_outputs"],
                ai_output_summary=entry["ai_output_summary"],
                advisor_action=entry.get("advisor_action"),
            )
        )
        count += 1
    return count


def verify(session) -> None:
    """Compare row counts and a handful of real sample values against the
    original JSON, before this script's caller considers migration safe."""
    index = _load_json(CLIENTS_DIR / "index.json")
    expected_clients = len(index["clients"])
    actual_clients = session.query(Client).count()
    assert actual_clients == expected_clients, f"client count mismatch: {actual_clients} != {expected_clients}"

    expected_reports = len(list(REPORTS_DIR.glob("report-*.json")))
    actual_reports = session.query(Report).count()
    assert actual_reports == expected_reports, f"report count mismatch: {actual_reports} != {expected_reports}"

    audit_data = _load_json(DATA_DIR / "audit_log.json")
    actual_audit = session.query(AuditLogEntry).count()
    assert actual_audit == len(audit_data["entries"]), "audit_log count mismatch"

    daniel = session.query(Client).filter_by(id="WAC-0117").one()
    daniel_lots = session.query(HoldingLot).filter_by(client_id="WAC-0117").all()
    original_daniel = _load_json(CLIENTS_DIR / "WAC-0117.json")
    original_lot_count = sum(len(h["lots"]) for h in original_daniel["holdings"])
    assert daniel.name == "Daniel Osei", "Daniel Osei name mismatch"
    assert len(daniel_lots) == original_lot_count, f"Daniel Osei lot count mismatch: {len(daniel_lots)} != {original_lot_count}"
    vti_lot = next(l for l in daniel_lots if l.ticker == "VTI")
    assert vti_lot.quantity == 980 and vti_lot.cost_basis_per_share == 228.4, "Daniel Osei VTI lot value mismatch"

    priya = session.query(Client).filter_by(id="WAC-0118").one()
    assert priya.target_retirement_amount == 2500000.0, f"WAC-0118 target_retirement_amount mismatch: {priya.target_retirement_amount}"

    print(f"VERIFIED: {actual_clients} clients, {len(daniel_lots)} lots for Daniel Osei (real values match), "
          f"{actual_reports} reports, {actual_audit} audit_log entries, WAC-0118 target_retirement_amount=$2,500,000 (real value matches).")


def main() -> None:
    with session_scope() as session:
        if session.query(Client).count() > 0:
            print("Refusing to run: clients table already has rows. This script is one-time-only.")
            sys.exit(1)

        strategy_count = migrate_strategies(session)
        client_counts = migrate_clients_and_related(session)
        report_count = migrate_reports(session)
        audit_count = migrate_audit_log(session)

        session.flush()  # so verify() below can query what was just added, in the same transaction
        verify(session)

        print(
            f"Migrated: {strategy_count} strategies, {client_counts['clients']} clients, "
            f"{client_counts['holding_lots']} holding lots, {client_counts['chat_messages']} chat messages, "
            f"{client_counts['chat_states']} chat states, {report_count} reports, {audit_count} audit_log entries."
        )


if __name__ == "__main__":
    main()
