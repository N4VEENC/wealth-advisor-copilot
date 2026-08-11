"""GET /clients — list every client (the database's clients table, see
database.py for where it actually lives), enriched with a cheap real-data
summary (corpus, return %,
has-holdings) for the Clients list page — see services/holdings.summarize_for_list.

The full per-client record (holdings, target allocation, etc.) is still
fetched separately via the existing client-scoped endpoints.
"""
from __future__ import annotations

import io
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services import excel_parser, holdings as holdings_service
from services.client_store import (
    ClientNotFoundError,
    StrategyNotFoundError,
    CLIENTS_DIR,
    create_client as create_client_record,
    delete_client as delete_client_record,
    list_client_ids,
    load_client,
    load_strategy_for_risk_profile,
    save_client,
)
from services.report_store import delete_report, list_reports

router = APIRouter()


def _uploads_dir(client_id: str) -> Path:
    return CLIENTS_DIR / client_id / "uploads"


@router.get("/clients")
def list_clients() -> dict:
    enriched = []
    for client_id in list_client_ids():
        try:
            client = load_client(client_id)
        except ClientNotFoundError:
            continue  # defensive only — a concurrent delete between the id list and this load
        enriched.append(
            {
                "id": client["id"],
                "name": client["name"],
                "risk_profile": client["risk_profile"],
                "goal_year": client["goal_year"],
                "email": client.get("email"),
                "age": client.get("age"),
                "accounts_note": client.get("accounts_note"),
                "holdings_source": client.get("holdings_source"),
                "uploaded_at": client.get("uploaded_at"),
                **holdings_service.summarize_for_list(client),
            }
        )
    return {"clients": enriched}


@router.get("/clients/{client_id}")
def get_client(client_id: str) -> dict:
    try:
        return load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class ClientCreate(BaseModel):
    name: str
    risk_profile: str
    goal_year: int
    email: str | None = None
    age: int | None = None
    accounts_note: str | None = None
    target_retirement_amount: float | None = None
    notes: str | None = None


@router.post("/clients")
def create_client(payload: ClientCreate) -> dict:
    """Creates a new client with no holdings yet — the Clients page routes
    into the Holdings-upload empty state for exactly this case (App Flow
    doc). target_allocation defaults to the matched strategy's own target,
    since every downstream calculation (optimizer, recommendations) requires
    one; the advisor can revise it later, but there's no more honest default
    than "whatever this risk profile's strategy targets".

    email/age/accounts_note/notes are advisor-entered descriptive fields —
    none of them feed any deterministic calculation, same as a CRM note
    would. cash_balance (the real dollar figure that DOES feed total-value
    math) always starts at 0 for a brand-new client — it's only ever set
    from real uploaded/entered holdings data, never from an estimate.

    target_retirement_amount is different: unlike the fields above, it DOES
    feed a real calculation — services/projection.resolve_goal_amount() uses
    it directly as the Monte Carlo goal amount everywhere that figure is
    used (Retirement Funding card, funding-probability stats, report
    generation, the AI Chat's get_projection tool) whenever it's set,
    falling back to the existing derived-compounding estimate when it's
    left null. This replaces the old starting_corpus_note field, which was
    a pure descriptive note that fed nothing."""
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Client name is required.")

    try:
        strategy = load_strategy_for_risk_profile(payload.risk_profile)
    except StrategyNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return create_client_record(
        {
            "name": payload.name.strip(),
            "email": payload.email.strip() if payload.email else None,
            "age": payload.age,
            "risk_profile": payload.risk_profile,
            "goal_year": payload.goal_year,
            "annual_contribution": 0,
            "cash_balance": 0,
            "cash_account_type": "taxable",
            "target_allocation": strategy["target_allocation"],
            "accounts_note": payload.accounts_note.strip() if payload.accounts_note else None,
            "target_retirement_amount": payload.target_retirement_amount,
            "notes": payload.notes.strip() if payload.notes else None,
            "holdings_source": None,
            "original_filename": None,
            "uploaded_at": now,
        }
    )


@router.delete("/clients/{client_id}")
def delete_client(client_id: str, force: bool = False) -> dict:
    """Removes the client row. Refuses if any reports exist for this client
    (409) rather than silently orphaning them — this app has no general
    cascading-delete story for reports/audit entries by default, so the
    default, safe move is to block, not to guess.

    `force=true` is the one deliberate exception: it deletes the client's
    OWN referencing reports first, then the client record — whose row
    delete also cascades (real foreign keys, see models.py) to its
    holdings_lots/chat_messages/chat_state, so nothing is left orphaned in
    the database. This is an explicit override, not a relaxation of the
    default — the 409 above still fires for every normal call, and the
    frontend only ever sends force=true after a second, explicit advisor
    confirmation naming exactly how many reports will be destroyed (see
    clients-page.tsx's delete flow). There is no silent/default force path
    anywhere in this app. The audit log is never touched by this — it's an
    immutable compliance trail, not client-owned state."""
    try:
        load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    existing_reports = list_reports(client_id)
    if existing_reports and not force:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete '{client_id}': {len(existing_reports)} report(s) still reference this client.",
        )

    for report in existing_reports:
        delete_report(report["id"])

    delete_client_record(client_id)
    shutil.rmtree(_uploads_dir(client_id), ignore_errors=True)

    return {"deleted": client_id, "reports_deleted": len(existing_reports)}


