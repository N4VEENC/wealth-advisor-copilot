# 06 — Implementation Plan (Step-by-Step Build Sequence)

Note: no login/auth phase is needed for this version (see PRD/TRD — auth is explicitly out of scope), so that phase is replaced below with the data-ingestion phase, which is the actual foundation this project depends on.

## Phase 1: Setup
- Initialize project repo, folder structure exactly as defined in the TRD (`backend/`, `frontend/`)
- Backend: create Python 3.11 virtual environment, install `fastapi`, `uvicorn`, `pandas`, `numpy`, `scipy`, `yfinance`, Gemini SDK, `python-multipart`, `python-dotenv`; create `.env` with `GEMINI_API_KEY` and `FINNHUB_API_KEY`
- Frontend: scaffold Vite + React project, install Tailwind, shadcn/ui (connect shadcn MCP if available), `lucide-react`
- Confirm both servers boot with a simple health-check endpoint/page before writing any feature code
- **Done when:** `uvicorn` backend responds on `localhost:8000/health`, and `npm run dev` frontend loads a blank page on `localhost:5173`, with no errors in either terminal

## Phase 2: Data Layer (replaces "Database" phase — see note above)
- Implement the JSON file storage structure from the Backend Schema doc: `clients/index.json`, per-client files, `strategies.json`, `audit_log.json`, `reports/`
- Seed one real demo client (Margaret Chen, per PRD/Backend Schema) plus 2 sample Excel/CSV files to test upload against
- Implement `excel_parser.py`: reads an uploaded Excel/CSV, tolerates column-name variants ("Symbol" vs "Ticker"), outputs the normalized holdings JSON shape
- **Done when:** uploading the sample Excel file for Margaret Chen produces a correctly structured `clients/margaret-chen.json` file with no manual JSON editing needed

## Phase 3: Market Data Integration (replaces "Auth" phase)
- Implement `finnhub_client.py` (primary) and `yfinance_client.py` (fallback) — given a list of tickers, return live prices
- Implement fallback logic: if Finnhub fails or rate-limits, automatically retry via yfinance
- Wire into `GET /clients/{id}/market-data`
- **Done when:** calling this endpoint for Margaret Chen returns real, current prices for AAPL, MSFT, VOO, BND (not hardcoded numbers)

## Phase 4: Core Feature 1 — Deterministic Portfolio Optimizer
- Implement `optimizer.py`: given holdings + live prices + target allocation, calculate current allocation %, diversification risk score, investment health score, and drift vs. target
- Wire into `GET /clients/{id}/analysis`
- **Done when:** endpoint returns numerically correct scores/percentages for the seeded demo client, verified by hand-checking the math at least once

## Phase 5: Core Feature 2 — Scenario Simulator
- Implement `scenario_simulator.py`: given a scenario input (preset chip or free text mapped to a shock type — rate hike, recession, tech selloff) and the client's current holdings, project the impact on portfolio value
- Wire into `POST /clients/{id}/scenario`
- **Done when:** each of the three preset scenario chips produces a distinct, directionally sensible projected impact for the demo client

## Phase 6: Core Feature 3 — Recommendation Matcher + Gemini Orchestration
- Implement `recommendation_matcher.py`: compares current allocation/drift against the strategy library and produces structured trade suggestions (ticker, action, quantity, account, estimated tax impact)
- Implement `gemini_client.py`: sends the deterministic outputs from Phases 4–6 to Gemini, prompted to explain/narrate only — never to invent its own numbers — and returns plain-language insight text
- Wire into `POST /clients/{id}/insights`
- **Done when:** a real end-to-end call (holdings → analysis → scenario → recommendations → Gemini narrative) works via curl/Postman with no manual data faked at any step

## Phase 7: Compliance & Reporting
- Every call to the insights/recommendation endpoints appends one entry to `audit_log.json`, per the Backend Schema shape
- Implement `POST /clients/{id}/reports`: assembles scores, allocation, projection data, accepted trades, AI narrative, and standard disclosure text into a report JSON, status `draft`
- Implement `PATCH /reports/{id}/approve`: flips status to `approved`, records timestamp — this is the human-in-the-loop gate
- **Done when:** a draft report cannot be treated as "final"/shareable until explicitly approved via this endpoint

## Phase 8: Frontend — Rebuild the Mockup as Real Components
- Using `Portfolio_Advisor_Assistant_New.html` as the exact visual reference (do not redesign), rebuild each section as real React + shadcn/ui components: sidebar nav (Clients → Dashboard → Holdings → Reports, then Explanations separated at bottom), header (theme toggle + currency switcher), dashboard cards (risk meter, health score, allocation pie, projection chart, recommendations panel with Accept/Dismiss, scenario input + chips), Holdings table, Reports list, client-facing report view, Explanations glossary
- Apply the exact color palette, typography (IBM Plex Sans/Mono + Fraunces), and 11px minimum text sizing from the UI/UX Design Brief
- Wire every component to the real backend endpoints from Phases 2–7, replacing all static/mock data
- Preserve every accessibility requirement already specified (aria-labels, tablist roles, form labels, approval checkbox labeling) — do not regress these while rebuilding
- **Done when:** the running app on `localhost` visually matches the mockup and every number/chart on screen is real data from the backend, not hardcoded

## Phase 9: UI Polish
- Loading states for market data fetch, Gemini call, and report generation (these can take a few seconds — must not look frozen)
- Empty states (no clients yet, no holdings uploaded yet, no reports yet) per App Flow doc
- Error states (upload column mismatch, market data fallback notice, Gemini failure notice) per App Flow doc
- Responsive check at mobile width — sidebar collapses gracefully
- **Done when:** every empty/error/loading state listed in the App Flow doc has been manually triggered and looks intentional, not broken

## Phase 10: Testing
- Manually walk through Core User Journey 1 (full analysis-to-report cycle) and Core User Journey 2 (new client onboarding) end to end, on `localhost`, using real API calls (no mocks)
- Fix any edge cases found: malformed Excel uploads, a client with zero holdings, Finnhub down, Gemini timeout
- Confirm audit log entries are actually being written and are readable
- **Done when:** both journeys complete without manual data patching or console errors

## Phase 11: Deploy
- Push finished, working local project to a GitHub repository (advisor's own `git push`, at the advisor's discretion — not automated)
- Deploy backend to Render or Railway; set `GEMINI_API_KEY` and `FINNHUB_API_KEY` as environment variables there (never committed to the repo)
- Deploy frontend to Vercel or Netlify; set `VITE_API_BASE_URL` to the deployed backend's URL
- Confirm CORS is enabled on the backend for the deployed frontend's origin
- **Done when:** the deployed Vercel/Netlify link works standalone, with no `localhost` dependency, and produces the same real, live results as the local version

## Overall Done Criteria
All 9 success metrics from the PRD are met: sub-15-minute report generation, demonstrable time savings over manual analysis, risk/goal-aligned recommendations, a working live data integration (Finnhub/yfinance + Gemini), full compliance/audit logging, a mandatory human-in-the-loop approval gate before any report is considered final, and the whole system running correctly both on `localhost` and on its final deployed link.
