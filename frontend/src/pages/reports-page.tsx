import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

import {
  ApiError,
  getClient,
  getReports,
  type ClientRecord,
  type ReportSummary,
} from "@/lib/api"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LoadingLine } from "@/components/ui/loading-line"

// This app has no mockup reference for a "past reports" list — the
// mockup's own "Client report" nav tab is a single-report client-facing
// viewer (a formatted 2-page document), not a plural history view. Built
// using the same Card + grid-table pattern already established for the
// Holdings page rather than inventing an unrelated new visual language.
const GRID_TEMPLATE_COLUMNS = "1fr 110px 100px 100px 130px 90px"

const HEADER_CELL_CLASS = "text-[11px] font-medium tracking-[0.07em] text-muted-3 uppercase"

function StatusBadge({ status }: { status: ReportSummary["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        status === "approved" ? "bg-positive/15 text-positive" : "bg-secondary/15 text-secondary"
      )}
    >
      {status}
    </span>
  )
}

function HeaderRow() {
  return (
    <div
      className="grid gap-0 border-b border-border bg-muted px-[18px] py-[9px]"
      style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, minWidth: 720 }}
    >
      <span className={cn(HEADER_CELL_CLASS, "text-left")}>Generated</span>
      <span className={cn(HEADER_CELL_CLASS, "text-left")}>Status</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Health</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Diversification</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Funding odds</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>View</span>
    </div>
  )
}

function ReportRow({ report, clientId }: { report: ReportSummary; clientId: string }) {
  const generatedLabel = new Date(report.generated_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return (
    <div
      className="grid items-center gap-0 border-b border-border px-[18px] py-2.5"
      style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, minWidth: 720 }}
    >
      <span className="font-mono text-xs text-foreground">{generatedLabel}</span>
      <span>
        <StatusBadge status={report.status} />
      </span>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {report.content.scores ? `${report.content.scores.health}/100` : "—"}
      </span>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {report.content.scores ? `${report.content.scores.diversification}/100` : "—"}
      </span>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {report.content.monte_carlo
          ? formatPercent(report.content.monte_carlo.probability_of_reaching_goal, 0)
          : "—"}
      </span>
      <span className="text-right">
        <Link
          to={`/clients/${clientId}/reports/${report.id}`}
          className="inline-block rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-foreground"
        >
          View
        </Link>
      </span>
    </div>
  )
}

export function ReportsPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [reports, setReports] = useState<ReportSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getClient(clientId), getReports(clientId)])
      .then(([clientResponse, reportsResponse]) => {
        if (cancelled) return
        setClient(clientResponse)
        setReports(reportsResponse.reports)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : "Could not load reports.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  return (
    <div className="space-y-6">
      {loading && <LoadingLine label="Loading reports…" />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {client && reports && (
        <>
          <div className="flex flex-col gap-[3px]">
            <h1 className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-foreground">Reports</h1>
            <span className="text-xs text-muted-3">
              {client.name} &middot; {reports.length} generated
            </span>
          </div>

          <div className="overflow-hidden rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]">
            {reports.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-6 py-14 text-center">
                <span className="text-sm font-medium text-foreground">No reports generated yet</span>
                <span className="text-xs text-muted-3">
                  Use "Generate report" in the header to create the first one for {client.name}.
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <HeaderRow />
                {reports.map((report) => (
                  <ReportRow key={report.id} report={report} clientId={clientId!} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
