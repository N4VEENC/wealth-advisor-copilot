import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"

type Category = "Risk" | "Returns" | "Tax" | "Accounts" | "Modeling"

type Term = {
  term: string
  abbr: string
  category: Category
  description: string
  formula: string
  note: string
}

const CATEGORIES: Category[] = ["Risk", "Returns", "Tax", "Accounts", "Modeling"]

// Every term/description/formula/note below is copied verbatim from the
// live mockup's own real, functioning Explanations page (search + category
// filter both actually work there) — this section is a pixel- and
// content-exact reproduction, not a paraphrase. Some notes reference the
// mockup's own fictional figures (e.g. Margaret's NVDA trim) exactly as
// extracted; this app's real Margaret Chen holds different tickers, but
// the note is illustrative commentary on the concept, not a live data
// binding, so it's kept verbatim rather than silently rewritten.
const GLOSSARY_TERMS: Term[] = [
  {
    term: "Assets under management",
    abbr: "AUM",
    category: "Accounts",
    description:
      "The total market value of client assets an advisor manages. Advisory fees are usually quoted as a percentage of it.",
    formula: "AUM = Σ (market value of every held position)",
    note: "Shown on the dashboard as Total corpus for a single client.",
  },
  {
    term: "Cost basis",
    abbr: "BASIS",
    category: "Tax",
    description:
      "What was originally paid for a position, including commissions. It sets the taxable gain when the position is sold.",
    formula: "Cost basis = quantity × average purchase price",
    note: "Imported from the holdings file; the Invested figure is the sum across all lots.",
  },
  {
    term: "Unrealized gain",
    abbr: "UGL",
    category: "Returns",
    description:
      "Profit on paper — the position has appreciated but has not been sold, so no tax is due yet.",
    formula: "Unrealized = market value − cost basis",
    note: "Margaret's $472,018 unrealized gain is why trimming NVDA has a tax cost.",
  },
  {
    term: "Compound annual growth rate",
    abbr: "CAGR",
    category: "Returns",
    description: "The single smoothed annual rate that would take a starting value to an ending value over a period.",
    formula: "CAGR = (End ÷ Start)^(1 ÷ years) − 1",
    note: "The projection chart's two paths run at 5.23% and 5.72% CAGR.",
  },
  {
    term: "Time-weighted return",
    abbr: "TWR",
    category: "Returns",
    description:
      "Return that strips out the effect of deposits and withdrawals, so it measures the portfolio's performance rather than the client's cash-flow timing.",
    formula: "TWR = Π (1 + rₜ) − 1, chained per sub-period",
    note: "The standard for comparing an advisor's results against a benchmark.",
  },
  {
    term: "Money-weighted return",
    abbr: "IRR",
    category: "Returns",
    description:
      "The discount rate that sets the net present value of all cash flows to zero — it reflects what the client actually experienced.",
    formula: "0 = Σ CFₜ ÷ (1 + IRR)^t",
    note: "Differs from TWR whenever large contributions land before a strong or weak stretch.",
  },
  {
    term: "Asset allocation",
    abbr: "AA",
    category: "Risk",
    description:
      "How a portfolio is split across asset classes — equities, fixed income and cash. It explains the large majority of return variance over time.",
    formula: "Weight of class = value of class ÷ total portfolio value",
    note: "Margaret sits at 65 / 25 / 10 against a 60 / 30 / 10 policy target.",
  },
  {
    term: "Allocation drift",
    abbr: "DRIFT",
    category: "Risk",
    description:
      "How far the current allocation has wandered from the policy target, usually because one asset class outperformed the rest.",
    formula: "Drift = actual weight − target weight (in percentage points)",
    note: "A ±3pp band is typical; Margaret's equity drift is +5.2pp, which triggers a review.",
  },
  {
    term: "Investment policy statement",
    abbr: "IPS",
    category: "Accounts",
    description:
      "The signed document that records a client's objectives, risk tolerance, target allocation, and the bands within which the advisor may operate.",
    formula: "— (a governing document, not a calculation)",
    note: "Every flag in this workspace is measured against the client's IPS.",
  },
  {
    term: "Rebalancing",
    abbr: "RBL",
    category: "Risk",
    description:
      "Selling what has grown beyond its target weight and buying what has fallen below it, returning the portfolio to its policy allocation.",
    formula: "Trade amount = (actual weight − target weight) × total value",
    note: "Margaret's 5pp equity trim equals $119,577 of trades.",
  },
  {
    term: "Standard deviation",
    abbr: "σ",
    category: "Risk",
    description: "The typical spread of returns around their average — the most common single measure of volatility.",
    formula: "σ = √[ Σ (rᵢ − r̄)² ÷ (n − 1) ]",
    note: "Quoted annualised: 11.2% today, 9.8% after the recommended rebalance.",
  },
  {
    term: "Sharpe ratio",
    abbr: "SR",
    category: "Risk",
    description:
      "Return earned above the risk-free rate per unit of volatility. Higher is better; it lets you compare portfolios with different risk levels.",
    formula: "Sharpe = (Rₚ − R_f) ÷ σₚ",
    note: "Below 0.5 is weak, above 1.0 is strong for a diversified portfolio.",
  },
  {
    term: "Beta",
    abbr: "β",
    category: "Risk",
    description:
      "Sensitivity to the broad market. A beta of 1.2 means the portfolio has historically moved 20% more than the index, up and down.",
    formula: "β = Cov(Rₚ, R_m) ÷ Var(R_m)",
    note: "Concentration in a few large-cap names pushes beta above 1.",
  },
  {
    term: "Maximum drawdown",
    abbr: "MDD",
    category: "Risk",
    description:
      "The largest peak-to-trough fall over a period — the loss a client would have had to sit through at the worst moment.",
    formula: "MDD = (trough value − peak value) ÷ peak value",
    note: "The recession stress test shows a −14.1% drawdown for this portfolio.",
  },
  {
    term: "Duration",
    abbr: "DUR",
    category: "Risk",
    description: "How sensitive a bond or bond fund is to interest-rate moves, expressed in years.",
    formula: "ΔPrice ≈ − duration × Δyield",
    note: "Blended duration of 6.1 years means a 100bp rise costs roughly 6.1% of bond value.",
  },
  {
    term: "Yield to maturity",
    abbr: "YTM",
    category: "Returns",
    description:
      "The total annualised return a bond delivers if held to maturity and every coupon is reinvested at the same rate.",
    formula: "Price = Σ C ÷ (1+y)^t + F ÷ (1+y)^n",
    note: "Rising YTM is why a rate shock hurts now but helps later.",
  },
  {
    term: "Basis point",
    abbr: "BPS",
    category: "Returns",
    description: "One hundredth of a percentage point. Used to avoid ambiguity when quoting small changes in rates and fees.",
    formula: "1 bp = 0.01% = 0.0001",
    note: '"+100bps" in the scenario chips means a one-percentage-point rate rise.',
  },
  {
    term: "Expense ratio",
    abbr: "ER",
    category: "Tax",
    description: "The annual cost of owning a fund, deducted from returns before they reach the client.",
    formula: "ER = annual fund costs ÷ average fund assets",
    note: "Projections here are net of a 0.62% blended advisory and fund fee.",
  },
  {
    term: "Tax-loss harvesting",
    abbr: "TLH",
    category: "Tax",
    description:
      "Selling a position at a loss to offset realised gains elsewhere, then reinvesting in a similar but not substantially identical holding.",
    formula: "Tax saved ≈ realised loss × marginal capital-gains rate",
    note: "Watch the 30-day wash-sale window either side of the trade.",
  },
  {
    term: "Long-term capital gain",
    abbr: "LTCG",
    category: "Tax",
    description: "Gain on an asset held more than a year, taxed at preferential rates rather than as ordinary income.",
    formula: "LTCG = sale proceeds − cost basis (holding > 12 months)",
    note: "The suggested trims realise $49.4K of LTCG, about $7.4K of tax.",
  },
  {
    term: "Monte Carlo simulation",
    abbr: "MC",
    category: "Modeling",
    description: "Running thousands of randomised market paths to express an outcome as a probability rather than a single forecast.",
    formula: "P(goal) = paths meeting the goal ÷ total paths simulated",
    note: "Every projection here is the median of 10,000 paths.",
  },
  {
    term: "Diversification risk score",
    abbr: "DRS",
    category: "Modeling",
    description: "A 0–100 concentration measure built from position weights, sector overlap and correlation. Lower is better.",
    formula: "DRS = 100 × normalised Σ wᵢ² (Herfindahl concentration)",
    note: "68 sits in the Elevated band; the target for a moderate-growth profile is ≤ 55.",
  },
  {
    term: "Investment health score",
    abbr: "IHS",
    category: "Modeling",
    description: "A weighted composite of five factors — diversification, cost, tax posture, goal alignment and liquidity.",
    formula: "IHS = Σ (factor score × factor weight)",
    note: "74 / 100 is Good; diversification at 58 is the factor dragging it down.",
  },
  {
    term: "Required minimum distribution",
    abbr: "RMD",
    category: "Accounts",
    description:
      "The amount that must be withdrawn each year from a tax-deferred account once the account holder reaches the qualifying age.",
    formula: "RMD = account balance ÷ IRS life-expectancy factor",
    note: "Relevant for Margaret from the mid-2040s, not in this review window.",
  },
]

