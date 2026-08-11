# 07 — Progress Summary (Phases 1–8 complete, Phase 9–11 remaining)

Written 2026-08-06. Purpose: let a fresh session pick up exactly where this one left off, with zero ambiguity about what's built, what's verified, and what's still open. Phase numbers below match [06_Implementation_Plan.md](06_Implementation_Plan.md).

---

## 1. Where things stand, in one paragraph

The full app — backend (FastAPI, deterministic math + Gemini narration-only) and frontend (React/Vite, pixel-matched to the mockup) — is built and running locally (backend on `:8010`, frontend on `:5173`, see `.claude/launch.json`). Every core feature from the PRD/TRD is wired to real data: portfolio analysis, scenario simulation, recommendations, compliance flags, Monte Carlo projections, sector look-through, AI narration, PDF report generation with an approval gate, and full multi-client CRUD. Six real clients currently exist in `backend/data/clients/`, five of them with real uploaded holdings. Phases 1–8 (Setup through full frontend rebuild) are done. Phase 9 (systematic empty/loading/error-state polish) has only been done ad hoc, in reaction to specific bugs — not as a full sweep. Phase 10 (structured end-to-end testing) has not been run as a checklist. Phase 11 (deployment) has not been started at all.

---

## 2. Phases 1–8: build history

### Phase 1 — Setup
Backend venv + FastAPI/uvicorn scaffold, `.env` with `GEMINI_API_KEY`/`FINNHUB_API_KEY`, Vite+React frontend scaffold, both servers verified booting clean.

### Phase 2 — Data layer
JSON file storage (`clients/index.json`, per-client files, `strategies.json`, `audit_log.json`, `reports/`). `excel_parser.py` built and tested — tolerates column-name variants, outputs normalized holdings JSON. Margaret Chen seeded as the first real demo client.

### Phase 3 — Market data
`finnhub_client.py` (primary) + `yfinance_client.py` (fallback), wired into `GET /clients/{id}/market-data`, live-tested against Margaret Chen with real current prices (not hardcoded).

