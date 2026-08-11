import { useCurrency } from "@/components/providers/currency-provider"
import type { ProjectionResponse } from "@/lib/api"

/**
 * "Retirement funding" — pixel-matched to the mockup's card (extracted via
 * outerHTML from the live mockup). All three headline figures come straight
 * from the same Monte Carlo simulation projection.py already runs:
 *   - bar fill % = current-path terminal value / goal amount
 *   - marker position % = target("optimized")-path terminal value / goal amount
 *   - "Current path" / "Optimized" / "Need" = those same three real dollars
 * None of these are separately invented — they're the same
 * projection_chart_data + goal_amount already used by the Projection card,
 * just read at the final year and divided.
 */
export function RetirementFundingCard({ projection }: { projection: ProjectionResponse }) {
  const { formatCompactCurrency } = useCurrency()
  const data = projection.projection_chart_data
  const last = data[data.length - 1]
  const isAdvisorProvided = projection.goal_amount_source === "advisor_provided"

  const currentPct = Math.min(100, (last.current_trajectory / projection.goal_amount) * 100)
  const optimizedPct = Math.min(100, (last.target_trajectory / projection.goal_amount) * 100)

  return (
    <div className="flex flex-col gap-[11px] rounded-[12px] border border-border bg-card p-[18px] shadow-[var(--shadow-card)]">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-foreground">Retirement funding &middot; {projection.goal_year}</span>
        <span className="font-mono text-[14px] font-semibold text-primary">{currentPct.toFixed(0)}%</span>
      </div>
      <div className="relative h-[9px] overflow-hidden rounded-[5px] bg-[var(--grid-line)]">
        <div className="h-full rounded-[5px] bg-primary" style={{ width: `${currentPct}%` }} />
        <div
          className="absolute -top-[3px] -bottom-[3px] w-[2px] bg-foreground"
          style={{ left: `${optimizedPct}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted-3">
        <span>Current path {formatCompactCurrency(last.current_trajectory)}</span>
        <span>Optimized {formatCompactCurrency(last.target_trajectory)}</span>
        {/* Never ambiguous which kind of number this is: a real,
            advisor-provided target_retirement_amount is labeled distinctly
            from the existing derived-compounding estimate — same
            goal_amount value either way, just different framing/labeling
            of its source (see services/projection.resolve_goal_amount). */}
        <span>
          {isAdvisorProvided ? "Goal" : "Need"} {formatCompactCurrency(projection.goal_amount)}
          {isAdvisorProvided && <span className="text-primary"> (advisor-provided)</span>}
        </span>
      </div>
      <div className="mt-0.5 flex gap-[9px] border-t border-border pt-[3px]">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--secondary)"
          strokeWidth="2"
          strokeLinecap="round"
          className="mt-0.5 shrink-0"
        >
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <span className="text-[11.5px] leading-[1.5] text-muted-foreground">
          Funding reaches {optimizedPct.toFixed(0)}% of goal if rebalanced to target allocation, with contributions
          continuing at {formatCompactCurrency(projection.annual_contribution)}/yr &mdash; versus{" "}
          {currentPct.toFixed(0)}% on the current path.
        </span>
      </div>
    </div>
  )
}
