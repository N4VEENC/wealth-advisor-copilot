# 02 — Technical Requirements Document (TRD)

## Frontend
- React (via Vite)
- shadcn/ui component library (connect the shadcn MCP server if available so components are pulled from the real, current registry rather than reconstructed from memory)
- Tailwind CSS
- Hand-built SVG charts (not canvas, not a charting library) — matches the mockup's existing approach for the allocation pie chart and the dual-line projection chart
- Both light and dark theme, implemented as a real CSS variable swap (not two separate stylesheets)
- Fully responsive (desktop-first, since the primary user is an advisor at a desk, but must not break on mobile)

## Backend
- Python 3.11
- FastAPI
- `pandas` — Excel/CSV parsing and normalization
- `numpy` — portfolio math (allocation %, weighted averages)
- `scipy` (as needed) — any distributional/statistical calculations for scenario modeling
- `yfinance` — fallback market data source, no API key required
- Google Gemini Python SDK — AI orchestration layer only (never generates the numbers itself)
- Runs locally via `uvicorn` on `localhost` during development

## Database
- **No database engine.** Data is stored as plain JSON files on the backend's local disk:
  - `backend/data/clients/{client-id}.json` — one file per client (holdings, risk profile, goals)
  - `backend/data/clients/index.json` — list of all clients (for the sidebar)
  - `backend/data/strategies.json` — investment strategy library (conservative income, balanced growth, aggressive growth, ESG-tilted — each with target allocations, rebalancing rules, typical holdings)
  - `backend/data/audit_log.json` — append-only compliance/audit trail entries
  - `backend/data/reports/{report-id}.json` — generated report snapshots
- Rationale: at a scale of 2–10 clients with a single advisor user, a full database is unnecessary overhead; per-client JSON files give clean separation without concurrency risk in this single-user context.

## Auth
- None for this version (single local advisor session, no login screen). Explicitly out of scope per PRD.

## Hosting and Deployment
- Local development: both servers run on `localhost` (backend typically `:8000`, frontend typically `:5173` via Vite) during the entire build phase
- Final deployment (after local build is complete and pushed to GitHub):
  - Frontend → Vercel or Netlify (static hosting)
  - Backend → Render or Railway (needs to stay running, hold API keys server-side, and read/write local JSON files)
  - Frontend's backend API base URL supplied via an environment variable, swapped between local (`http://localhost:8000`) and the deployed backend URL

## Third-Party APIs and Services
| Name | Purpose | Tier |
|---|---|---|
| Google Gemini API (Gemini 2.5 Flash, via Google AI Studio — see implementation note under Key Libraries; build actually uses the `gemini-flash-latest` alias) | AI reasoning/orchestration — turns calculated numbers into plain-language insight, never generates numbers itself | Free (~1,500 requests/day) |
| Finnhub | Primary live market data (real-time prices) | Free (60 requests/min) |
| yfinance (Python library) | Fallback market data if Finnhub is rate-limited | Free, no key needed |

## Key Libraries
- Backend: `fastapi`, `uvicorn`, `pandas`, `numpy`, `scipy`, `yfinance`, `google-genai` (see implementation note below), `python-multipart` (for file upload), `python-dotenv`

> **Implementation note (added during Phase 6 build, 2026-08-03):** `google-generativeai`, the package originally anticipated here, is now fully deprecated upstream ("all support has ended, switch to `google.genai`"). The build uses the maintained `google-genai` SDK instead. Likewise, the model named below (`gemini-2.5-flash`) returned HTTP 404 ("no longer available to new users") for a freshly-issued API key — the build uses the `gemini-flash-latest` alias instead, which always resolves to the current recommended flash-tier model. If you're reading this well after 2026, re-check both the SDK package and model name before assuming either still applies.
- Frontend: `react`, `shadcn/ui` components, `tailwindcss`, `lucide-react` (icons)

## Folder Structure
```
wealth-advisor-copilot/
├── backend/
│   ├── main.py
│   ├── routers/
│   │   ├── clients.py
│   │   ├── portfolio.py
│   │   ├── market_data.py
│   │   ├── insights.py        (Gemini orchestration)
│   │   ├── scenarios.py
│   │   ├── reports.py
│   │   └── compliance.py
│   ├── services/
│   │   ├── excel_parser.py
│   │   ├── optimizer.py       (deterministic math)
│   │   ├── scenario_simulator.py  (deterministic math)
│   │   ├── recommendation_matcher.py
│   │   ├── finnhub_client.py
│   │   ├── yfinance_client.py
│   │   └── gemini_client.py
│   ├── data/
│   │   ├── clients/
│   │   ├── strategies.json
│   │   ├── audit_log.json
│   │   └── reports/
│   ├── .env                    (GEMINI_API_KEY, FINNHUB_API_KEY — never committed)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/              (Dashboard, Holdings, Reports, ClientReport, Explanations)
│   │   ├── lib/
│   │   └── App.tsx
│   ├── .env                    (VITE_API_BASE_URL)
│   └── package.json
├── .gitignore                  (must exclude .env, node_modules, __pycache__, data/*.json if containing sensitive demo data is a concern)
└── README.md
```

## Environment Variables
- `GEMINI_API_KEY` (backend)
- `FINNHUB_API_KEY` (backend)
- `VITE_API_BASE_URL` (frontend — points to backend, local or deployed)

## Hard Constraints / Preferences
- The AI (Gemini) must never generate the actual financial numbers (returns, Sharpe ratio, allocation %, projected values) — those must always come from deterministic backend functions. Gemini only explains/synthesizes what those functions already calculated.
- Must run fully locally on `localhost` before any deployment step is attempted.
- No real trade execution, no real brokerage integration, no real user auth — see PRD "Out of Scope."
- All demo data must be clearly and visibly labeled as fictional/illustrative in the UI (this was already present in the mockup's footer disclosure text and must be preserved).
- Must work on a free tier for every third-party service — no paid API keys required to run the demo.