### Phase 4 — Deterministic optimizer
`optimizer.py`: current allocation %, diversification risk score, investment health score (2 real weighted components — allocation drift + concentration, not the mockup's 5 fictional factors), drift vs. target. Wired into `GET /clients/{id}/analysis`, hand-verified against Margaret Chen.

### Phase 5 — Scenario simulator
`scenario_simulator.py`: preset shocks (rate hike +100bps, recession, tech selloff −25%) plus free-text scenario matching. Wired into `POST /clients/{id}/scenario`. Later extended into a **34-scenario archetype library** with Gemini used purely as a *classifier* (matching free text to one of the 34 pre-built deterministic archetypes) — Gemini never invents the shock math, only picks which existing archetype applies.

### Phase 6 — Recommendation matcher + Gemini orchestration
`recommendation_matcher.py`: HIFO tax-lot-aware trade suggestions (ticker, action, quantity, account, estimated tax impact) comparing current allocation against the strategy library. `gemini_client.py`: sends deterministic outputs to Gemini for narration only — Gemini is instructed it must never compute or invent a number, only explain numbers already computed by backend code. Wired into `POST /clients/{id}/insights`. Full pipeline verified via curl with no faked data at any step.

### Phase 7 — Compliance & reporting
- `audit_log.py`: every insights/recommendation call appends an entry.
- `compliance.py`: real per-client rules — `check_concentration` (>25% single-position threshold) and `check_wash_sale_risk` (loss-realizing SELL + same-ticker lot bought within 30 days), plus `standard_disclosures()` (always-present, client-independent).
- `report_store.py` + `routers/reports.py`: `POST /clients/{id}/reports` assembles scores/allocation/projection/accepted-trades/AI-narrative/disclosures into a draft report; `PATCH /reports/{id}/approve` is the human-in-the-loop gate — a report cannot be "final" until explicitly approved.
- Extended later with real **sector look-through** (position-level sector classification, aggregated) and a **Monte Carlo projection** (`projection.py` rewritten from a simple deterministic curve to a real simulation).

### Phase 8 — Frontend rebuild
Every mockup section (`design mockup/Portfolio_Advisor_Assistant_New.html`) rebuilt as real React + shadcn/ui components, pixel-matched via `getComputedStyle` extraction (not eyeballed) — colors, IBM Plex Sans/Mono + Fraunces typography, 11px minimum text sizing, all from the UI/UX Design Brief. Sections rebuilt and individually side-by-side verified against the mockup:
- Sidebar nav + header (theme toggle + currency switcher)
- Scores/Health card (gauge + meter), Allocation donut, Projection chart (hand-built SVG, no chart library)
- AI Recommendations panel (Accept/Dismiss, structured cards)
- Scenario analysis card
- Sector exposure card, Compliance card (bullet-list style), Retirement funding card
- 2-column lower-dashboard grid layout, full dashboard grid reimagined for real card proportions
- Holdings page (real tax-lot table, ticker/quantity/cost-basis/market-value/weight/return/account)
- Reports list page + Generate report button
- Client report view page (client-facing, Fraunces headline, approval checkbox, print CSS, `window.print()` → PDF)
- Clients page (table, Add Client dialog, Client-action dialog, drag-and-drop upload sub-view) — all 4 extracted mockup states rebuilt pixel-for-pixel
- Explanations page (glossary, mockup-matched + extended content)

Every number/chart on screen is real backend data — confirmed via live browser testing with no console errors, at each stage.

---

## 3. Feature-by-feature status

### Holdings
Real tax-lot holdings table (ticker, name, quantity, cost basis, market value, weight, return, account), "Total corpus"/"Total returns" summary, cash row, TOTAL row. "Add holding" button is intentionally disabled (holdings are imported via Excel upload or manual-entry endpoint, not an inline add — documented via its own `title` tooltip). **Confirmed working.**

### Reports + Generate report + Client report view
- `POST /clients/{id}/reports` → draft report with real scores/allocation/projection/trades/AI narrative/disclosures.
- Client report view: client-facing page, approval checkboxes per recommended trade, status states (draft/approved), print CSS, Download PDF via `window.print()`.
- **Two rounds of pagination bugs fixed**: first a hardcoded 2-page split, then made properly dynamic (page count driven by actual content length, not a fixed assumption) — verified via live PDF generation and content-parity check (extracted text from a real generated PDF, e.g. `report_eur2.pdf`, confirmed the numbers/pages matched the on-screen report exactly).
- **Confirmed working**, including PDF export producing a real, correctly-paginated multi-page document with real numbers.

### Clients page
Table (search, counts, status badges), Add Client dialog (wired to `POST /clients` with server-generated ID), delete with confirmation (backend `DELETE /clients/{id}` — confirmed working after an earlier delete-not-working bug was fixed), drag-and-drop upload (real endpoint), manual holdings entry (`POST /clients/{id}/holdings/manual`), original uploaded file persisted and openable via "Data source." **Confirmed working** — 6 real clients currently on file (see §6).

### Explanations page
Mockup-matched glossary, extended with real content beyond the mockup's placeholder text. **Confirmed working.**

---

## 4. Bug-fix rounds (chronological)

1. **`extractDollarFigure` aria-label bug** — fixed using `tax_detail` instead of a fragile string-parse.
2. **Delete-not-working bug** — investigated and fixed on the Clients page.
3. **Client ID migration** — risk assessed, decision made to keep the existing ID scheme rather than migrate.
4. **Clients table column alignment** — re-extracted from mockup and fixed.
5. **Gemini API key diagnosis** — built a standalone diagnostic script (early investigation, precursor to the model-alias fix in §4.11).
6. **Sector classification expansion** — `sector_classification.py`'s ticker map extended for broader real-ticker coverage.
7. **34-scenario archetype library** — built out, with Gemini wired as classifier-only (see Phase 5 above).
8. **Dashboard redundant market-data fetching** — backend was re-fetching live prices multiple times per dashboard load across separate endpoints; fixed to fetch once and reuse.
9. **Report generation parallelization** — the report's two independent Gemini calls (main narrative + compliance-flag narration) were sequential; changed to fire concurrently via `ThreadPoolExecutor`, roughly halving the AI-call portion of report-generation latency.
10. **Sidebar "Clients" nav false-active state** — was showing active on client subpages (Dashboard/Holdings/Reports) when it shouldn't; fixed.
11. **PDF pagination** — see §3 (Reports).
12. **Full dynamic currency conversion** — built out: `services/exchange_rate_service.py` (backend), `routers/exchange_rates.py`, wired through `lib/format.ts` and a new `CurrencyProvider` context so every dollar figure across every page (Dashboard, Holdings, Clients, Reports, PDF export) can display in a selected currency, converted from the real USD-denominated backend figures — not a static display-only relabel.
13. **Ledger feature — built then fully removed.** A ledger page/nav item was built (`services/audit_log.py` additions, `ledger-page.tsx`, sidebar/header wiring) and then deliberately removed in full (including deleting `ledger-page.tsx`) after review determined it didn't belong in this version's scope. Worth knowing so a fresh session doesn't go looking for it or wonder why audit_log.py has residual shape from that work.
14. **Total Corpus bug (this session)** — a brand-new client's advisor-typed "Starting Corpus" estimate was flowing into real `cash_balance`, which fed both the Clients-table "Corpus" column and the Dashboard's `total_portfolio_value`, showing a fabricated number before any holdings existed. **Fixed**: `POST /clients` now always initializes `cash_balance: 0`; the typed estimate is stored separately as `starting_corpus_note` (pure metadata, feeds no calculation). `services/holdings.py`'s `summarize_for_list()` now returns `corpus: null`/`return_pct: null` whenever a client has zero holdings, regardless of any stray cash value. Frontend (`clients-page.tsx`, `dashboard-page.tsx`) updated to render `—` / a real empty state ("No portfolio data yet — upload holdings to see analysis," per the App Flow doc's existing spec) instead of any number. **Verified live** with a real test client and screenshot; test client deleted after verification.
15. **Compliance flags — verified as real per-client computation (this session)**, not a static fallback. Tested live against all 4 pre-existing real clients: margaret-chen (VOO 49.3% → concentration flag + wash-sale flag), third-test-client (MSFT 62.9% + BND 37.1% → two concentration flags), WAC-0107/Robert and WAC-0110/Daniel (both genuinely diversified, max single position 21.5% → correctly only the 2 standard disclosures, no false flags). Every flagged percentage matched the client's real holdings weight exactly. Confirmed `routers/portfolio.py` (`/compliance`, used by the Dashboard) and `routers/reports.py` (PDF generation) both call the identical `compliance.compute_compliance_flags()` with the same real per-client `holdings`/`position_values`/`recommendations` — the report just filters out `disclosure`-category flags since it has its own dedicated disclosures section. No code changes were needed here — this was a verification pass, not a fix.
16. **Gemini quota / model-alias fix (this session)** — the `429 RESOURCE_EXHAUSTED` errors seen with all previously-tried API keys were traced to `gemini-flash-latest`, a *floating alias* that resolves to whichever model Google currently designates "latest flash" (observed resolving to different underlying models, e.g. `gemini-3.6-flash`, across calls) — and that underlying model's free-tier per-project-per-model quota (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`) was exhausted. Testing the same current key directly against `gemini-2.5-flash` (the model the TRD actually specifies) succeeded immediately — quota was not globally exhausted, just exhausted for whatever `-latest` happened to point at. **Fixed**: `backend/services/gemini_client.py`'s `MODEL_NAME` pinned to `"gemini-2.5-flash"` instead of the alias, so it can't silently drift onto an exhausted model again. Required a full backend process restart to take effect — `uvicorn --reload`'s file-watcher lagged behind the edit, likely due to OneDrive sync interference on this project's folder (it lives under `OneDrive\Documents\`). **Verified live**: both `/compliance` narration and `/insights` narrative now return real Gemini-generated text with the same API key, no new key or new Google Cloud project needed.
17. **Tab title + favicon branding (this session)** — `frontend/index.html`'s `<title>` was the Vite default ("frontend"); changed to "Wealth Advisor Copilot". The favicon was Vite's unrelated default SVG; replaced with `frontend/public/favicon.svg`, a "WAC" monogram on a rounded square using the app's real `--primary` (`#2f5d46` forest green) / `--primary-foreground` (`#faf8f3` cream) tokens — matching the existing sidebar/report-header "WAC" badge exactly, just at icon scale.
18. **Investment Health score gauge text overflow (this session)** — `HealthDonut` (`frontend/src/components/charts/health-donut.tsx`) rendered the qualifier line as a single string `"/ 100 · NEEDS ATTENTION"` at a fixed font size; for the "NEEDS ATTENTION" case (the longest qualifier) this overflowed past the circle's edge and got visually clipped ("NEEDS ATTENTIO"), confirmed live on `third-test-client` (health score 20). **Fixed**: split into two separate lines ("/ 100" and the qualifier below it), with the qualifier's font size and SVG `textLength`/`lengthAdjust="spacingAndGlyphs"` compression applied only when the qualifier string is long (`"NEEDS ATTENTION"`), computed against the actual available inner-circle width at that line's vertical offset — so it's guaranteed to fit rather than relying on a font-size guess. Short qualifiers ("GOOD"/"FAIR") render unconstrained at their original size. **Verified live** on both the long case (third-test-client, "NEEDS ATTENTION" now fully visible) and a short case (Margaret Chen, "FAIR" — unaffected/still clean).