// Beyond the mockup's generic glossary above: what THIS app actually
// computes, with real formulas pulled straight from the backend services
// that run them — not textbook definitions. Two of these (Diversification
// score, Health score) deliberately use different math than the generic
// entries above; that's flagged explicitly in each description rather than
// left as a silent contradiction.
const EXTENDED_TERMS: Term[] = [
  {
    term: "This app's Diversification score",
    abbr: "DRS·APP",
    category: "Modeling",
    description:
      "Not the generic Herfindahl metric above. This app blends how concentrated your equity holdings are with how many distinct tickers you hold — and here, higher is better, the opposite direction of the generic DRS entry.",
    formula: "score = 0.7 × (1 − largest equity position ÷ equities value) × 100 + 0.3 × min(tickers ÷ 5, 1) × 100",
    note: "backend/services/optimizer.py. Doesn't look through a fund's underlying holdings — VOO counts as one position, same as AAPL.",
  },
  {
    term: "This app's Investment health score",
    abbr: "IHS·APP",
    category: "Modeling",
    description:
      "Not the five-factor composite above. This build only computes two factors — allocation drift and single-position concentration. There's no cost, tax-posture, or liquidity component anywhere in this codebase.",
    formula: "score = 0.6 × (100 − total drift ÷ 30pp × 100) + 0.4 × concentration-threshold component",
    note: "backend/services/optimizer.py. A position over 25% of the portfolio is what starts pulling the concentration component down.",
  },
  {
    term: "HIFO lot consumption",
    abbr: "HIFO",
    category: "Tax",
    description:
      "When this app suggests trimming a position, it always sells the highest-cost-basis lots first — not the oldest (FIFO) and not the cheapest — which minimizes the taxable gain the trade realizes.",
    formula: "Sell order: lots sorted by cost_basis_per_share, descending",
    note: "backend/services/recommendation_matcher.py. Each consumed lot's gain is still classified long- vs. short-term individually — one sale can realize a mix of both.",
  },
  {
    term: "Short-term capital gain",
    abbr: "STCG",
    category: "Tax",
    description:
      "Gain on an asset held one year or less, taxed as ordinary income rather than at LTCG's preferential rate.",
    formula: "STCG = sale proceeds − cost basis (holding ≤ 12 months)",
    note: "A lot with no recorded purchase date is treated as short-term here — the more conservative, higher-tax assumption when a lot's true age is unknown.",
  },
  {
    term: "Probability of reaching goal",
    abbr: "P(GOAL)",
    category: "Modeling",
    description:
      "This app runs 10,000 simulated market paths per client, each drawing a random annual return for equities/fixed income/cash from illustrative mean/volatility assumptions. The probability shown is just the share of paths that end at or above the goal amount.",
    formula: "P(goal) = count(paths ≥ goal amount) ÷ 10,000",
    note: "backend/services/projection.py. The return assumptions are rough textbook figures, not a calibrated forecast — read the probability as illustrative, not a guarantee.",
  },
  {
    term: "Sector look-through",
    abbr: "LOOKTHRU",
    category: "Modeling",
    description:
      "For a broad fund like VOO, this app has no data provider for its real current constituent weights, so it blends in a static, documented snapshot of approximate S&P 500 sector weights instead.",
    formula: "sector value += fund position value × approximate sector weight",
    note: 'backend/services/sector_classification.py. Always labeled "approximate index composition" wherever shown — a snapshot, not live look-through data.',
  },
  {
    term: "Concentration flag",
    abbr: "CONC·FLAG",
    category: "Risk",
    description:
      "This app automatically flags any single ticker exceeding 25% of the total portfolio value, escalating to high severity above 37.5%.",
    formula: "flag if position value ÷ total portfolio value > 25%",
    note: "backend/services/compliance.py — the same 25% threshold the Health score's concentration component also uses.",
  },
  {
    term: "Wash-sale risk flag",
    abbr: "WASH·FLAG",
    category: "Tax",
    description:
      "This app flags a recommended sale if it would realize a loss on a lot, and that same ticker also has another lot purchased within 30 days of today — the IRS's wash-sale replacement window.",
    formula: "flag if (sale realizes a loss) AND (a same-ticker lot was bought within ±30 days)",
    note: "backend/services/compliance.py. A real risk flag, not a final IRS determination — a real case needs the full post-trade lot ledger and professional tax advice.",
  },
  {
    term: "Rebalance-to-target sizing",
    abbr: "REBAL",
    category: "Risk",
    description:
      "Once a bucket's drift exceeds its strategy's own rebalancing threshold, this app doesn't trade back to the edge of the tolerance band — it sizes the trade to bring that bucket all the way back to its target allocation share.",
    formula: "trade amount = current bucket value − (target weight × total portfolio value)",
    note: "backend/services/recommendation_matcher.py. The threshold decides whether to rebalance; the target allocation decides how far.",
  },
  {
    term: "Scenario shock library",
    abbr: "SCEN·LIB",
    category: "Modeling",
    description:
      "This app doesn't generate scenario shocks on the fly. Typing free text or clicking a preset chip matches your input to one of 34 pre-built, hand-specified shock archetypes (rate moves, sector shocks, currency shocks, macro regimes) — each with its own fixed equities/fixed-income/sector impact percentages already baked in.",
    formula: "resolve: exact id/label match → keyword substring match → Gemini classifier (existing id only) → error if none match",
    note: 'backend/services/scenario_simulator.py (34 entries in SCENARIOS) + services/gemini_client.py\'s classify_scenario. Gemini\'s only role is picking which existing archetype best fits free text — it never invents a magnitude, and routers/scenarios.py re-validates the returned id is a real one before trusting it.',
  },
  {
    term: "Currency display conversion",
    abbr: "FX·DISP",
    category: "Accounts",
    description:
      "Every dollar figure in this app is computed and stored in USD. Switching the currency selector doesn't recompute anything — it multiplies that same real USD figure by a live exchange rate at the moment of display, everywhere at once.",
    formula: "displayed value = USD amount × rate(currency) — rate labeled live | cached-fresh | cached-stale | fallback",
    note: "backend/services/exchange_rate_service.py (open.er-api.com, 1-hour cache) + frontend/src/components/providers/currency-provider.tsx. Falls back to the last successfully-fetched rate if the live source fails, then to a documented static table only if no live rate was ever fetched — never silently shown as current when it isn't.",
  },
  {
    term: "Stale-price fallback",
    abbr: "STALE·PX",
    category: "Modeling",
    description:
      "If both live price sources (Finnhub, then yfinance) fail, this app doesn't block the page or fabricate a price — it falls back to each holding's own last successfully-fetched price, and only if every holding actually has one on file.",
    formula: 'if live fetch fails: use holding.last_price for every ticker, else HTTP 503',
    note: 'backend/routers/portfolio.py. The response is labeled market_data_source: "stale" so the dashboard shows its own "showing last known prices" notice rather than presenting a fetch that never happened as fresh.',
  },
  {
    term: "Client delete safeguard",
    abbr: "DEL·GUARD",
    category: "Accounts",
    description:
      "Deleting a client whose reports still exist is blocked by default — this app has no general cascading-delete story for report/audit data, so the safe default is to refuse, not guess. A force override exists for exactly this case, but it is never automatic: it requires a second, explicit confirmation naming exactly how many reports will also be destroyed before it deletes those reports and then the client.",
    formula: "DELETE /clients/{id} → 409 if reports exist; DELETE /clients/{id}?force=true → deletes the referencing reports, then the client",
    note: "backend/routers/clients.py's delete_client + services/report_store.py's delete_report. The no-force default is unconditional and can't be bypassed accidentally — force=true is only ever sent after the advisor explicitly confirms the exact report count shown to them.",
  },
]

