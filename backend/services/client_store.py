"""Read/write access to client and strategy records — backed by the SQLite
database (see database.py for where it actually lives and why, and
models.py for the schema) rather than per-client JSON files. Shared by every
router that needs a client's
stored record (or the strategy that matches a client's risk profile), so the
storage layer is touched in exactly one place.

`load_client`/`save_client` still speak plain dicts shaped exactly like the
old JSON documents (holdings included) — every existing caller (routers,
insights_service, chat_service) keeps working unchanged; only this module
knows there's a database underneath now.

Uploaded holdings source files (the original .xlsx/.csv an advisor imported)
are NOT part of this migration's scope — they remain real files on disk
under CLIENTS_DIR/{client_id}/uploads/, unrelated to the client record
itself.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from database import session_scope
from models import AppMeta, Client, HoldingLot, Strategy

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CLIENTS_DIR = DATA_DIR / "clients"


class ClientNotFoundError(LookupError):
    """Raised when no stored record exists for a given client id."""


class StrategyNotFoundError(LookupError):
    """Raised when no strategy matches a given risk profile id."""


def _lots_to_holdings(lots: list[HoldingLot]) -> list[dict[str, Any]]:
    """Groups flat lot rows back into the nested holding shape (one entry
    per real ticker+account_type, each with its own lots list) every
    consumer of a client dict expects — `lots` must already be ordered by
    HoldingLot.id so holdings come out in first-seen order, same as the
    original JSON's holdings array order."""
    order: list[tuple[str, str]] = []
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for lot in lots:
        key = (lot.ticker, lot.account_type)
        if key not in groups:
            groups[key] = {
                "ticker": lot.ticker,
                "account_type": lot.account_type,
                "last_price": lot.last_price,
                "last_price_updated_at": lot.last_price_updated_at,
                "lots": [],
            }
            order.append(key)
        groups[key]["lots"].append(
            {
                "quantity": lot.quantity,
                "cost_basis_per_share": lot.cost_basis_per_share,
                "purchase_date": lot.purchase_date,
            }
        )
    return [groups[key] for key in order]


def _client_to_dict(client: Client, lots: list[HoldingLot]) -> dict[str, Any]:
    return {
        "id": client.id,
        "name": client.name,
        "email": client.email,
        "age": client.age,
        "risk_profile": client.risk_profile,
        "goal_year": client.goal_year,
        "annual_contribution": client.annual_contribution,
        "holdings": _lots_to_holdings(lots),
        "cash_balance": client.cash_balance,
        "cash_account_type": client.cash_account_type,
        "target_allocation": client.target_allocation,
        "accounts_note": client.accounts_note,
        "notes": client.notes,
        "target_retirement_amount": client.target_retirement_amount,
        "holdings_source": client.holdings_source,
        "original_filename": client.original_filename,
        "uploaded_at": client.uploaded_at,
        "trade_decisions": client.trade_decisions or {},
    }


def load_client(client_id: str) -> dict[str, Any]:
    with session_scope() as session:
        client = session.query(Client).filter_by(id=client_id).one_or_none()
        if client is None:
            raise ClientNotFoundError(f"Client '{client_id}' not found.")
        lots = session.query(HoldingLot).filter_by(client_id=client_id).order_by(HoldingLot.id).all()
        return _client_to_dict(client, lots)


def save_client(client_id: str, data: dict[str, Any]) -> None:
    """Upsert: creates the row if `client_id` is new (the create-client
    path), otherwise overwrites every field from `data` — same full-replace
    semantics as the old save_client's whole-file rewrite. Holdings are
    always deleted and reinserted wholesale rather than diffed, since that's
    exactly what every caller already does (load the full dict, mutate
    "holdings" in place or wholesale-replace it, save the full dict back)."""
    with session_scope() as session:
        client = session.query(Client).filter_by(id=client_id).one_or_none()
        if client is None:
            client = Client(id=client_id)
            session.add(client)

        client.name = data["name"]
        client.email = data.get("email")
        client.age = data.get("age")
        client.risk_profile = data["risk_profile"]
        client.goal_year = data["goal_year"]
        client.annual_contribution = data.get("annual_contribution", 0.0)
        client.cash_balance = data.get("cash_balance", 0.0)
        client.cash_account_type = data.get("cash_account_type", "taxable")
        client.target_allocation = data["target_allocation"]
        client.accounts_note = data.get("accounts_note")
        client.notes = data.get("notes")
        client.target_retirement_amount = data.get("target_retirement_amount")
        client.holdings_source = data.get("holdings_source")
        client.original_filename = data.get("original_filename")
        client.uploaded_at = data.get("uploaded_at")
        client.trade_decisions = data.get("trade_decisions", {})
        session.flush()  # assigns client.id's row before holding_lots reference it below

        session.query(HoldingLot).filter_by(client_id=client_id).delete()
        for holding in data.get("holdings", []):
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