---

## 5. Confirmed-working vs. unverified

**Confirmed working (live-tested this session or a prior session, with screenshots/curl proof):**
- Full analysis pipeline (optimizer → scenario → recommendations → Gemini narrative) end to end
- Compliance flags as real per-client computation, feeding both Dashboard and PDF report identically
- Gemini narration (insights + compliance) working live with the current API key post model-pin fix
- Total Corpus bug fix — zero-holdings client shows a real empty state, not a fabricated number
- Currency conversion across Dashboard/Holdings/Clients/Reports
- PDF report generation with correct dynamic pagination and content parity vs. the on-screen report
- Clients CRUD (create/delete/upload/manual-entry), 6 real clients on file, 5 with real uploaded holdings
- Tab title, favicon, and Investment Health gauge text layout (this session's fixes)

**Not yet verified / open questions for a fresh session:**
- **No systematic Phase 9 polish pass has been run.** Every empty/loading/error state fixed so far was fixed reactively (because a specific bug was reported), not because someone walked every page checking every state per the App Flow doc. There may be other pages/states with the same category of issue as the corpus bug or the health-donut overflow that haven't surfaced yet simply because no one has looked.
- **No Phase 10 structured testing pass has been run.** Nothing has walked the full PRD's Core User Journey 1 (full analysis-to-report cycle) or Core User Journey 2 (new-client onboarding) end-to-end as a deliberate checklist, nor tested edge cases like a malformed Excel upload, Finnhub down, or a Gemini timeout mid-report.
- **Sample test-portfolio-file coverage — correction to a stated assumption.** This request described "Aisha Patel and Daniel Osei" as the 2 remaining unused sample portfolio files. Live investigation while writing this document found that is **no longer accurate**: all 5 sample files under `backend/sample_data/` and the various clients' `uploads/` folders have in fact already been exercised through the real upload flow —
  - `margaret_chen_holdings.xlsx` → margaret-chen
  - `robert_kim_holdings.xlsx` → WAC-0107 ("Robert")
  - `daniel_osei_holdings.xlsx` → WAC-0110 ("Daniel")
  - `aisha_patel_holdings.xlsx` → WAC-0112 (client named "jessi" — the sample file was uploaded, but under a different client display name than the file suggests)
  - `stress_test_client_holdings.xlsx` → WAC-0113 (client named "stress")

  All five show `holdings_source: "upload"` with the matching `original_filename` on the live client record. This likely happened very recently (during this same session, probably in a separate browser tab while this conversation was in progress) — the client roster grew from 4 to 6 between two `GET /clients` calls made earlier in this session. **What remains for Phase 10 isn't the upload step itself** — it's confirming these two newer clients' (WAC-0112 "jessi", WAC-0113 "stress") Dashboard, compliance flags, and PDF report all render correctly with real data, the same way this session already confirmed for margaret-chen/third-test-client/WAC-0107/WAC-0110.
- **OneDrive + `--reload` interaction** — confirmed once (§4.16) that `uvicorn --reload`'s file-watcher can lag behind a saved edit on this project (it lives under `OneDrive\Documents\`), requiring a manual process restart to be sure a change is live. Worth remembering as a standing gotcha for any future backend edit + live-verification cycle, not just that one incident.

---

## 6. Current real client roster (as of this writing)

| ID | Name | Holdings | Source |
|---|---|---|---|
| margaret-chen | Margaret Chen | 4 | seeded (Phase 2) |
| third-test-client | Third Test Client | 2 | manual/test |
| WAC-0107 | Robert | 8 | upload (robert_kim_holdings.xlsx) |
| WAC-0110 | Daniel | 9 | upload (daniel_osei_holdings.xlsx) |
| WAC-0112 | jessi | 7 | upload (aisha_patel_holdings.xlsx) |
| WAC-0113 | stress | 10 | upload (stress_test_client_holdings.xlsx) |

---

## 7. What remains

### Phase 9 — Systematic UI polish (not yet done as a sweep)
Per the Implementation Plan's own Phase 9 criteria: walk **every page** (Clients, Dashboard, Holdings, Reports, Client report view, Explanations) and deliberately trigger:
- Loading states (market data fetch, Gemini call, report generation — must not look frozen for the few seconds these real calls take)
- Empty states (no clients yet, a client with no holdings yet — now fixed for Dashboard/Clients table, but not re-verified across Holdings/Reports/Client-report for the same zero-holdings client; no reports generated yet)
- Error states (upload column mismatch, market-data fallback notice, Gemini failure notice)
- Responsive/mobile-width check — confirm sidebar collapse behavior still holds up after all the changes made since it was last verified

Done when every state in the App Flow doc has been manually triggered and looks intentional, not broken — the health-donut and total-corpus bugs are examples of exactly the category of issue this sweep exists to catch before a user finds them.

### Phase 10 — Structured end-to-end testing (not yet run as a checklist)
- Walk Core User Journey 1 (full analysis-to-report cycle) and Core User Journey 2 (new-client onboarding) end to end on `localhost`, using real API calls only.
- Validate the two newer real clients' (WAC-0112 "jessi"/Aisha Patel data, WAC-0113 "stress") Dashboard, compliance flags, and generated PDF report — this is the corrected remaining task per §5, not re-uploading files that are already uploaded.
- Deliberately break things: malformed Excel upload, Finnhub down (or rate-limited), Gemini timeout mid-report — confirm each fails gracefully rather than crashing or showing a fabricated number.
- Confirm audit log entries are actually being written to `audit_log.json` and are readable/correct.
- Done when both journeys complete with no manual data patching and no console errors.

### Phase 11 — Deployment (not started)
- Push the repo to GitHub (advisor's own `git push`, at their discretion).
- Deploy backend to Render or Railway; set `GEMINI_API_KEY` and `FINNHUB_API_KEY` as environment variables there — never commit them.
- Deploy frontend to Vercel or Netlify; set `VITE_API_BASE_URL` to the deployed backend's URL.
- Confirm CORS is enabled on the backend for the deployed frontend's real origin.
- Done when the deployed link works standalone with no `localhost` dependency and produces the same real, live results as local.

---

## 8. Quick-reference: running locally

```bash
# Terminal 1 — backend (from repo root)
backend/venv/Scripts/python.exe -m uvicorn main:app --reload --port 8010 --app-dir backend

# Terminal 2 — frontend (from repo root)
npm run dev --prefix frontend
```
Open `http://localhost:5173`. Exact commands mirror `.claude/launch.json`. If a port is already in use, `--port <n>` for uvicorn and `-- --port <n>` for the Vite `npm run dev` command both work — remember to keep `frontend/src/lib/api.ts`'s backend base URL in sync if the backend port changes.
