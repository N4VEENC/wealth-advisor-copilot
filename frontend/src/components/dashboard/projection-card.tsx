import { ProjectionLineChart } from "@/components/charts/projection-line-chart"
import { useCurrency } from "@/components/providers/currency-provider"
import type { ProjectionResponse } from "@/lib/api"
import { formatPercent } from "@/lib/format"

function StatCell({
  label,
  value,
  valueColor,
  caption,
}: {
  label: string
  value: string
  valueColor: string
  caption: string
}) {
  return (
    <div className="flex flex-col gap-[3px] bg-card px-[14px] pt-3 pb-3.5">
      <span className="text-[12px] tracking-[0.02em] text-muted-3">{label}</span>
      <span className={`font-mono text-[17px] font-semibold whitespace-nowrap ${valueColor}`} style={{ letterSpacing: "-0.02em" }}>
        {value}
      </span>
      <span className="text-[12px] text-muted-3">{caption}</span>
    </div>
  )
}

export function ProjectionCard({ projection }: { projection: ProjectionResponse }) {
  const { formatCompactCurrency } = useCurrency()
  const chartData = projection.projection_chart_data
  const last = chartData[chartData.length - 1]

  const medianTarget = last.target_trajectory
  const uplift = last.target_trajectory - last.current_trajectory
  const upliftPct = last.current_trajectory !== 0 ? uplift / last.current_trajectory : 0

  const volCurrentPct = projection.annualized_volatility_current * 100
  const volTargetPct = projection.annualized_volatility_target * 100
  const volDeltaPp = volTargetPct - volCurrentPct

  const probCurrentPct = formatPercent(projection.probability_of_reaching_goal_current, 0)
  const probTargetPct = formatPercent(projection.probability_of_reaching_goal, 0)

  return (
    <div className="order-1 flex min-w-0 flex-col gap-0.5 rounded-[12px] border border-border bg-card p-[18px] pb-2">
      <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">
            Financial modeling &mdash; projected portfolio value to {projection.goal_year}
          </span>
          <span className="text-[11.5px] text-muted-3">
            Monte Carlo median of {projection.path_count.toLocaleString()} paths &middot; nominal
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3.5 gap-y-1.5 pt-0.5">
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span aria-hidden="true" className="block h-0.5 w-3.5 bg-muted-3" />
            Current path
          </span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span aria-hidden="true" className="block h-0.5 w-3.5 bg-primary" />
            After recommended changes
          </span>
        </div>
      </div>

      <ProjectionLineChart data={chartData} formatCompactCurrency={formatCompactCurrency} />

      <div className="mt-1 grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-px border-t border-border bg-border">
        <StatCell
          label={`Median ${projection.goal_year} value`}
          value={formatCompactCurrency(medianTarget)}
          valueColor="text-primary"
          caption="after recommended changes"
        />
        <StatCell
          label="Uplift vs. current"
          value={`${uplift >= 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(uplift))}`}
          valueColor="text-positive"
          caption={`${upliftPct >= 0 ? "+" : ""}${(upliftPct * 100).toFixed(1)}% terminal value`}
        />
        <StatCell
          label="Volatility (ann.)"
          value={`${volCurrentPct.toFixed(1)}% → ${volTargetPct.toFixed(1)}%`}
          valueColor="text-foreground"
          caption={`${volDeltaPp >= 0 ? "+" : ""}${volDeltaPp.toFixed(1)}pp after rebalance`}
        />
        <StatCell
          label="Prob. of funding goal"
          value={`${probCurrentPct} → ${probTargetPct}`}
          valueColor="text-positive"
          caption={`${projection.path_count.toLocaleString()}-path Monte Carlo`}
        />
      </div>
    </div>
  )
}
