import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useParams } from "react-router-dom"

import { ProjectionLineChart } from "@/components/charts/projection-line-chart"
import { useCurrency } from "@/components/providers/currency-provider"
import { LoadingLine } from "@/components/ui/loading-line"
import {
  ApiError,
  getClient,
  getReport,
  putApproveReport,
  type AdvisorNote,
  type ClientRecord,
  type ComplianceFlag,
  type ReportSummary,
  type TradeRecommendation,
} from "@/lib/api"
import { formatPercent, formatSignedPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

// Every dollar figure below flows through these — never report.currency_display
// (a fixed "USD" snapshot label from when the report was generated) and
// never a raw lib/format.ts call. The client report must respond to the
// SAME live currency switcher as the rest of the app, not stay frozen in
// whatever currency happened to be selected when the report was generated.
type ReportFormatters = {
  formatCurrency: (usdAmount: number) => string
  formatCompactCurrency: (usdAmount: number) => string
  convertMentionsInText: (text: string) => string
}

// Real, public reference facts (not fabricated per-client data), same spirit
// as the ticker->name lookup on the Holdings page and the sidebar's
// hardcoded advisor identity — this report has no mockup-equivalent
// "Northline Wealth Partners / Dana Reyes, CFP®" firm identity of its own,
// so it uses this app's own real branding + the real advisor name already
// established elsewhere in this app instead of inventing a fictional firm.
const FIRM_NAME = "Wealth Advisor Copilot"
const ADVISOR_LINE = "NAVEEN C, Financial Advisor"

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  taxable: "Taxable brokerage",
  "401k": "401(k)",
  ira: "IRA",
  roth_ira: "Roth IRA",
}

// Literal hex values extracted from the mockup's report-view allocation
// donut specifically — a different element than the Dashboard's Allocation
// card, with its own distinct (though related) 3-color palette.
const DONUT_COLOR: Record<"equities" | "fixed_income" | "cash", string> = {
  equities: "#2F5D46",
  fixed_income: "#9FBCA9",
  cash: "#CFC7B8",
}
const BUCKET_LABEL: Record<"equities" | "fixed_income" | "cash", string> = {
  equities: "Stocks — growth over the long run",
  fixed_income: "Bonds — steadier income",
  cash: "Cash — available for near-term needs",
}
const BUCKET_ORDER: Array<"equities" | "fixed_income" | "cash"> = ["equities", "fixed_income", "cash"]

const CATEGORY_TITLE: Record<string, string> = {
  concentration: "Position concentration breach",
  wash_sale: "Wash-sale risk",
  disclosure: "Disclosure",
}

const DECISION_LABEL: Record<TradeRecommendation["decision"], string> = {
  accepted: "Accepted",
  dismissed: "Declined",
  pending: "Pending review",
}
const DECISION_CLASS: Record<TradeRecommendation["decision"], string> = {
  accepted: "text-primary bg-primary/10",
  dismissed: "text-muted-3 bg-muted",
  pending: "text-secondary bg-secondary/10",
}

function AllocationDonut({ fractions, centerValue, accountCount, formatCurrency }: {
  fractions: { equities: number; fixed_income: number; cash: number }
  centerValue: number
  accountCount: number
  formatCurrency: (usdAmount: number) => string
}) {
  const r = 74
  const circumference = 2 * Math.PI * r
  let cumulative = 0
  const segments = BUCKET_ORDER.map((bucket) => {
    const length = fractions[bucket] * circumference
    const seg = { bucket, length, offset: -cumulative }
    cumulative += length
    return seg
  })

  return (
    <svg width={230} height={196} viewBox="0 0 196 196">
      <g transform="rotate(-90 98 98)">
        {segments.map((seg) => (
          <circle
            key={seg.bucket}
            cx={98}
            cy={98}
            r={r}
            fill="none"
            stroke={DONUT_COLOR[seg.bucket]}
            strokeWidth={26}
            strokeDasharray={`${seg.length} ${circumference - seg.length}`}
            strokeDashoffset={seg.offset}
          />
        ))}
      </g>
      <text x={98} y={94} textAnchor="middle" fill="#241F1A" style={{ font: "600 23px Fraunces, Georgia, serif", letterSpacing: "-0.01em" }}>
        {formatCurrency(centerValue)}
      </text>
      <text x={98} y={112} textAnchor="middle" fill="#7A7166" style={{ font: '400 12px "IBM Plex Sans", sans-serif' }}>
        across {accountCount} account{accountCount === 1 ? "" : "s"}
      </text>
    </svg>
  )
}