@router.post("/clients/{client_id}/holdings/upload")
async def upload_holdings(client_id: str, file: UploadFile = File(...)) -> dict:
    """Parses an uploaded Excel/CSV holdings export (services/excel_parser.py)
    and replaces the client's holdings with the parsed result. Also persists
    the original file bytes to backend/data/clients/{id}/uploads/, so the
    "Data source" panel can genuinely reopen the file the advisor imported —
    it isn't just a label. Only the most recent upload is kept (a fresh
    upload replaces holdings entirely, so keeping older files around would
    describe data that's no longer live). Live prices aren't fetched here —
    that happens the first time /analysis or /insights runs for this client,
    same as any other holdings change."""
    try:
        client = load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    raw_bytes = await file.read()
    safe_filename = Path(file.filename or "holdings").name

    try:
        holdings = excel_parser.parse_holdings_file(io.BytesIO(raw_bytes), safe_filename)
    except excel_parser.HoldingsParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    uploads_dir = _uploads_dir(client_id)
    shutil.rmtree(uploads_dir, ignore_errors=True)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    (uploads_dir / safe_filename).write_bytes(raw_bytes)

    client["holdings"] = holdings
    client["holdings_source"] = "upload"
    client["original_filename"] = safe_filename
    client["uploaded_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    save_client(client_id, client)

    return client


@router.get("/clients/{client_id}/holdings/source-file")
def get_holdings_source_file(client_id: str):
    """Serves the original file the advisor uploaded for this client (see
    upload_holdings above) — 404 if none was ever uploaded (e.g. holdings
    were entered manually, or none exist yet)."""
    try:
        client = load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    filename = client.get("original_filename")
    if not filename:
        raise HTTPException(status_code=404, detail=f"No source file on record for '{client_id}'.")

    path = _uploads_dir(client_id) / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Source file '{filename}' is missing on disk.")

    return FileResponse(path, filename=filename)


class ManualHoldingCreate(BaseModel):
    ticker: str
    quantity: float
    cost_basis_per_share: float
    account_type: Literal["taxable", "401k", "ira", "roth_ira"]
    purchase_date: str | None = None


@router.post("/clients/{client_id}/holdings/manual")
def add_manual_holding(client_id: str, payload: ManualHoldingCreate) -> dict:
    """Single-position manual entry — the "Enter holdings manually" path in
    the client-action dialog. Appends a real lot to the client's real
    holdings (same on-disk shape excel_parser.py produces for an upload):
    a new lot on the matching ticker+account_type holding if one already
    exists, otherwise a brand-new holding with this one lot. Not a stub —
    this is the same lots array every other real feature (optimizer,
    recommendation_matcher, Holdings page) reads."""
    try:
        client = load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    ticker = payload.ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=422, detail="Ticker is required.")
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be positive.")
    if payload.cost_basis_per_share < 0:
        raise HTTPException(status_code=422, detail="Cost basis per share can't be negative.")

    new_lot = {
        "quantity": payload.quantity,
        "cost_basis_per_share": round(payload.cost_basis_per_share, 4),
        "purchase_date": payload.purchase_date,
    }

    holdings = client.setdefault("holdings", [])
    existing = next(
        (h for h in holdings if h["ticker"] == ticker and h["account_type"] == payload.account_type), None
    )
    if existing is not None:
        existing["lots"].append(new_lot)
    else:
        holdings.append(
            {
                "ticker": ticker,
                "account_type": payload.account_type,
                "last_price": None,
                "last_price_updated_at": None,
                "lots": [new_lot],
            }
        )

    client["holdings_source"] = client.get("holdings_source") or "manual"
    client["uploaded_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    save_client(client_id, client)

    return client


class TradeDecisionUpdate(BaseModel):
    ticker: str
    action: Literal["BUY", "SELL"]
    decision: Literal["accepted", "dismissed", "pending"]


@router.put("/clients/{client_id}/trade-decisions")
def update_trade_decision(client_id: str, update: TradeDecisionUpdate) -> dict:
    """Persists the advisor's real Accept/Dismiss choice for one recommended
    trade, keyed by ticker+action (recommendations aren't individually
    id'd — they're regenerated fresh from live prices/drift on every
    /insights call, so ticker+action is the stable identity across calls).
    Read back by insights_service.compute_insights so both the Dashboard and
    a generated report reflect the advisor's actual decisions, not just show
    every suggestion as if it were accepted."""
    try:
        client = load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    decisions = client.get("trade_decisions", {})
    key = f"{update.ticker}:{update.action}"
    if update.decision == "pending":
        decisions.pop(key, None)
    else:
        decisions[key] = update.decision
    client["trade_decisions"] = decisions
    save_client(client_id, client)

    return {"client_id": client_id, "trade_decisions": decisions}
