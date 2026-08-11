"""Live USD-based exchange rates for real currency conversion across the app.

Primary source: open.er-api.com's "open" endpoint
(https://www.exchangerate-api.com/docs/free) — chosen specifically because
it needs no API key and no signup, unlike Finnhub/most other rate providers,
which matters here since this is a small "nice to have" feature, not worth
asking the user to go provision and paste in yet another API key for. It
updates once every 24h on the free tier and has no documented hard rate
limit for reasonable use, which comfortably covers this app's 1-hour cache
TTL.

Fallback source: Frankfurter (https://api.frankfurter.app, ECB reference
rates) — also keyless/signup-free, and covers every currency this app's
CurrencySwitcher offers (confirmed: EUR, GBP, INR, JPY are all in its
currency list). Used only when the primary source's live fetch itself
fails, not on every request.

Resilience mirrors market_data_service.py's Finnhub->yfinance pattern, one
level deeper: primary live fetch -> Frankfurter live fetch -> last-known
cached rates (served stale rather than failing) -> a documented static
fallback table, only if neither live source has ever once succeeded. Every
response says which of the four it actually used, so a fallback is visible
rather than silently presented as live.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)

RATES_URL = "https://open.er-api.com/v6/latest/USD"
FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD"
REQUEST_TIMEOUT_SECONDS = 5
CACHE_TTL_SECONDS = 3600  # 1 hour — rates don't move fast enough to justify fetching on every render.

# Only the currencies this app's CurrencySwitcher actually offers (see
# frontend/src/components/providers/currency-provider.tsx's CURRENCIES).
SUPPORTED_CURRENCIES = ("USD", "EUR", "GBP", "INR", "JPY")

# Static, documented last-resort fallback — approximate rates as of early
# 2025, used ONLY if the live fetch fails AND no cached rate has ever been
# fetched successfully in this process's lifetime. Not live data; every
# response using this table is labeled source="fallback" rather than
# presented as current.
FALLBACK_RATES: dict[str, float] = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "INR": 83.0,
    "JPY": 149.0,
}

_lock = threading.Lock()
_cache: dict[str, Any] | None = None  # {"rates": {...}, "fetched_at": monotonic, "as_of": iso str}


class ExchangeRateUnavailableError(RuntimeError):
    """Raised only in the (very unlikely) case the live fetch fails AND the
    static fallback table itself is somehow incomplete — in normal operation
    get_rates() always returns something usable."""


def _fetch_live_primary() -> dict[str, float]:
    response = requests.get(RATES_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    if response.status_code != 200:
        raise RuntimeError(f"open.er-api.com returned HTTP {response.status_code}.")
    data = response.json()
    if data.get("result") != "success":
        raise RuntimeError(f"open.er-api.com reported failure: {data.get('error-type', 'unknown error')}.")
    live_rates = data.get("rates", {})
    rates = {code: float(live_rates[code]) for code in SUPPORTED_CURRENCIES if code in live_rates}
    if "USD" not in rates:
        rates["USD"] = 1.0
    missing = set(SUPPORTED_CURRENCIES) - set(rates)
    if missing:
        raise RuntimeError(f"open.er-api.com response missing rates for: {sorted(missing)}.")
    return rates


def _fetch_live_frankfurter() -> dict[str, float]:
    """Second live source, tried only after the primary fetch above fails.
    Frankfurter's /latest response never lists the base currency itself
    (USD, here) at rate 1.0 either, same as open.er-api.com — same
    defensive fill-in below."""
    response = requests.get(FRANKFURTER_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    if response.status_code != 200:
        raise RuntimeError(f"api.frankfurter.app returned HTTP {response.status_code}.")
    data = response.json()
    live_rates = data.get("rates", {})
    rates = {code: float(live_rates[code]) for code in SUPPORTED_CURRENCIES if code in live_rates}
    if "USD" not in rates:
        rates["USD"] = 1.0
    missing = set(SUPPORTED_CURRENCIES) - set(rates)
    if missing:
        raise RuntimeError(f"api.frankfurter.app response missing rates for: {sorted(missing)}.")
    return rates


def get_rates() -> dict[str, Any]:
    """Return {"base": "USD", "rates": {...},
    "source": "live"|"live-frankfurter"|"cached-fresh"|"cached-stale"|"fallback", "as_of": iso str}.

    Cached for CACHE_TTL_SECONDS; concurrent callers within the TTL window
    all read the same cached dict rather than each hitting the network.
    """
    global _cache

    with _lock:
        if _cache is not None and _cache["fetched_at"] + CACHE_TTL_SECONDS > time.monotonic():
            return {"base": "USD", "rates": _cache["rates"], "source": "cached-fresh", "as_of": _cache["as_of"]}

        try:
            rates = _fetch_live_primary()
            source = "live"
        except Exception as exc_primary:  # noqa: BLE001 - deliberately broad, this is a resilience boundary
            logger.warning("Primary (open.er-api.com) exchange-rate fetch failed: %s", exc_primary)
            try:
                rates = _fetch_live_frankfurter()
                source = "live-frankfurter"
                logger.info("Frankfurter fallback succeeded after open.er-api.com failure.")
            except Exception as exc_fallback:  # noqa: BLE001 - same resilience boundary, one level deeper
                logger.warning("Frankfurter fallback fetch also failed: %s", exc_fallback)
                if _cache is not None:
                    # Serve the last real rates we ever fetched rather than
                    # falling all the way to the static table — a rate that's
                    # a few hours stale is still far more real than a
                    # hardcoded guess, matching market_data_service's own
                    # "stale cache beats no data" philosophy.
                    return {"base": "USD", "rates": _cache["rates"], "source": "cached-stale", "as_of": _cache["as_of"]}
                logger.warning("No cached exchange rates available either; using the static fallback table.")
                return {"base": "USD", "rates": dict(FALLBACK_RATES), "source": "fallback", "as_of": None}

        as_of = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        _cache = {"rates": rates, "fetched_at": time.monotonic(), "as_of": as_of}
        return {"base": "USD", "rates": rates, "source": source, "as_of": as_of}
