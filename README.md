# Wealth Advisor Copilot

A self-hosted dashboard for a financial advisor to review a client's portfolio, stress-test it against market scenarios, chat with an AI assistant about it, and generate client-facing reports — for one advisor, running locally, against their own real (or demo) client data.

The core principle: the AI never invents a number. Every score, percentage, dollar figure, and recommended trade shown anywhere in this app comes from deterministic, auditable calculation in the backend. The AI's only job — in the Dashboard narrative, the AI Chat, and report generation — is to explain numbers that already exist. It is never asked to calculate, estimate, or produce a figure of its own, and the strict system prompts enforcing this are part of the code, not just a policy.

## Features

- Portfolio analysis — real-time allocation vs. target, a diversification risk score, and an investment health score, computed from live holdings and live market prices.
- Tax-lot-aware rebalancing — trade recommendations sized to bring a drifted allocation bucket back to its target, consuming the highest-cost-basis lots first (HIFO) to minimize the realized gain, with each trade's long/short-term tax classification shown.
- Monte Carlo retirement projections — 10,000 simulated paths per client, comparing the current allocation's and the target allocation's probability of reaching the client's retirement goal.
- 44-scenario stress testing — a library of hand-specified market shock archetypes (rate moves, recessions, sector shocks, currency/geopolitical events) that free text or a preset chip resolves to; the AI is used only as a classifier to pick which existing archetype fits, never to invent a shock magnitude.
- Rules-based compliance flags — single-position concentration and wash-sale-risk checks, deterministic and always shown even if AI narration of them is unavailable.
- AI Chat in two modes — Verified mode, where the AI can only answer using one of 6 tools wrapping this client's real computed data (and says so plainly if none can answer); Exploratory mode, for open-ended market/industry discussion, clearly labeled as an estimate and grounded in a one-time real snapshot of the client's actual portfolio.
- Flag for report reference — flag any AI Chat message (verified or exploratory) for later reference, and optionally attach it to a generated report as a disclosed, audited part of that report.
- PDF reports with an approval gate — a report starts as an editable draft; only advisor-accepted trades appear in it; it must be explicitly approved before it's considered final/shareable; export is a print-styled PDF via the browser's own print dialog.
- Live currency display conversion — every figure is computed and stored in USD; switching currency multiplies through a live exchange rate (with a documented four-tier fallback chain) rather than recomputing anything.
- Excel/CSV holdings import — tolerant of common column-name and account-type variants (see Usage below).

## Tech stack

Backend: Python 3.11, FastAPI, SQLAlchemy + SQLite, pandas/openpyxl (holdings import), numpy/scipy (portfolio math and Monte Carlo), yfinance + Finnhub (live market data, with fallback), Groq (AI narration — an OpenAI-compatible chat-completions API).

Frontend: React 19 + TypeScript, Vite, React Router, Tailwind CSS, shadcn/ui (Radix-based) components, hand-built SVG charts.

## Setup

