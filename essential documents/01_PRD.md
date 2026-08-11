# 01 — Product Requirements Document (PRD)

## App Name
Wealth Advisor Copilot

## Tagline
A GenAI-powered assistant that automates portfolio analysis, scenario modeling, and client-ready reporting for financial advisors.

## Problem
Financial advisors spend hours per client manually gathering portfolio data, analyzing holdings, running scenario models, and preparing reports. This limits how many clients an advisor can serve well, and slows down responsiveness when markets move. Advisors need a tool that does the heavy analytical lifting while they stay in control of every recommendation that reaches a client.

## Target User
A financial advisor at a small-to-mid-size wealth management practice, managing somewhere between 2 and 10 client households at once. They are not a developer or data scientist — they need clear, plain-language insights and a dashboard, not raw numbers or code. They are legally responsible for every recommendation that goes out, so they need to review and approve everything before it reaches a client. A secondary "user" is the client themselves, who only ever sees a simplified, polished report — never the internal working dashboard.

## Core Value Proposition
Unlike generic AI chat tools, this system never lets the AI invent financial numbers. All portfolio math (allocation, risk, projections, scenario impact) comes from deterministic calculations; the AI's only job is to explain and contextualize those numbers in plain language. Combined with a built-in compliance/audit layer and a mandatory human-in-the-loop approval step, this is designed to be defensible in a regulated context — not just a demo toy.

## Core Features (Must Have)
- Client selection sidebar (supports 2–10 clients for this version)
- Portfolio holdings upload via Excel/CSV, tolerant of column-name variation (e.g. "Symbol" vs "Ticker")
- Live market price fetch for all held tickers
- Portfolio optimization: diversification risk score + investment health score + allocation breakdown (current vs. target, e.g. 60/30/10 equities/fixed income/cash)
- Financial modeling: dual-line chart comparing current trajectory vs. projected trajectory toward the client's goal (e.g. retirement year)
- AI-generated plain-language insights and recommendations panel, grounded in the deterministic outputs above (never inventing numbers itself)
- Rebalancing trade suggestions with per-row Accept / Dismiss controls (e.g. "SELL 190 sh AAPL — Taxable — Est. LT gain $14.8K")
- Scenario analysis: free-text or preset scenario chips (e.g. "Rate hike +100bps", "Recession", "Tech selloff −25%") showing projected portfolio impact
- Compliance & audit layer: every AI-generated recommendation is logged with what data and calculations produced it; disclosure language shown wherever projections or recommendations appear
- Human-in-the-loop approval gate: a labeled checkbox/control that must be explicitly checked before anything can be marked as ready to send to a client — nothing auto-sends
- "Generate report" action that produces a client-facing report view from the same underlying data
- Separate client-facing report view: same data, no editing controls, polished for sharing/download as PDF
- Currency display switcher (USD, EUR, GBP, JPY) — display-only for this version, no live conversion math
- Light and dark theme support
- Explanations/glossary section (financial terms like basis points, expense ratio, Monte Carlo simulation, diversification risk score, tax-loss harvesting, long-term capital gain) as a standing reference, not per-client

## Nice to Have (v2 / if time allows)
- Real currency conversion via a live exchange-rate feed
- Multi-advisor support with per-advisor authentication
- Editable/custom scenario parameters beyond the preset chips
- Historical report archive with version comparison
- Direct client email delivery of the approved report (still gated by advisor approval)

## Out of Scope (this version explicitly will NOT do)
- Real brokerage/custodian account integration (all portfolio data comes from manual Excel upload, using fictional demo client data)
- Real user authentication/login system beyond a single advisor's local session
- Real-money trade execution — "Accept" on a trade suggestion only stages it to an internal blotter, it does not place a trade anywhere
- Real currency conversion math
- Multi-advisor accounts or permission tiers
- Mobile native app (web-responsive only)

## User Stories
- As an advisor, I want to upload a client's holdings spreadsheet so that I don't have to manually re-enter their portfolio.
- As an advisor, I want to see a diversification risk score and health score at a glance so that I can immediately spot a portfolio that needs attention.
- As an advisor, I want AI-generated plain-language insights grounded in real calculated numbers so that I can trust what I'm reading without re-deriving it myself.
- As an advisor, I want to accept or dismiss individual rebalancing trade suggestions so that I retain full control over what actually changes.
- As an advisor, I want to type or select a market scenario and see its projected impact on this specific client's portfolio so that I can proactively prepare them for market moves.
- As an advisor, I want a compliance/audit trail recorded automatically so that I can defend any recommendation if ever questioned.
- As an advisor, I must explicitly approve a report before it can be considered ready to send, so that nothing reaches a client without my sign-off.
- As a client, I want to view a clean, jargon-light report of my portfolio and the advisor's recommendations so that I understand my financial standing without needing to interpret the advisor's internal tools.

## Success Metrics
- Full report generation (upload → analysis → approved report) completes in under 15 minutes
- Advisor can review a full client portfolio + generate insights in noticeably less time than manual analysis (target: 20%+ faster than a manual walkthrough)
- Recommendations visibly align with the stated client risk tolerance and goal (test case: Margaret Chen, moderate-growth profile, retiring 2038)
- All required disclosures and audit log entries are present for every generated recommendation
- App runs fully end-to-end locally (`localhost`) with real live market data, not static mock numbers
