# 03 — App Flow (Navigation & User Journey Map)

## Pages List
- `/` — redirects to Dashboard for the last-viewed (or first) client
- `/clients` — Clients list (sidebar entry point; picking a client is how every session starts)
- `/dashboard` — main advisor view for the selected client: portfolio optimization, financial modeling, AI recommendations, scenario analysis, "Generate report" action
- `/holdings` — detailed client holdings table (ticker, quantity, cost basis, account type)
- `/reports` — list of generated reports for the selected client, and the report generation trigger
- `/reports/:reportId/client-view` — the simplified client-facing report (no editing controls, "Download PDF", "Prepared for [Client Name]")
- `/explanations` — standing glossary/reference page (not per-client)

## Navigation Structure
- Left sidebar, persistent across all pages, matching the finalized order from the mockup's accessibility/reorder pass:
  1. **Clients** (top — entry point for every session)
  2. **Dashboard**
  3. **Holdings**
  4. **Reports**
  5. *(divider / "Reference" label group)*
  6. **Explanations** (bottom, separated — standing glossary, not per-client)
- Dashboard/Holdings/Reports render as a `tablist` (`role="tablist"`, each item `role="tab"`, `aria-selected` on the active one) once a client is selected
- Header toolbar (top, persistent): theme toggle (light/dark) + currency switcher dropdown (USD/EUR/GBP/JPY), shown as a matched pair of controls
- "Generate report" is a prominent header action, always visible on the Dashboard

## First Screen (new session)
Advisor lands on `/clients` if no client has been previously selected in this session, showing the client list (e.g. Margaret Chen + 2–3 other demo names). Selecting a client routes to `/dashboard` for that client.

## Auth Flow
None — out of scope for this version. App opens directly to the client list; no login/signup/onboarding sequence.

## Core User Journey 1 — Full analysis-to-report cycle
1. Advisor selects a client from `/clients` (e.g. Margaret Chen)
2. Lands on `/dashboard` — sees diversification risk score, investment health score, allocation pie chart, dual-line projection chart, and the AI recommendations panel already populated (from previously uploaded holdings + live market data)
3. Advisor reviews suggested rebalancing trades (e.g. "SELL 190 sh AAPL — Taxable — Est. LT gain $14.8K"), and Accepts or Dismisses each one individually
4. Advisor optionally types a scenario into the scenario analysis input, or picks a preset chip ("Rate hike +100bps" / "Recession" / "Tech selloff −25%"), and reviews the projected impact
5. Advisor clicks "Generate report"
6. System assembles the report from current data + accepted trades + compliance disclosures
7. Advisor reviews the draft report, checks the human-in-the-loop approval checkbox to confirm it's ready
8. Advisor opens the client-facing report view (`/reports/:reportId/client-view`) to see exactly what the client would see, and can download it as PDF

## Core User Journey 2 — New client onboarding (holdings upload)
1. Advisor goes to `/clients`, adds a new client entry (name, risk tolerance, goals — via a small form, since this isn't in a holdings export)
2. Advisor goes to `/holdings` for that client, uploads an Excel/CSV holdings export
3. Backend parses the file (tolerating column-name variants like "Symbol" vs "Ticker"), fetches live prices for each ticker, and stores the normalized portfolio as that client's JSON record
4. Advisor is routed to `/dashboard` for that client, where the newly calculated scores/charts/recommendations now populate

## Empty States
- `/clients` with zero clients: prompt to add the first client
- `/holdings` for a client with no uploaded portfolio yet: prompt to upload an Excel/CSV file, with a short note on expected columns
- `/dashboard` before any holdings are uploaded: cards show a clear "no portfolio data yet — upload holdings to see analysis" message rather than blank charts
- `/reports` with no generated reports yet: prompt to visit Dashboard and click "Generate report"

## Error States
- Excel upload with unrecognized/missing required columns: clear inline message naming which columns are missing, does not silently fail
- Finnhub rate-limited or unreachable: falls back to yfinance automatically; if both fail, dashboard shows a "market data temporarily unavailable, showing last known prices" notice rather than crashing
- Gemini API call fails/times out: dashboard still shows all deterministic numbers (scores, charts, tables) — only the plain-language AI narrative section shows a "insights unavailable, please retry" message; the app must never block on the AI call

## Modal / Drawer / Overlay Interactions
- Add new client: modal form (name, risk tolerance, goal, target retirement year)
- Approval checkbox: not a modal — an inline, clearly labeled checkbox directly on the report review screen, gating the "mark as ready" action

## Redirect Logic
- After selecting a client on `/clients` → `/dashboard` for that client
- After successful holdings upload on `/holdings` → stays on `/holdings` showing the parsed table, with a link to `/dashboard`
- After "Generate report" on `/dashboard` → `/reports` showing the new draft at the top
- After checking the approval box on a draft report → report status updates to "Approved"; advisor can then open the client-view link