function RecommendationRow({ rec, index, convertMentionsInText }: {
  rec: TradeRecommendation
  index: number
  convertMentionsInText: (text: string) => string
}) {
  const verb = rec.action === "SELL" ? "Sell" : "Buy"

  return (
    <div className="report-section flex gap-4 rounded-[10px] border border-border bg-muted/40 p-[18px_20px]">
      <span className="shrink-0 font-mono text-[15px] font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold text-foreground">
            {verb} {rec.quantity} sh {rec.ticker} in {ACCOUNT_TYPE_LABEL[rec.account_type] ?? rec.account_type}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", DECISION_CLASS[rec.decision])}>
            {DECISION_LABEL[rec.decision]}
          </span>
        </div>
        {/* rec.note already includes the tax-lot gain phrase for SELLs
            (recommendation_matcher.py's f"${x:,.2f}" strings) — always real
            USD text embedded directly in the string, so it goes through
            convertMentionsInText the same as any AI-generated prose would. */}
        <p className="m-0 text-[13.5px] leading-[1.62] text-muted-foreground">{convertMentionsInText(rec.note)}</p>
      </div>
    </div>
  )
}

function ComplianceRow({ flag, convertMentionsInText }: { flag: ComplianceFlag; convertMentionsInText: (text: string) => string }) {
  const isOpen = flag.severity !== "low"
  return (
    <div className="flex items-start gap-[9px]">
      <span aria-hidden="true" className={cn("mt-[6px] block h-[7px] w-[7px] shrink-0 rounded-full", isOpen ? "bg-secondary" : "bg-muted-3")} />
      <div className="flex min-w-0 flex-col gap-px">
        <span className="text-[13px] font-medium text-foreground">{CATEGORY_TITLE[flag.category] ?? flag.category}</span>
        <span className="text-[12px] leading-[1.5] text-muted-3">{convertMentionsInText(flag.narrative ?? flag.message)}</span>
      </div>
    </div>
  )
}

// Same terracotta/estimate treatment as an exploratory chat bubble — never
// blended visually with the verified recommendations/compliance sections
// above it, and always carries its own persistent disclosure label (frozen
// into `note.label` at report-generation time, see routers/reports.py).
function AdvisorNoteRow({ note, convertMentionsInText }: { note: AdvisorNote; convertMentionsInText: (text: string) => string }) {
  const flaggedDate = new Date(note.flagged_at)
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-border border-l-[3px] border-l-secondary bg-secondary/10 p-[16px_18px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex w-fit items-center rounded-[5px] bg-secondary/15 px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em] text-secondary">
          {note.label}
        </span>
        <span className="shrink-0 text-[11px] text-muted-3">
          {flaggedDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>
      {note.prompted_by && (
        <span className="text-[12.5px] font-medium text-muted-foreground">Q: {note.prompted_by}</span>
      )}
      <p className="m-0 text-[13.5px] leading-[1.6] text-foreground text-pretty">{convertMentionsInText(note.content)}</p>
    </div>
  )
}

// Single closing footer for the whole document — not one per printed page.
// A CSS Paged Media @bottom-center margin box (which would repeat a footer
// on every physical page) isn't implemented by Chrome's print pipeline, and
// there's no live counter(pages) either, so a real "Page X of Y" can't be
// computed at all once pagination is left to the browser's own natural
// content-driven page breaks (see the continuous-flow comment below) —
// this states the same disclosures once, at the true end of the document.
function DocumentFooter({ text }: { text: string }) {
  return (
    <div className="report-section mt-[34px] flex items-end gap-3.5 border-t border-border pt-[22px]">
      <p className="m-0 flex-1 text-[11px] leading-[1.5] text-muted-3 text-pretty">{text}</p>
    </div>
  )
}

// A single unit of report content, rendered in one continuous document flow
// (no per-page containers, no JS-measured page packing). className carries
// this block's own spacing from whatever precedes it, plus break-inside
// avoidance so it never gets split mid-card, and — on exactly one block —
// an explicit break-before so the detail section starts its own page when
// there's room to. Everything else is left to the browser's own genuine
// print pagination: if a page runs a little long, that's fine; nothing
// about this approach can silently clip content the way a fixed-height,
// overflow-managed page container can.
type Block = { key: string; node: ReactNode; className: string }

