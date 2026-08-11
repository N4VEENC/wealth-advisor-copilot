"""SQLAlchemy ORM models — the relational replacement for the old per-file
JSON records under backend/data/. Field names/shapes mirror the old JSON
documents exactly; the only additions are what a relational store requires
that a directory of files didn't (surrogate keys, explicit foreign keys).

Cascading deletes: Client -> holding lots / chat messages / chat state /
reports all cascade at the real database level (ForeignKey(..., ondelete=
"CASCADE") + relationship(..., passive_deletes=True), with SQLite's
foreign_keys pragma turned on in database.py). AuditLogEntry.client_id is
deliberately a plain indexed string, NOT a ForeignKey — the compliance audit
trail must survive a client being deleted (real historical data already
contains entries for a client no longer in the clients table), so it's never
part of the cascade.
"""
from __future__ import annotations

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Client(Base):
    __tablename__ = "clients"

    # `seq` is a pure insertion-order surrogate (GET /clients lists in
    # creation order) — WAC-#### stays the real, externally-visible id.
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String, unique=True, index=True)

    name: Mapped[str] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    risk_profile: Mapped[str] = mapped_column(String)
    goal_year: Mapped[int] = mapped_column(Integer)
    annual_contribution: Mapped[float] = mapped_column(Float, default=0.0)
    cash_balance: Mapped[float] = mapped_column(Float, default=0.0)
    cash_account_type: Mapped[str] = mapped_column(String, default="taxable")
    target_allocation: Mapped[dict] = mapped_column(JSON)
    accounts_note: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    target_retirement_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    holdings_source: Mapped[str | None] = mapped_column(String, nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String, nullable=True)
    uploaded_at: Mapped[str | None] = mapped_column(String, nullable=True)
    trade_decisions: Mapped[dict] = mapped_column(JSON, default=dict)

    holding_lots: Mapped[list["HoldingLot"]] = relationship(
        back_populates="client", cascade="all, delete-orphan", passive_deletes=True,
        order_by="HoldingLot.id",
    )
    reports: Mapped[list["Report"]] = relationship(
        back_populates="client", cascade="all, delete-orphan", passive_deletes=True,
    )
    chat_messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="client", cascade="all, delete-orphan", passive_deletes=True,
        order_by="ChatMessage.id",
    )
    chat_state: Mapped["ChatState | None"] = relationship(
        back_populates="client", cascade="all, delete-orphan", passive_deletes=True,
        uselist=False,
    )


class HoldingLot(Base):
    """One row per real tax lot. `ticker`+`account_type` group lots back into
    the "holding" shape the rest of the app expects (see services/client_store.py);
    last_price/last_price_updated_at are holding-level in the original JSON,
    so they're denormalized across every lot row sharing that ticker+account_type
    for a client — always written/read together, never diverges in practice."""

    __tablename__ = "holdings_lots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    ticker: Mapped[str] = mapped_column(String)
    account_type: Mapped[str] = mapped_column(String)
    quantity: Mapped[float] = mapped_column(Float)
    cost_basis_per_share: Mapped[float] = mapped_column(Float)
    purchase_date: Mapped[str | None] = mapped_column(String, nullable=True)
    last_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_price_updated_at: Mapped[str | None] = mapped_column(String, nullable=True)

    client: Mapped["Client"] = relationship(back_populates="holding_lots")


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String)
    generated_at: Mapped[str] = mapped_column(String)
    approved_at: Mapped[str | None] = mapped_column(String, nullable=True)
    currency_display: Mapped[str] = mapped_column(String, default="USD")
    content: Mapped[dict] = mapped_column(JSON)

    client: Mapped["Client"] = relationship(back_populates="reports")


class AuditLogEntry(Base):
    """Append-only compliance trail. client_id is intentionally NOT a
    ForeignKey — see module docstring."""

    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    client_id: Mapped[str] = mapped_column(String, index=True)
    timestamp: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    inputs_used: Mapped[dict] = mapped_column(JSON)
    deterministic_outputs: Mapped[dict] = mapped_column(JSON)
    ai_output_summary: Mapped[str] = mapped_column(Text)
    advisor_action: Mapped[str | None] = mapped_column(String, nullable=True)


class ChatMessage(Base):
    """`msg_id` is the client-scoped "msg-0001"-style id the frontend/tools
    already key off of (see services/chat_service.py); `id` is a plain
    surrogate primary key since msg_id repeats across different clients."""

    __tablename__ = "chat_messages"
    __table_args__ = (UniqueConstraint("client_id", "msg_id", name="uq_chat_message_client_msg"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    msg_id: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    mode: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    tools_used: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[str] = mapped_column(String)
    flagged_for_report: Mapped[bool] = mapped_column(Boolean, default=False)
    flagged_at: Mapped[str | None] = mapped_column(String, nullable=True)

    client: Mapped["Client"] = relationship(back_populates="chat_messages")


class ChatState(Base):
    """One row per client: the exploratory-mode one-time-context bookkeeping
    that used to live alongside `messages` in chat_history.json. Split into
    its own table since it's per-client singleton state, not a message."""

    __tablename__ = "chat_state"

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True)
    exploratory_context_injected: Mapped[bool] = mapped_column(Boolean, default=False)
    exploratory_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    exploratory_context_captured_at: Mapped[str | None] = mapped_column(String, nullable=True)

    client: Mapped["Client"] = relationship(back_populates="chat_state")


class Strategy(Base):
    __tablename__ = "strategies"

    # Same insertion-order surrogate pattern as Client.seq — the frontend's
    # risk-profile picker renders strategies in this list's order, which is
    # NOT alphabetical (id order is: conservative, balanced, moderate-growth,
    # aggressive-growth, esg-tilted), so it must be preserved explicitly
    # rather than relying on an ORDER BY id.
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String, unique=True, index=True)
    label: Mapped[str] = mapped_column(String)
    target_allocation: Mapped[dict] = mapped_column(JSON)
    rebalancing_threshold_pct: Mapped[float] = mapped_column(Float)
    typical_holdings: Mapped[list] = mapped_column(JSON, default=list)


class AppMeta(Base):
    """Tiny key/value table — today just holds `next_client_number`, the one
    piece of persistent counter state clients/index.json used to keep (see
    routers/clients.py's _next_client_id: a monotonic counter, not
    max(existing)+1, so a deleted client's number is never reissued)."""

    __tablename__ = "app_meta"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String)
