"""GET /exchange-rates — real, live USD-based conversion rates for the
CurrencySwitcher, so every dollar figure in the app can convert for real
instead of just relabeling the same number with a different symbol.

See services/exchange_rate_service.py for the live-fetch/cache/fallback
resilience chain.
"""
from __future__ import annotations

from fastapi import APIRouter

from services import exchange_rate_service

router = APIRouter()


@router.get("/exchange-rates")
def get_exchange_rates() -> dict:
    return exchange_rate_service.get_rates()