function buildReportBlocks(report: ReportSummary, client: ClientRecord, fmt: ReportFormatters): Block[] {
  const c = report.content
  const { formatCurrency, formatCompactCurrency, convertMentionsInText } = fmt
  const lastPoint = c.projection_chart_data?.[c.projection_chart_data.length - 1] ?? null
  const totalValue = c.total_portfolio_value ?? c.projection_chart_data?.[0]?.current_trajectory ?? null
  const fundingPct =
    lastPoint && c.monte_carlo?.goal_amount ? lastPoint.target_trajectory / c.monte_carlo.goal_amount : null
  const accountCount = c.value_by_account_type ? Object.keys(c.value_by_account_type).length : 1
  const generatedDate = new Date(report.generated_at)
  const yearsToGoal = client.goal_year - generatedDate.getFullYear()

  const blocks: Block[] = []

  blocks.push({
    key: "letterhead",
    className: "",
    node: (
      <div className="report-section flex items-start gap-4 border-b-2 border-[#241F1A] pb-5">
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] bg-primary text-[12px] font-semibold tracking-[0.02em] text-primary-foreground">
          WAC
        </div>
        <div className="flex flex-col leading-[1.25]">
          <span className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{FIRM_NAME}</span>
          <span className="text-[12px] text-muted-3">{ADVISOR_LINE}</span>
        </div>
        <div className="ml-auto text-right leading-[1.35]">
          <div className="font-mono text-[12px] font-medium text-muted-3">PREPARED FOR</div>
          <div style={{ font: "600 17px Fraunces, Georgia, serif", letterSpacing: "-0.01em" }}>{client.name}</div>
          <div className="text-[12px] text-muted-3">
            {generatedDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          </div>
        </div>
      </div>
    ),
  })

  blocks.push({
    key: "headline",
    className: "mt-[34px]",
    node: (
      <>
        <h1 className="report-section m-0 mb-2.5 text-[40px] leading-[1.1] font-semibold tracking-[-0.032em] text-foreground text-balance">
          Your portfolio review
        </h1>
        <p className="m-0 max-w-[62ch] text-[15px] leading-[1.65] text-muted-foreground text-pretty">
          A summary of where your investments stand today, how they&rsquo;re tracking toward retiring in{" "}
          {client.goal_year}, and the rebalancing changes suggested below.
        </p>
      </>
    ),
  })

  blocks.push({
    key: "stats",
    className: "mt-[30px]",
    node: (
      <div className="report-section grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-border bg-border">
        <div className="flex flex-col gap-[5px] bg-card p-[18px_20px]">
          <span className="text-[12px] text-muted-3">Total value</span>
          <span style={{ font: "600 30px Fraunces, Georgia, serif", letterSpacing: "-0.02em" }}>
            {totalValue !== null ? formatCurrency(totalValue) : "—"}
          </span>
          {c.total_return_pct !== undefined && (
            <span className="font-mono text-[12px] font-medium text-primary">{formatSignedPercent(c.total_return_pct)} all-time</span>
          )}
        </div>
        <div className="flex flex-col gap-[5px] bg-card p-[18px_20px]">
          <span className="text-[12px] text-muted-3">Retirement funding</span>
          <span className="text-[27px] font-semibold tracking-[-0.025em] text-primary">
            {fundingPct !== null ? formatPercent(fundingPct, 0) : "—"}
          </span>
          <span className="font-mono text-[12px] text-muted-3">of your {client.goal_year} goal</span>
        </div>
        <div className="flex flex-col gap-[5px] bg-card p-[18px_20px]">
          <span className="text-[12px] text-muted-3">Health score</span>
          <span className="text-[27px] font-semibold tracking-[-0.025em] text-foreground">
            {c.scores ? c.scores.health : "—"}
            <span className="text-[15px] font-normal text-muted-3"> / 100</span>
          </span>
          <span className="font-mono text-[12px] text-muted-3">&nbsp;</span>
        </div>
      </div>
    ),
  })

  if (c.allocation) {
    const allocation = c.allocation
    blocks.push({
      key: "allocation",
      className: "mt-[38px]",
      node: (
        <div className="report-section grid grid-cols-[230px_1fr] items-center gap-9">
          <AllocationDonut
            fractions={allocation.current}
            centerValue={totalValue ?? 0}
            accountCount={accountCount}
            formatCurrency={formatCurrency}
          />
          <div className="flex flex-col gap-4">
            <h2 className="m-0 text-[18px] font-semibold tracking-[-0.015em] text-foreground">How your money is invested</h2>
            <div className="flex flex-col gap-[11px]">
              {BUCKET_ORDER.map((bucket) => (
                <div key={bucket} className="flex items-center gap-[11px]">
                  <span aria-hidden="true" className="block h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ background: DONUT_COLOR[bucket] }} />
                  <span className="flex-1 text-[14px] text-muted-foreground">{BUCKET_LABEL[bucket]}</span>
                  <span className="font-mono text-[14px] font-semibold text-foreground">
                    {formatPercent(allocation.current[bucket], 0)}
                  </span>
                </div>
              ))}
            </div>
            {c.ai_narrative ? (
              <p className="m-0 text-[13.5px] leading-[1.6] text-muted-foreground text-pretty">
                {convertMentionsInText(c.ai_narrative.split("\n\n")[0])}
              </p>
            ) : (
              <p className="m-0 text-[13.5px] leading-[1.6] text-muted-3 italic">Narrative unavailable for this report.</p>
            )}
          </div>
        </div>
      ),
    })
  }

  if (c.projection_chart_data && c.projection_chart_data.length > 0 && lastPoint) {
    blocks.push({
      key: "financial-modeling",
      // The one deliberate forced page break: starts the detail section
      // (chart, trades, compliance) on its own page when there's room,
      // matching the original 2-page design intent. break-before has no
      // effect outside paged media, so this is a no-op on screen.
      className: "mt-[34px] [break-before:page]",
      node: (
        <div className="report-section">
          <h2 className="m-0 mb-2 text-[26px] font-semibold tracking-[-0.025em] text-foreground">
            Tracking toward {client.goal_year}
          </h2>
          <p className="m-0 mb-[22px] max-w-[66ch] text-[14px] leading-[1.6] text-muted-foreground text-pretty">
            Two paths for the next {yearsToGoal} years: staying exactly as you are, and making the changes
            suggested below. Both assume continued contributions of about {formatCurrency(client.annual_contribution)}/yr.
          </p>
          <ProjectionLineChart data={c.projection_chart_data} formatCompactCurrency={formatCompactCurrency} />
          <div className="mt-1.5 flex gap-[26px]">
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span aria-hidden="true" className="block h-[2.5px] w-4 bg-muted-3" />
              As you are today — {formatCurrency(lastPoint.current_trajectory)}
            </span>
            <span className="flex items-center gap-2 text-[13px] text-foreground">
              <span aria-hidden="true" className="block h-[3px] w-4 bg-primary" />
              With the suggested change — {formatCurrency(lastPoint.target_trajectory)}
            </span>
          </div>
        </div>
      ),
    })
  }

  // Client-facing report: only trades the advisor actually accepted are
  // real, active changes to the client's account — a declined suggestion
  // was never acted on and shouldn't appear as if it were.
  const acceptedTrades = (c.recommended_trades ?? []).filter((rec) => rec.decision === "accepted")
  if (acceptedTrades.length > 0) {
    blocks.push({
      key: "recommendations-heading",
      className: "mt-[34px]",
      node: (
        <h2 className="report-section m-0 text-[26px] font-semibold tracking-[-0.025em] text-foreground">
          What we suggest
        </h2>
      ),
    })
    acceptedTrades.forEach((rec, i) => {
      blocks.push({
        key: `rec-${i}`,
        className: "mt-[12px]",
        node: (
          <RecommendationRow
            key={`${rec.ticker}-${rec.action}-${i}`}
            rec={rec}
            index={i}
            convertMentionsInText={convertMentionsInText}
          />
        ),
      })
    })
  }

  if (c.compliance_flags && c.compliance_flags.length > 0) {
    blocks.push({
      key: "compliance",
      className: "mt-[34px]",
      node: (
        <div className="report-section flex flex-col gap-2.5 rounded-[10px] border border-border p-[18px_20px]">
          <h2 className="m-0 text-[15px] font-semibold text-foreground">Compliance flags</h2>
          {c.compliance_flags.map((flag) => (
            <ComplianceRow key={flag.id} flag={flag} convertMentionsInText={convertMentionsInText} />
          ))}
        </div>
      ),
    })
  }

  // Only present when the advisor explicitly attached flagged Exploratory
  // notes at generation time — a distinct, clearly-separate section, never
  // blended into the verified narrative/recommendations/compliance above.
  if (c.advisor_notes && c.advisor_notes.length > 0) {
    blocks.push({
      key: "advisor-notes",
      className: "mt-[34px]",
      node: (
        <div className="report-section flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-foreground">Advisor notes</h2>
            <p className="m-0 text-[12.5px] leading-[1.5] text-muted-3">
              Estimates the advisor reviewed and chose to include — not part of the deterministic analysis above.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            {c.advisor_notes.map((note) => (
              <AdvisorNoteRow key={note.id} note={note} convertMentionsInText={convertMentionsInText} />
            ))}
          </div>
        </div>
      ),
    })
  }

  return blocks
}