Prerequisites: Python 3.11+, Node.js 18+ and npm, a free [Groq](https://console.groq.com/keys) account (AI narration) and a free [Finnhub](https://finnhub.io/register) account (live market data) — both sign-ups take under a minute and neither requires a credit card.

**1. Clone and install dependencies**

```bash
git clone <this-repo-url>
cd Wealth-Advisor-Copilot

# Backend
cd backend
python -m venv venv
venv\Scripts\activate        # Windows — use `source venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cd ..

# Frontend
cd frontend
npm install
cd ..
```

**2. Configure your environment**

Copy both example env files and fill in your own real values — neither `.env` is ever committed (only the `.env.example` templates are tracked):

```bash
# macOS/Linux/Git Bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

Edit `backend/.env`:

- `GROQ_API_KEY` — from [console.groq.com/keys](https://console.groq.com/keys)
- `FINNHUB_API_KEY` — from [finnhub.io/register](https://finnhub.io/register)
- `ALLOWED_ORIGINS` — leave blank for local development (the backend then accepts any `http://localhost:<port>` origin automatically). Only set this if you deploy the frontend somewhere else later.

`frontend/.env`'s `VITE_API_BASE_URL` already defaults to `http://localhost:8010`, matching the standardized local backend port below — you shouldn't need to change it unless you deliberately run the backend on a different port.

**3. Run both servers**

Two terminals, both from the project root:

```bash
# Terminal 1 — backend (standardized on port 8010)
backend\venv\Scripts\python.exe -m uvicorn main:app --reload --reload-dir backend --port 8010 --app-dir backend

# Terminal 2 — frontend
npm run dev --prefix frontend
```

The `--reload-dir backend` flag matters: without it, `--reload`'s file-watcher watches the entire project root (including `node_modules`), which is slow and can put the reload worker into a broken state where every request fails. Always scope it to `backend`.

Open `http://localhost:5173`. If port 8010 is ever occupied by something else, pass a different `--port` to uvicorn and update `frontend/.env`'s `VITE_API_BASE_URL` to match — the two must always agree.

## Usage walkthrough

1. Add a client — from the Clients page, click "Add client" and fill in name, risk profile, and retirement goal year. A real target retirement dollar amount is optional; if you leave it blank, the app estimates one by projecting the current portfolio forward at the target allocation's expected return, and always labels which kind of figure is being shown.
2. Upload holdings — an Excel or CSV file with a ticker column, a quantity column, a cost-basis-per-share column, and an account-type column. Common header variants are recognized automatically (`Symbol`/`Ticker`, `Qty`/`Quantity`/`Shares`, `Cost Basis`/`Avg Cost`, `Account`/`Account Type`), as are common account-type spellings (`401(k)`, `Traditional IRA`, `Roth`, `Taxable Brokerage`, etc.).
3. Review the Dashboard — real allocation-vs-target drift, diversification and health scores, sector exposure, an AI narrative of those numbers, rebalancing trade suggestions, and compliance flags.
4. Use AI Chat — ask a question in Verified mode (e.g. "what's the current health score?") to get an answer backed by one of the 6 real data tools, or switch to Exploratory mode for general discussion. Flag any message worth keeping via its flag icon.
5. Run a scenario — click a preset chip (rate hike, recession, tech selloff) or type a free-text scenario ("what if there's a housing crash") and see the deterministic projected impact.
6. Generate and approve a report — click "Generate report," optionally attach any flagged chat notes, accept or decline individual suggested trades, then approve the report from the Reports page once you're satisfied. Only accepted trades appear in the final report. Export it as a PDF via the report view's "Download PDF" button, which uses the browser's own print-to-PDF.

## Database

Client, holdings, report, chat, and audit-log data all live in one real SQLite database (via SQLAlchemy) — not per-client JSON files. The database file is deliberately kept outside this project folder, at:

- Windows: `%LOCALAPPDATA%\WealthAdvisorCopilot\wealth_advisor.db`
- macOS/Linux: `~/.wealth_advisor_copilot/wealth_advisor.db`

(This is so the file isn't inside a cloud-synced folder like OneDrive or Dropbox — a sync agent holding a lock on a frequently-written SQLite file causes real "database is locked" errors.) To inspect it, open that exact path directly in [DB Browser for SQLite](https://sqlitebrowser.org/) — or run `python -c "from database import DB_PATH; print(DB_PATH)"` from inside `backend/` to print the exact path on your machine.

## Known limitations

- Single advisor, no authentication. There's no login screen or multi-user support — this is designed to run locally for one advisor. Don't expose it on a public network as-is.
- No formal end-to-end testing checklist has been run as a deliberate sweep. Issues fixed so far were fixed reactively; there may be edge cases (a malformed upload, a live-data outage, an unusual client state) that haven't surfaced yet simply because no one has hit them.
- Demo/fictional client data only. No real custodian API is connected — holdings are entered manually or imported from a file, never pulled from a real brokerage.
- Scenario shocks and Monte Carlo return assumptions are illustrative, not calibrated. Both use documented, hand-specified assumptions for demonstration — neither is a statistically calibrated forecast, and the app is explicit about this wherever the numbers are shown.
- Sector look-through uses a static approximate snapshot for broad index funds (e.g. VOO), not live fund-composition data from a data provider.
- Groq's free tier has a daily request quota. Heavy use of AI narration, AI Chat, or report generation in a short window can exhaust it; the app degrades gracefully (deterministic numbers still show, only the AI narrative goes temporarily unavailable) but won't retry automatically.

## License

No license has been chosen for this project yet. Until the repository owner adds one, all rights are reserved by default and this code should not be assumed to be open for reuse. [MIT](https://choosealicense.com/licenses/mit/) is a common, simple, permissive choice for a project like this if you want to open it up — but that decision is the repo owner's to make, not assumed here.