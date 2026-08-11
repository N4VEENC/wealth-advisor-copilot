import logging
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from routers import chat, clients, exchange_rates, insights, market_data, portfolio, reports, scenarios, strategies  # noqa: E402

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Wealth Advisor Copilot API")

# The frontend (Vite dev server) runs on a different origin, so the browser
# preflights every request. Self-hosters set ALLOWED_ORIGINS in backend/.env
# (comma-separated real origins, e.g. their deployed frontend's URL) once
# they're ready to deploy — see .env.example. Left unset (the default for
# local dev, zero configuration needed), fall back to matching any
# localhost port: Vite auto-increments its port (5174, 5175, ...) whenever
# 5173 is already taken, so a single hardcoded origin would break the
# moment that happens.
_allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()]
_cors_kwargs = (
    {"allow_origins": _allowed_origins} if _allowed_origins else {"allow_origin_regex": r"http://localhost:\d+"}
)
app.add_middleware(
    CORSMiddleware,
    allow_methods=["*"],
    allow_headers=["*"],
    **_cors_kwargs,
)

app.include_router(clients.router)
app.include_router(chat.router)
app.include_router(exchange_rates.router)
app.include_router(market_data.router)
app.include_router(portfolio.router)
app.include_router(scenarios.router)
app.include_router(insights.router)
app.include_router(reports.router)
app.include_router(strategies.router)


@app.get("/health")
def health():
    return {"status": "ok"}
