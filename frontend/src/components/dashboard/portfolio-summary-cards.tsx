import { useCurrency } from "@/components/providers/currency-provider"
import type { AnalysisResponse } from "@/lib/api"
import { formatPercent } from "@/lib/format"

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  taxable: "Taxable",
  "401k": "401(k)",
  ira: "IRA",
  roth_ira: "Roth IRA",
  cash: "Cash",
}

// Primary + progressively lighter tints, for however many distinct account
// types a client actually has (this client has 2; the mockup's own bar only
// ever shows 2 segments too, so this isn't tested beyond that, but degrades
// reasonably for 1 or 3+).
const SEGMENT_COLORS = [
  "var(--primary)",
  "color-mix(in oklab, var(--primary) 38%, var(--card))",
  "var(--muted-3)",
]

export function TotalCorpusCard({ analysis }: { analysis: AnalysisResponse }) {
  const { formatCurrency } = useCurrency()
  const accounts = Object.entries(analysis.value_by_account_type).sort(([, a], [, b]) => b - a)
  const asOfDate = new Date(analysis.as_of).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const isGain = analysis.total_return_dollar >= 0

  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-border bg-card p-[18px] shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-foreground">Total corpus</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[12px] font-medium text-muted-3">
          {accounts.length} account{accounts.length === 1 ? "" : "s"}
        </span>
      </div>
      <span className="text-[11.5px] text-muted-3">Market value as of {asOfDate}</span>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[clamp(24px,2.2vw,34px)] font-semibold whitespace-nowrap text-foreground" style={{ letterSpacing: "-0.035em" }}>
          {formatCurrency(analysis.total_portfolio_value)}
        </span>
      </div>
      <span className={`mt-0.5 font-mono text-[12px] ${isGain ? "text-positive" : "text-destructive"}`}>
        {isGain ? "+" : "-"}
        {formatCurrency(Math.abs(analysis.total_return_dollar))} all-time
      </span>
      <div className="mt-4 flex h-[7px] gap-0.5 overflow-hidden rounded">
        {accounts.map(([type, value], i) => (
          <span
            key={type}
            className="block rounded"
            style={{
              width: `${(value / analysis.total_portfolio_value) * 100}%`,
              background: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
            }}
          />
        ))}
      </div>
      <div className="mt-[7px] flex justify-between">
        {accounts.map(([type, value]) => (
          <span key={type} className="text-[11px] text-muted-3">
            {ACCOUNT_TYPE_LABEL[type] ?? type} {formatCurrency(value)}
          </span>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3.5">
        <span className="text-[12px] text-muted-3">Invested (cost basis)</span>
        <span className="font-mono text-[14px] font-semibold text-muted-foreground">
          {formatCurrency(analysis.total_cost_basis)}
        </span>
      </div>
    </div>
  )
}

function returnQualifier(pct: number): { label: string; colorClass: string } {
  if (pct >= 0.15) return { label: "Good", colorClass: "text-positive border-positive bg-positive/10" }
  if (pct >= 0) return { label: "Fair", colorClass: "text-secondary border-secondary bg-secondary/10" }
  return { label: "Down", colorClass: "text-destructive border-destructive bg-destructive/10" }
}

export function TotalReturnsCard({ analysis }: { analysis: AnalysisResponse }) {
  const { formatCurrency } = useCurrency()
  const isGain = analysis.total_return_dollar >= 0
  const qualifier = returnQualifier(analysis.total_return_pct)

  // No trade has ever actually executed in this app (Accept only stages to
  // an internal blotter — see recommendations-card.tsx / PRD "Out of
  // Scope"), so realized YTD gain is genuinely $0.00, not an omission —
  // the mockup's own "Realized YTD" split has no fabricated figure here,
  // it's an honest real zero. Everything is unrealized as a result.
  const unrealized = analysis.total_return_dollar
  const realizedYtd = 0

  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-border bg-card p-[18px] shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-foreground">Total returns</span>
        <span className={`rounded-full border px-2 py-0.5 text-[12px] font-medium ${qualifier.colorClass}`}>
          {qualifier.label}
        </span>
      </div>
      <span className="text-[11.5px] text-muted-3">Gain over invested capital</span>
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={`text-[clamp(24px,2.2vw,34px)] font-semibold whitespace-nowrap ${isGain ? "text-positive" : "text-destructive"}`}
          style={{ letterSpacing: "-0.035em" }}
        >
          {isGain ? "+" : "-"}
          {formatCurrency(Math.abs(analysis.total_return_dollar))}
        </span>
      </div>
      <span className="mt-0.5 font-mono text-[12px] text-muted-3">
        {formatCurrency(analysis.total_cost_basis)} &rarr; {formatCurrency(analysis.total_portfolio_value)}
      </span>
      <div className="mt-4 flex gap-2">
        <div className="flex flex-1 flex-col gap-0.5 rounded-md border border-border px-2.5 py-[7px]">
          <span className="text-[11px] text-muted-3">Unrealized</span>
          <span className={`font-mono text-[12.5px] font-semibold ${unrealized >= 0 ? "text-positive" : "text-destructive"}`}>
            {unrealized >= 0 ? "+" : "-"}
            {formatCurrency(Math.abs(unrealized))}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 rounded-md border border-border px-2.5 py-[7px]">
          <span className="text-[11px] text-muted-3">Realized YTD</span>
          <span className="font-mono text-[12.5px] font-semibold text-muted-foreground">
            {formatCurrency(realizedYtd)}
          </span>
        </div>
      </div>
      <div className="mt-auto flex items-baseline gap-2 border-t border-border pt-3.5">
        <span className={`font-mono text-[20px] font-semibold ${isGain ? "text-positive" : "text-destructive"}`} style={{ letterSpacing: "-0.025em" }}>
          {isGain ? "+" : "-"}
          {formatPercent(Math.abs(analysis.total_return_pct))}
        </span>
        <span className="text-[12px] text-muted-3">all-time</span>
      </div>
    </div>
  )
}
