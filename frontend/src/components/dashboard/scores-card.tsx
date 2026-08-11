import { FactorBar, HealthDonut } from "@/components/charts/health-donut"
import { RiskGauge, riskBandLabel } from "@/components/charts/risk-gauge"
import type { AnalysisResponse, SectorExposureResponse } from "@/lib/api"
import { formatPercent } from "@/lib/format"

// Same literal band colors as risk-gauge.tsx's BANDS — kept in sync manually
// since these are the mockup's own fixed (non-theme-variable) hex values.
const BAND_COLOR_BY_LABEL: Record<string, string> = {
  Low: "#9CC08A",
  Moderate: "#4E8B57",
  Watch: "#D3A32F",
  Elevated: "#C4712B",
  High: "#A83A2C",
}

// Mirrors backend/services/compliance.py's CONCENTRATION_THRESHOLD_PCT — a
// stat gets the same warn-color treatment as a compliance concentration flag.
const CONCENTRATION_FLAG_PCT = 0.25

function StatBox({ label, value, flagged }: { label: string; value: string; flagged: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border px-2.5 py-2">
      <span className="text-[12px] text-muted-3">{label}</span>
      <span className={`font-mono text-[14px] font-semibold ${flagged ? "text-secondary" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  )
}

export function DiversificationRiskCard({
  analysis,
  sectorExposure,
}: {
  analysis: AnalysisResponse
  sectorExposure: SectorExposureResponse | null
}) {
  // Our diversification_score is the inverse polarity of the mockup's "risk"
  // framing (ours: higher = better; mockup: higher = riskier) — see
  // risk-gauge.tsx's docstring for why this inversion is a direct algebraic
  // transform of a real number, not an invented one.
  const risk = 100 - analysis.diversification_score
  const band = riskBandLabel(risk)
  const badgeColor = BAND_COLOR_BY_LABEL[band]

  const positionEntries = Object.entries(analysis.position_values)
  const totalValue = analysis.total_portfolio_value
  const top3Value = positionEntries
    .map(([, v]) => v)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((sum, v) => sum + v, 0)
  const top3Pct = totalValue > 0 ? top3Value / totalValue : 0

  const techSector = sectorExposure?.equity_sectors["Technology"]

  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-border bg-card p-[18px] shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-foreground">Diversification risk</span>
        <span
          className="rounded-full border px-2 py-0.5 text-[12px] font-medium"
          style={{
            borderColor: badgeColor,
            backgroundColor: `color-mix(in oklab, ${badgeColor} 14%, transparent)`,
            color: badgeColor,
          }}
        >
          {band}
        </span>
      </div>
      <span className="text-[11.5px] text-muted-3">Concentration-weighted, vs. her target allocation</span>
      <div className="flex justify-center pt-2">
        <RiskGauge value={risk} label="Diversification risk" />
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-2.5">
        <StatBox label="Top-3 weight" value={formatPercent(top3Pct)} flagged={false} />
        <StatBox
          label="Tech sector"
          value={techSector ? formatPercent(techSector.pct_of_portfolio) : "—"}
          flagged={!!techSector && techSector.pct_of_portfolio > CONCENTRATION_FLAG_PCT}
        />
      </div>
    </div>
  )
}

export function InvestmentHealthCard({ analysis }: { analysis: AnalysisResponse }) {
  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-border bg-card p-[18px] shadow-[var(--shadow-card)]">
      <span className="text-[13px] font-medium text-foreground">Investment health score</span>
      <span className="text-[11.5px] text-muted-3">Two weighted components, recomputed on every analysis</span>
      <div className="flex justify-center pt-2.5 pb-1">
        <HealthDonut score={analysis.health_score} />
      </div>
      <div className="mt-0.5 flex flex-col gap-[7px]">
        <FactorBar label="Allocation drift" value={analysis.health_score_components.allocation_drift} />
        <FactorBar label="Concentration" value={analysis.health_score_components.concentration} />
      </div>
    </div>
  )
}
