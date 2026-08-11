"""GET /strategies — the strategy library (the database's strategies table,
see database.py for where it actually lives), so the Clients page's "Add client" form can populate a
real risk-profile picker instead of a hardcoded frontend list that could
drift from what services/client_store.py actually recognizes.
"""
from __future__ import annotations

from fastapi import APIRouter

from services.client_store import list_strategies

router = APIRouter()


@router.get("/strategies")
def list_strategies_endpoint() -> dict:
    return list_strategies()
