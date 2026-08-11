# 04 — UI/UX Design Brief

## Aesthetic
Warm, editorial, and trustworthy — not a generic dark-mode SaaS dashboard. Think a well-designed print-inspired financial publication rendered as software: cream paper tones, forest green as the grounded primary, a warm terracotta accent for emphasis. Calm and confidence-inspiring, appropriate for a financial product used by advisors and by older clients — never dense, never "dev tool" styled. Explicitly rejected: plain black/white/indigo shadcn defaults (recognized as the generic "AI slop" look).

## Color Palette
Extracted directly from the existing mockup (`Portfolio_Advisor_Assistant_New.html`) — use these exact values, do not substitute:

**Light mode (primary/base tones):**
- Background (paper): `#FDFBF6`, `#FAF8F3`, `#F2EEE4`, `#F3EFE5`, `#F4EFE6`
- Card/surface: `#EDE8DC`
- Border: `#E0D9CB`, `#E6E0D3`, `#CFC7B8`
- Primary text: `#241F1A`
- Secondary text: `#5C5348`
- Muted/tertiary text: `#9A9184`, `#7A7166`, `#4A423A`

**Dark mode:**
- Background: `#1D1915`, `#14110E`

**Brand / accent:**
- Primary (forest green): `#2F5D46` (also `#2F6B45`, `#4E8B57`, `#9FBCA9` as tints/variants)
- Secondary accent (terracotta): `#96591A` (also `#C4712B`, `#D9A05B`, `#E08D7E`, `#D3A32F` as variants)
- Negative/alert (muted red, not harsh): `#A83A2C`

Apply the 60-30-10 rule: ~60% neutral/paper base, ~30% secondary muted tones, ~10% the green/terracotta accents for emphasis (CTAs, active states, key numbers).

## Typography
- **IBM Plex Sans** — all UI text and body copy
- **IBM Plex Mono** — all numbers, tickers, and the holdings table (tabular figures, aligned decimals) — this is a deliberate choice for financial legibility, do not substitute a proportional font for numeric data
- **Fraunces** (serif) — used *only* on the client-facing report view, for the client's name and the headline portfolio value; everywhere else stays in Plex Sans
- Do not use Inter, Poppins, or any generic default sans-serif anywhere in the app
- Minimum font size across the entire UI: **11px**, with **12px preferred** wherever space allows. Nothing should go below 11px except an optional copyright/legal footer line. (This was a specific fix applied to the mockup — the target audience skews older and legibility takes priority over density.)

## Component Style
- Rounded corners (soft, not sharp) on cards and buttons, consistent with the warm/editorial tone
- Flat surfaces with subtle borders rather than heavy drop shadows — the existing mockup uses border-based card separation, not shadow-heavy elevation
- Trade suggestion rows: bordered card rows with a colored left accent/badge distinguishing BUY (green-tinted) vs SELL (red-tinted), Accept/Dismiss as a compact icon-button pair per row
- Scenario chips: pill-shaped toggle buttons ("Rate hike +100bps", "Recession", "Tech selloff −25%"), active state shown via filled background + accent border color, matching the existing chip pattern in the mockup

## Dark / Light Mode
Both required, implemented as a genuine CSS custom-property swap (not two hardcoded stylesheets), toggled via a header button. Dark mode uses the `#1D1915` / `#14110E` background tones with the same accent colors adjusted for contrast as needed.

## Reference / Inspiration
The existing Claude Design mockup (`Portfolio_Advisor_Assistant_New.html`) **is** the reference — this is a rebuild-to-match task, not a fresh direction. Match its palette, typography, spacing, and layout patterns exactly; do not reinterpret or modernize the look.

## Key UI Patterns
- Cards for each dashboard module (risk meter, health score, allocation pie, projection chart, recommendations panel, scenario input)
- A tab-like navigation pattern (`role="tablist"`) for Dashboard / Holdings / Reports within a client's context
- Tables (IBM Plex Mono, tabular figures) for the holdings list
- Sidebar for client switching and primary navigation
- A distinct, simplified layout for the client-facing report (no nav chrome, no editing controls — just the polished report + "Download PDF" + currency code near "Prepared for [Client Name]")

## Mobile / Responsiveness
Desktop-first (primary user is an advisor at a desk), but must remain usable and not visually broken at mobile widths — sidebar can collapse to an icon rail or drawer at narrow widths.

## Accessibility (carried over from the mockup's completed accessibility pass — must be preserved, not just added later)
- Every icon-only button (sidebar toggle, theme toggle, Accept/Dismiss on each trade row) has a specific `aria-label` built dynamically from that row's content — not a generic repeated string (e.g. "Dismiss: sell 190 sh of AAPL in Taxable, $47,500")
- Every decorative SVG icon next to visible text has `aria-hidden="true"`
- Dashboard/Holdings/Reports nav wrapped in `role="tablist"`, each item `role="tab"` with `aria-selected`
- The scenario analysis text input has a real associated `<label>` (visually hidden via sr-only styling is acceptable), not just a placeholder
- The human-in-the-loop approval checkbox has a proper `<label>` tied via `htmlFor`/`id` — this is treated as the single most important control on the page from an accessibility standpoint, since it gates what reaches a client
- Text sizing floor of 11px applies here too — accessibility and legibility are the same requirement in this product