const FILTER_PILL_BASE =
  "rounded-full px-[13px] py-1.5 text-[11.5px] font-medium cursor-pointer border"
const FILTER_PILL_ACTIVE = "border-primary bg-accent text-primary"
const FILTER_PILL_INACTIVE = "border-border bg-card text-muted-foreground"

function TermCard({ term }: { term: Term }) {
  return (
    <div className="flex flex-col gap-2 rounded-[11px] border border-border bg-card p-[15px_16px] shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-baseline gap-[4px_8px]">
        <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">{term.term}</span>
        <span className="rounded-[5px] bg-accent px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-[0.04em] text-primary">
          {term.abbr}
        </span>
        <span className="ml-auto text-[11px] tracking-[0.06em] text-muted-3 uppercase">{term.category}</span>
      </div>
      <p className="m-0 text-[12.5px] leading-[1.6] text-muted-foreground text-pretty">{term.description}</p>
      <div className="overflow-x-auto rounded-lg border border-border bg-background p-[9px_10px] font-mono text-[11.5px] leading-[1.5] whitespace-nowrap text-foreground">
        {term.formula}
      </div>
      <span className="text-[11px] leading-[1.5] text-muted-3 text-pretty">{term.note}</span>
    </div>
  )
}

// The mockup's own Explanations page — sidebar's "Reference" section, a
// real 24-term glossary with genuinely working search + category filter,
// not a placeholder — was never built out before now. Extracted and
// reproduced exactly below, then extended (clearly delineated, its own
// section) with real terms and formulas this app specifically computes.
export function ExplanationsPage() {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<Category | "All">("All")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return GLOSSARY_TERMS.filter((t) => {
      if (category !== "All" && t.category !== category) return false
      if (!q) return true
      return (
        t.term.toLowerCase().includes(q) ||
        t.abbr.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.formula.toLowerCase().includes(q)
      )
    })
  }, [search, category])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-[10px_14px]">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <h1 className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-foreground">Explanations</h1>
          <span className="text-xs text-muted-3">
            Every term, abbreviation and formula used across this workspace — {GLOSSARY_TERMS.length} terms
          </span>
        </div>
        <div className="relative ml-auto flex items-center">
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="absolute left-[11px] text-muted-3"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search terms, abbreviations, formulas…"
            className="h-9 w-[300px] rounded-[9px] border border-border bg-card py-0 pr-3 pl-8 text-[12.5px] text-foreground outline-none"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-[7px]">
        <button
          type="button"
          onClick={() => setCategory("All")}
          className={cn(FILTER_PILL_BASE, category === "All" ? FILTER_PILL_ACTIVE : FILTER_PILL_INACTIVE)}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(FILTER_PILL_BASE, category === c ? FILTER_PILL_ACTIVE : FILTER_PILL_INACTIVE)}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No terms match "{search}".</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] items-start gap-3.5">
          {filtered.map((t) => (
            <TermCard key={t.abbr} term={t} />
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-[3px] border-t border-border pt-4">
        <h2 className="m-0 text-[16px] font-semibold tracking-[-0.015em] text-foreground">
          Beyond the glossary: how this app computes it
        </h2>
        <span className="text-xs text-muted-3">
          Real formulas pulled from this codebase's own backend services — not textbook definitions. Two entries
          above (Diversification score, Investment health score) are deliberately different from what this app
          actually computes; the entries below explain the real version.
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] items-start gap-3.5">
        {EXTENDED_TERMS.map((t) => (
          <TermCard key={t.abbr} term={t} />
        ))}
      </div>
    </div>
  )
}
