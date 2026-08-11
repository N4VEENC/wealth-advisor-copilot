import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { SectorExposureResponse } from "@/lib/api"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

// Mirrors backend/services/compliance.py's CONCENTRATION_THRESHOLD_PCT — a
// sector crossing this line gets the same visual treatment as a compliance
// concentration flag, not a separate/arbitrary UI threshold.
const CONCENTRATION_THRESHOLD_PCT = 0.25

function SectorBar({ label, pct, flagged }: { label: string; pct: number; flagged: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-xs text-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", flagged ? "bg-secondary" : "bg-primary")}
          style={{ width: `${Math.min(pct * 100, 100)}%` }}
        />
      </div>
      <span
        className={cn(
          "w-14 shrink-0 text-right font-mono text-xs",
          flagged ? "font-semibold text-secondary" : "text-muted-foreground"
        )}
      >
        {formatPercent(pct)}
      </span>
    </div>
  )
}

export function SectorExposureCard({ exposure }: { exposure: SectorExposureResponse }) {
  const equitySectors = Object.entries(exposure.equity_sectors)
  const nonEquity = Object.entries(exposure.non_equity)
  const flaggedSector = equitySectors.find(([, bucket]) => bucket.pct_of_portfolio > CONCENTRATION_THRESHOLD_PCT)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sector exposure</CardTitle>
        <CardDescription>
          Direct equity holdings blended with fund look-through weights, across the whole portfolio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {flaggedSector && (
          <p className="rounded-md border border-secondary/30 bg-secondary/10 px-3 py-2 text-xs text-secondary">
            {flaggedSector[0]} is {formatPercent(flaggedSector[1].pct_of_portfolio)} of the total portfolio, above
            the {formatPercent(CONCENTRATION_THRESHOLD_PCT, 0)} sector concentration guideline once fund
            look-through is included.
          </p>
        )}

        <div className="space-y-2">
          <p className="text-2xs font-semibold tracking-wide text-muted-3 uppercase">Equity sectors</p>
          {equitySectors.map(([sector, bucket]) => (
            <SectorBar
              key={sector}
              label={sector}
              pct={bucket.pct_of_portfolio}
              flagged={bucket.pct_of_portfolio > CONCENTRATION_THRESHOLD_PCT}
            />
          ))}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-2xs font-semibold tracking-wide text-muted-3 uppercase">Non-equity</p>
          {nonEquity.map(([bucket, entry]) => (
            <SectorBar key={bucket} label={bucket} pct={entry.pct_of_portfolio} flagged={false} />
          ))}
        </div>

        <p className="text-2xs text-muted-3 italic">{exposure.look_through_note}</p>
      </CardContent>
    </Card>
  )
}
