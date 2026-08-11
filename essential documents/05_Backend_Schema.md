# 05 — Backend Schema (Data Model, Storage & Auth)

## Storage Model
No database engine. Data is stored as structured JSON files on the backend's local disk, one logical "table" per file (or per-record file where noted). This is a deliberate choice for a single-advisor, 2–10 client scale — see TRD for rationale.

## "Table": clients index
**File:** `backend/data/clients/index.json`
```json
{
  "clients": [
    { "id": "margaret-chen", "name": "Margaret Chen", "risk_profile": "moderate-growth", "goal_year": 2038 }
  ]
}
```
- `id` — string, slug, unique, used as the filename key for that client's full record
- `name` — string
- `risk_profile` — string enum: `conservative` | `moderate-growth` | `balanced` | `aggressive-growth` | `esg-tilted`
- `goal_year` — integer, target milestone year (e.g. retirement)

## "Table": individual client record
**File:** `backend/data/clients/{client-id}.json`
```json
{
  "id": "margaret-chen",
  "name": "Margaret Chen",
  "age": 58,
  "risk_profile": "moderate-growth",
  "goal_year": 2038,
  "annual_contribution": 34000,
  "holdings": [
    {
      "ticker": "AAPL",
      "quantity": 380,
      "cost_basis_per_share": 145.20,
      "account_type": "taxable",
      "last_price": null,
      "last_price_updated_at": null
    }
  ],
  "target_allocation": { "equities": 0.60, "fixed_income": 0.30, "cash": 0.10 },
  "uploaded_at": "2026-08-03T00:00:00Z"
}
```
- `holdings[].account_type` — string enum: `taxable` | `401k` | `ira` | `roth_ira`
- `holdings[].last_price` / `last_price_updated_at` — populated at request time by the market data service, not stored stale long-term
- `target_allocation` — set from the client's risk profile via the strategy library, or manually overridden

## "Table": investment strategy library
**File:** `backend/data/strategies.json`
```json
{
  "strategies": [
    {
      "id": "moderate-growth",
      "label": "Moderate Growth",
      "target_allocation": { "equities": 0.60, "fixed_income": 0.30, "cash": 0.10 },
      "rebalancing_threshold_pct": 5,
      "typical_holdings": ["VOO", "BND", "AAPL", "MSFT"]
    }
  ]
}
```
- One entry per strategy: conservative income, balanced growth, moderate growth, aggressive growth, ESG-tilted
- `rebalancing_threshold_pct` — drift percentage that triggers a rebalancing suggestion

## "Table": audit log (append-only)
**File:** `backend/data/audit_log.json`
```json
{
  "entries": [
    {
      "id": "audit-0001",
      "client_id": "margaret-chen",
      "timestamp": "2026-08-03T10:15:00Z",
      "action": "recommendation_generated",
      "inputs_used": { "holdings_snapshot_id": "...", "market_data_timestamp": "...", "strategy_id": "moderate-growth" },
      "deterministic_outputs": { "diversification_score": 68, "health_score": 74, "drift": { "equities": 0.05 } },
      "ai_output_summary": "Suggested trimming AAPL concentration and increasing BND allocation.",
      "advisor_action": null
    }
  ]
}
```
- Every AI-generated recommendation must produce one entry here, recording exactly which deterministic numbers and which strategy fed it — this is the compliance/audit trail required by the PRD
- `advisor_action` — populated later: `"accepted"` / `"dismissed"` / `"approved_for_report"`, with timestamp

## "Table": generated reports
**File:** `backend/data/reports/{report-id}.json`
```json
{
  "id": "report-0001",
  "client_id": "margaret-chen",
  "generated_at": "2026-08-03T10:20:00Z",
  "status": "draft",
  "approved_at": null,
  "currency_display": "USD",
  "content": {
    "scores": { "diversification": 68, "health": 74 },
    "allocation": { "current": {}, "target": {} },
    "projection_chart_data": [],
    "accepted_trades": [],
    "ai_narrative": "...",
    "disclosures": ["Fictional client data for demonstration purposes.", "No custodian API is connected in this prototype."]
  }
}
```
- `status` — string enum: `draft` | `approved` — flips to `approved` only when the advisor checks the human-in-the-loop approval control; nothing downstream (e.g. client-view link) should be treated as final until this is `approved`

## Relationships
- `clients/index.json` entries map 1:1 to a `clients/{client-id}.json` file (by `id`)
- Each client record's `risk_profile` maps to one entry in `strategies.json` (by `id`), which supplies the default `target_allocation`
- `audit_log.json` entries reference `client_id` (foreign key by convention, not enforced by a DB — validate in code that the referenced client exists before writing)
- `reports/{report-id}.json` references `client_id` (same convention)

## Auth Provider
None for this version — no login system, single local advisor session. Out of scope per PRD.

## User Roles
Single implicit role: advisor (full read/write access to all local data). No permission tiers in this version.

## Sensitive Fields
- No real financial credentials, account numbers, SSNs, or payment data are ever stored — this app only stores fictional/demo holdings data (ticker, quantity, cost basis) and never connects to a real custodian
- API keys (`GEMINI_API_KEY`, `FINNHUB_API_KEY`) live only in backend `.env`, never in any JSON data file, never sent to the frontend

## File/Media Storage
- No file uploads are persisted as raw files after parsing — an uploaded Excel/CSV is read in-memory by `pandas`, normalized, and only the resulting structured JSON is written to disk. The original uploaded file itself is not retained.

## Webhooks / Event Triggers
None in this version — all actions are synchronous request/response (upload → parse → return; generate report → assemble → return).

## API Endpoint List (indicative — backend routers already outlined in TRD)
- `GET /clients` — list all clients
- `POST /clients` — add a new client (name, risk profile, goal)
- `GET /clients/{id}` — get one client's full record
- `POST /clients/{id}/holdings/upload` — upload Excel/CSV, parse, store
- `GET /clients/{id}/market-data` — fetch live prices for that client's holdings
- `GET /clients/{id}/analysis` — deterministic optimizer output (scores, allocation drift)
- `POST /clients/{id}/scenario` — run a scenario simulation, return projected impact
- `POST /clients/{id}/insights` — Gemini orchestration call, returns plain-language narrative (grounded in the analysis output above)
- `POST /clients/{id}/reports` — generate a new report (draft)
- `PATCH /reports/{id}/approve` — mark a report approved (human-in-the-loop gate)
- `GET /reports/{id}` — fetch a report (advisor or client view)
- `GET /audit-log?client_id=...` — fetch audit trail entries (optional, for review)