export function ReportViewPage() {
  const { reportId } = useParams<{ reportId: string }>()
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const { formatCurrency, formatCompactCurrency, convertMentionsInText } = useCurrency()

  useEffect(() => {
    if (!reportId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getReport(reportId)
      .then((r) => {
        if (cancelled) return
        setReport(r)
        return getClient(r.client_id)
      })
      .then((c) => {
        if (!cancelled && c) setClient(c)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load report.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reportId])

  const blocks = useMemo(
    () =>
      report && client
        ? buildReportBlocks(report, client, { formatCurrency, formatCompactCurrency, convertMentionsInText })
        : [],
    [report, client, formatCurrency, formatCompactCurrency, convertMentionsInText]
  )

  async function handleApprove(checked: boolean) {
    if (!report || !checked || report.status === "approved" || approving) return
    setApproving(true)
    setError(null)
    try {
      const updated = await putApproveReport(report.id)
      setReport(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve report.")
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <LoadingLine label="Loading report…" />
      </div>
    )
  }
  if (error && !report) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }
  if (!report || !client) return null

  const c = report.content
  const generatedDate = new Date(report.generated_at)
  const preparedLine = `Prepared ${generatedDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`
  const fullFooterText = `${c.disclosures.join(" ")} ${preparedLine}`

  return (
    <div className="space-y-4">
      {/* Toolbar — hidden on print, matches the mockup's own sticky sub-header */}
      <div
        data-no-print
        className="flex flex-wrap items-center gap-3 rounded-[12px] border border-border bg-card p-3 shadow-[var(--shadow-card)]"
      >
        <span className="flex items-center gap-[7px] text-[11.5px] text-muted-3">
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-5M12 8h.01" />
          </svg>
          Client-facing view &middot; read-only
        </span>

        <span className="ml-auto text-[11.5px] font-medium text-muted-foreground">
          {report.status === "approved" ? (
            <span className="text-primary">
              Approved{report.approved_at ? ` · ${new Date(report.approved_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
            </span>
          ) : (
            <span className="text-secondary">Draft — not yet approved</span>
          )}
        </span>

        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-[7px] text-[12.5px] font-medium text-foreground">
          <input
            type="checkbox"
            checked={report.status === "approved"}
            disabled={report.status === "approved" || approving}
            onChange={(e) => handleApprove(e.target.checked)}
            className="h-[15px] w-[15px] cursor-pointer accent-[var(--primary)] transition-transform duration-150 ease-out not-disabled:hover:scale-110 disabled:cursor-not-allowed"
          />
          {report.status === "approved" ? "Approved for client" : approving ? "Approving…" : "Approve for client"}
        </label>

        <button
          type="button"
          onClick={() => window.print()}
          className="flex h-[34px] cursor-pointer items-center gap-[7px] rounded-md border border-primary bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]"
        >
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 3v12" />
            <path d="m7 12 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Download PDF
        </button>

        {error && <span className="w-full text-[12px] text-destructive">{error}</span>}
      </div>

      {/* The report itself: one continuous document, no per-page containers
          and nothing that can clip overflow. print:max-w-none is
          load-bearing: Chrome can silently reapply a narrower-than-default
          printable width from a remembered print-dialog setting, and a
          hardcoded 8.5in box would then overflow past that real edge and
          get clipped rather than reflowing. Padding provides the on-screen
          "paper" look; print:p-0 hands that job to @page's own margin
          instead, since @page margin is what actually repeats correctly on
          every physical printed page (see index.css). */}
      <div
        className="report-paper mx-auto w-full max-w-[8.5in] rounded-[12px] border border-border bg-card p-[60px_64px] shadow-[var(--shadow-card)] print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
        style={{ color: "#241F1A", fontFamily: '"IBM Plex Sans", system-ui, sans-serif' }}
      >
        {blocks.map((block) => (
          <div key={block.key} className={block.className}>
            {block.node}
          </div>
        ))}
        <DocumentFooter text={fullFooterText} />
      </div>
    </div>
  )
}
