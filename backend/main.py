import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from routers import chat, clients, exchange_rates, insights, market_data, portfolio, reports, scenarios, strategies  # noqa: E402

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Wealth Advisor Copilot API")

# The frontend (Vite dev server) runs on a different origin, so the browser
# preflights every request. Local-dev-only origins for now; this will need
# the deployed frontend's origin added when Phase 11 (Deploy) happens.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
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
