"""Shared live-price fetch logic: Finnhub primary, yfinance automatic fallback.

Used by both GET /clients/{id}/market-data and GET /clients/{id}/analysis, so
the fallback logic (and its logging) lives in exactly one place rather than
being duplicated per router.

A dashboard page load fires GET /analysis, POST /insights, GET /projection,
GET /sector-exposure, and GET /compliance concurrently (frontend Promise.all)
— every one of them calls fetch_prices_with_fallback for the exact same
client's tickers via routers/portfolio.py's _load_and_analyze. Without
caching, that's 5 independent live-price fetches per page load, and worse:
running them concurrently multiplies the chance of hitting Finnhub's rate
limit, which forces every one of those 5 onto the much slower yfinance
fallback. The single-flight cache below collapses that to one real fetch
per (client's) ticker set — concurrent callers block on the same per-key
lock and share its result instead of each starting their own.

CACHE_TTL_SECONDS was originally 15s (long enough for one page load's
concurrent calls to share a fetch, not much more). Measured cold-vs-warm
against a real client: a cold fetch takes ~3.9s (external API latency);
a warm one ~0.2s. A 15s window meant a normal advisor session — Dashboard
→ Holdings → Reports → back to Dashboard, each page taking a few seconds
to read — routinely fell outside it and re-paid the full live fetch on
each return to a page, even though nothing about the client's prices
actually needed refreshing that fast (this app already fetches "live the
first time that client's Dashboard is opened" per the Clients page's own
copy, not on a real-time ticking basis). Raised to 60s so a realistic
multi-page review session stays warm throughout.
"""
from __future__ import annotations

import logging
import threading
import time

from services import finnhub_client, yfinance_client

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 60

_cache: dict[tuple[str, ...], tuple[dict[str, float], str, float]] = {}
_key_locks: dict[tuple[str, ...], threading.Lock] = {}
_key_locks_guard = threading.Lock()


class MarketDataUnavailableError(RuntimeError):
    """Raised when both Finnhub and the yfinance fallback fail."""


def _get_key_lock(key: tuple[str, ...]) -> threading.Lock:
    with _key_locks_guard:
        lock = _key_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _key_locks[key] = lock
        return lock


def _fetch_uncached(tickers: list[str]) -> tuple[dict[str, float], str]:
    try:
        prices = finnhub_client.get_quotes(tickers)
        return prices, "finnhub"
    except finnhub_client.FinnhubError as finnhub_exc:
        logger.warning("Finnhub unavailable (%s); falling back to yfinance.", finnhub_exc)
        try:
            prices = yfinance_client.get_quotes(tickers)
            return prices, "yfinance"
        except yfinance_client.YFinanceError as yfinance_exc:
            logger.error("yfinance fallback also failed: %s", yfinance_exc)
            raise MarketDataUnavailableError(
                f"Finnhub failed ({finnhub_exc}); yfinance fallback also failed ({yfinance_exc})."
            ) from yfinance_exc


def fetch_prices_with_fallback(tickers: list[str]) -> tuple[dict[str, float], str]:
    """Return (prices, source) for the given tickers, trying Finnhub first.

    Falls back to yfinance on any FinnhubError (missing key, HTTP failure,
    401, 429). Raises MarketDataUnavailableError only if both sources fail.

    Cached for CACHE_TTL_SECONDS per distinct ticker set, with concurrent
    requests for the same ticker set deduplicated onto a single fetch (see
    module docstring) rather than each hitting the network independently.
    """
    key = tuple(sorted(tickers))

    cached = _cache.get(key)
    if cached is not None and cached[2] > time.monotonic():
        return cached[0], cached[1]

    lock = _get_key_lock(key)
    with lock:
        # Re-check: another thread may have populated the cache while we were
        # waiting for the lock — this is exactly the redundant-fetch case
        # this cache exists to collapse.
        cached = _cache.get(key)
        if cached is not None and cached[2] > time.monotonic():
            return cached[0], cached[1]

        prices, source = _fetch_uncached(tickers)
        _cache[key] = (prices, source, time.monotonic() + CACHE_TTL_SECONDS)
        return prices, source