def create_client(data: dict[str, Any]) -> dict[str, Any]:
    """Atomically allocates the next WAC-#### id and inserts the new client
    row in one transaction, so the counter only actually advances if the
    insert succeeds — same fidelity as the old index.json counter, which was
    only persisted (_save_index) after the client's JSON file had already
    been written successfully. `data` is everything a new client needs
    except `id` (brand new clients never have holdings yet, so there are no
    lots to insert)."""
    with session_scope() as session:
        meta = session.query(AppMeta).filter_by(key="next_client_number").one()
        number = int(meta.value)
        meta.value = str(number + 1)
        client_id = f"WAC-{number:04d}"

        client = Client(
            id=client_id,
            name=data["name"],
            email=data.get("email"),
            age=data.get("age"),
            risk_profile=data["risk_profile"],
            goal_year=data["goal_year"],
            annual_contribution=data.get("annual_contribution", 0.0),
            cash_balance=data.get("cash_balance", 0.0),
            cash_account_type=data.get("cash_account_type", "taxable"),
            target_allocation=data["target_allocation"],
            accounts_note=data.get("accounts_note"),
            notes=data.get("notes"),
            target_retirement_amount=data.get("target_retirement_amount"),
            holdings_source=data.get("holdings_source"),
            original_filename=data.get("original_filename"),
            uploaded_at=data.get("uploaded_at"),
            trade_decisions=data.get("trade_decisions", {}),
        )
        session.add(client)
        session.flush()
        return _client_to_dict(client, [])


def delete_client(client_id: str) -> None:
    """Deletes the client row; holdings_lots/reports/chat_messages/chat_state
    all cascade at the real foreign-key level (see models.py). The audit log
    is deliberately untouched — it's an immutable compliance trail, not
    client-owned state (see models.AuditLogEntry's docstring)."""
    with session_scope() as session:
        client = session.query(Client).filter_by(id=client_id).one_or_none()
        if client is not None:
            session.delete(client)


def list_client_ids() -> list[str]:
    """Every client id, in creation order (see models.Client.seq)."""
    with session_scope() as session:
        return [row[0] for row in session.query(Client.id).order_by(Client.seq).all()]


def load_strategy_for_risk_profile(risk_profile: str) -> dict[str, Any]:
    with session_scope() as session:
        strategy = session.query(Strategy).filter_by(id=risk_profile).one_or_none()
        if strategy is None:
            raise StrategyNotFoundError(f"No strategy found for risk_profile '{risk_profile}'.")
        return {
            "id": strategy.id,
            "label": strategy.label,
            "target_allocation": strategy.target_allocation,
            "rebalancing_threshold_pct": strategy.rebalancing_threshold_pct,
            "typical_holdings": strategy.typical_holdings,
        }


def list_strategies() -> dict[str, Any]:
    """GET /strategies' full payload — same {"strategies": [...]} shape as
    the old strategies.json, ordered the same way (insertion order)."""
    with session_scope() as session:
        strategies = session.query(Strategy).order_by(Strategy.seq).all()
        return {
            "strategies": [
                {
                    "id": s.id,
                    "label": s.label,
                    "target_allocation": s.target_allocation,
                    "rebalancing_threshold_pct": s.rebalancing_threshold_pct,
                    "typical_holdings": s.typical_holdings,
                }
                for s in strategies
            ]
        }
