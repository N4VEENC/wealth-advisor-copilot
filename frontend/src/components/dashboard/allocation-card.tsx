import {
  AllocationDonutChart,
  BUCKET_COLOR,
  BUCKET_LABEL,
  BUCKET_ORDER,
} from "@/components/charts/allocation-donut-chart"
import { useCurrency } from "@/components/providers/currency-provider"
import type { AnalysisResponse, TradeRecommendation } from "@/lib/api"
import { formatPercent, formatSignedPercentagePoints } from "@/lib/format"
import { cn } from "@/lib/utils"

export function AllocationCard({
  analysis,
  recommendations,
}: {
  analysis: AnalysisResponse
  recommendations: TradeRecommendation[]
}) {
  const { formatCompactCurrency, formatCurrency } = useCurrency()

  // "Rebalance to target moves $X" — sums the SAME recommendation_matcher.py
  // trade data the Recommendations card renders (dollar_amount per trade),
  // so the two cards can never disagree about the size of the same
  // recommended rebalance. Previously this was an independent half-drift
  // approximation, which could differ slightly from the real trade total
  // due to whole-share rounding — fixed per explicit feedback.
  const rebalanceAmount = recommendations.reduce((sum, rec) => sum + rec.dollar_amount, 0)

  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-border bg-card p-[18px] shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-foreground">Allocation vs. target</span>
        <span className="font-mono text-[12px] text-muted-3">
          {formatCompactCurrency(analysis.total_portfolio_value)}
        </span>
      </div>
      <span className="text-[11.5px] text-muted-3">Actual (outer) against policy band (inner)</span>
      <div className="mt-1.5 flex flex-col items-center gap-3.5">
        <AllocationDonutChart current={analysis.current_allocation} target={analysis.target_allocation} />
        <div className="flex w-full min-w-0 flex-1 flex-col gap-[9px]">
          {BUCKET_ORDER.map((bucket) => {
            const drift = analysis.drift[bucket]
            const driftRoundedToZero = Math.round(drift * 1000) === 0
            return (
              <div key={bucket} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="block h-[9px] w-[9px] shrink-0 rounded-[3px]"
                  style={{ background: BUCKET_COLOR[bucket] }}
                />
                <span className="flex-1 text-[12px] text-muted-foreground">{BUCKET_LABEL[bucket]}</span>
                <span className="font-mono text-[12px] font-medium text-foreground">
                  {formatPercent(analysis.current_allocation[bucket])}
                </span>
                <span
                  className={cn(
                    "w-12 text-right font-mono text-[11px] font-medium",
                    driftRoundedToZero ? "text-muted-3" : "text-secondary"
                  )}
                >
                  {formatSignedPercentagePoints(drift)}
                </span>
              </div>
            )
          })}
          <div className="flex flex-col gap-0.5 border-t border-border pt-2.5">
            <span className="text-[12px] text-muted-3">Rebalance to target moves</span>
            <span className="font-mono text-[14px] font-semibold text-primary">
              {formatCurrency(rebalanceAmount)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
