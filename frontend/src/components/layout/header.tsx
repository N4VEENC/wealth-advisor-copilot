import { useEffect, useRef, useState, type ReactNode } from "react"
import { Loader2, Moon, Sun } from "lucide-react"
import { Link, useLocation, useMatch, useNavigate } from "react-router-dom"

import { useTheme } from "@/components/providers/theme-provider"
import { CURRENCIES, CURRENCY_INFO, useCurrency } from "@/components/providers/currency-provider"
import {
  ApiError,
  getAnalysis,
  getClient,
  getFlaggedMessages,
  postGenerateReport,
  type AnalysisResponse,
  type ClientRecord,
  type FlaggedMessage,
} from "@/lib/api"
import { cn } from "@/lib/utils"

// Same overlay pattern as chat-panel.tsx's ConfirmOverlay — duplicated
// locally rather than extracted into a shared component, matching this
// app's existing convention of a page/section-local modal wrapper.
function ConfirmOverlay({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div
      // overflow-y-auto is load-bearing: without it, a dialog taller than
      // the viewport gets centered by the flex box but has no way to
      // actually reach the parts that overflow top/bottom — this is what
      // clipped the notes picker (header + several note cards + footer can
      // easily exceed a real browser window's height, unlike the small
      // FlagConfirmDialog this pattern was first written for).
      className="fixed inset-0 z-[80] flex animate-in items-center justify-center overflow-y-auto p-8 fade-in-0 duration-150"
      style={{ background: "rgba(22, 19, 15, 0.55)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      {children}
    </div>
  )
}

// Same terracotta/estimate treatment as the chat's own exploratory bubbles
// and the standalone Flagged notes list — unchecked by default; generating
// with nothing checked is identical to the old, note-free behavior.
function NotesPickerDialog({
  notes,
  selectedIds,
  onToggle,
  onCancel,
  onGenerate,
}: {
  notes: FlaggedMessage[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onCancel: () => void
  onGenerate: () => void
}) {
  return (
    <ConfirmOverlay onDismiss={onCancel}>
      <div className="flex max-h-[85vh] w-full max-w-[520px] animate-in flex-col overflow-hidden rounded-[14px] border border-border bg-card fade-in-0 zoom-in-95 duration-150 shadow-[var(--shadow-elevated)]">
        <div className="flex flex-col gap-[3px] border-b border-border p-[20px_22px_16px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
            Attach any of your flagged notes to this report? (optional)
          </span>
          <span className="text-[12px] text-muted-3">
            Nothing is attached unless you check a note below — generating with none checked behaves exactly like
            generating without this feature at all.
          </span>
        </div>
        <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto p-[16px_22px]">
          {notes.map((note) => (
            <label
              key={note.id}
              className="flex cursor-pointer items-start gap-2.5 rounded-[9px] border border-border border-l-[3px] border-l-secondary bg-secondary/10 p-3"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(note.id)}
                onChange={() => onToggle(note.id)}
                className="mt-0.5 h-[15px] w-[15px] shrink-0 cursor-pointer accent-[var(--secondary)]"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex w-fit items-center rounded-[5px] bg-secondary/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.03em] text-secondary">
                    AI estimate — not verified
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-3">
                    {new Date(note.flagged_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {note.prompted_by && (
                  <span className="text-[11.5px] font-medium text-muted-foreground">Q: {note.prompted_by}</span>
                )}
                <p className="m-0 line-clamp-3 text-[12.5px] leading-[1.5] text-foreground">{note.content}</p>
              </div>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-[16px_22px_20px]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-card px-[13px] py-2 text-[12.5px] font-medium text-muted-foreground transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-lg border border-primary bg-primary px-3.5 py-2 text-[12.5px] font-medium text-primary-foreground transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]"
          >
            {selectedIds.size > 0 ? `Generate report (${selectedIds.size} note${selectedIds.size === 1 ? "" : "s"} attached)` : "Generate report"}
          </button>
        </div>
      </div>
    </ConfirmOverlay>
  )
}

const RISK_PROFILE_LABEL: Record<string, string> = {
  conservative: "Conservative",
  "moderate-growth": "Moderate growth",
  balanced: "Balanced",
  "aggressive-growth": "Aggressive growth",
  "esg-tilted": "ESG-tilted",
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  taxable: "Taxable brokerage",
  "401k": "401(k)",
  ira: "IRA",
  roth_ira: "Roth IRA",
}

function buildTabs(clientId: string) {
  return [
    { to: `/clients/${clientId}/dashboard`, label: "Dashboard" },
    { to: `/clients/${clientId}/holdings`, label: "Holdings" },
    { to: `/clients/${clientId}/reports`, label: "Client report" },
  ] as const
}

function ChevronDown() {
  return (
    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ opacity: 0.65 }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function CurrencyMenu() {
  const { currency, setCurrency } = useCurrency()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Display currency: ${currency} — change currency`}
        title="Display currency"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[34px] cursor-pointer items-center gap-[6px] rounded-md border border-border bg-card px-[9px] text-muted-foreground transition-transform duration-150 ease-out hover:scale-[1.03] active:scale-95"
      >
        <span className="font-mono text-[13px] font-medium text-primary">{CURRENCY_INFO[currency].symbol}</span>
        <span className="font-mono text-[12px] font-medium tracking-[0.02em]">{currency}</span>
        <ChevronDown />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Display currency"
          className="absolute top-[calc(100%+6px)] right-0 z-[60] flex min-w-[248px] animate-in flex-col gap-px rounded-[10px] border border-border bg-card p-1.5 fade-in-0 zoom-in-95 duration-150 shadow-[0_8px_24px_var(--ring),0_1px_2px_var(--ring)]"
        >
          <div className="px-[9px] pt-0.5 pb-1.5 text-[11px] font-medium tracking-[0.07em] text-muted-3 uppercase">
            Display currency
          </div>
          {CURRENCIES.map((code) => (
            <button
              key={code}
              type="button"
              role="option"
              aria-selected={code === currency}
              onClick={() => {
                setCurrency(code)
                setOpen(false)
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-[9px] rounded-[7px] px-[9px] py-[7px] text-left text-foreground",
                code === currency ? "bg-accent" : "bg-transparent"
              )}
            >
              <span className="w-[15px] font-mono text-[12.5px] font-medium text-primary">
                {CURRENCY_INFO[code].symbol}
              </span>
              <span className="font-mono text-[12px] font-medium">{code}</span>
              <span className="ml-auto text-[11.5px] whitespace-nowrap text-muted-3">
                {CURRENCY_INFO[code].name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Header({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const clientMatch = useMatch("/clients/:clientId/*")
  const clientId = clientMatch?.params.clientId
  const { theme, toggleTheme } = useTheme()
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [flaggedNotes, setFlaggedNotes] = useState<FlaggedMessage[]>([])
  const [showNotesPicker, setShowNotesPicker] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setClient(null)
    setAnalysis(null)
    setFlaggedNotes([])
    if (!clientId) return
    getClient(clientId).then((c) => !cancelled && setClient(c))
    // A brand-new client has no holdings yet, so /analysis has nothing to
    // compute from — the client-name header still renders fine without it.
    getAnalysis(clientId)
      .then((a) => !cancelled && setAnalysis(a))
      .catch(() => {})
    // Only fetched so the "Generate report" button knows whether to offer
    // the optional attach-notes picker at all — see handleGenerateReportClick.
    getFlaggedMessages(clientId)
      .then((res) => !cancelled && setFlaggedNotes(res.flagged_messages))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [clientId])

  const maxDriftPp = analysis
    ? Math.max(...Object.values(analysis.drift).map((d) => Math.abs(d))) * 100
    : null

  const accountTypes = client
    ? Array.from(new Set([...client.holdings.map((h) => h.account_type), client.cash_account_type])).map(
        (t) => ACCOUNT_TYPE_LABEL[t] ?? t
      )
    : []

  // Only ever shows the optional picker when there's something to pick —
  // a client with zero flagged notes generates exactly like it always did,
  // no extra step, no dialog. Re-fetches flagged notes fresh on every click
  // rather than trusting the page-load `flaggedNotes` state: an advisor can
  // flag a new chat message at any point while sitting on this same
  // Dashboard, and that action never changes clientId, so the effect above
  // would never re-run and this button would keep offering a stale list.
  async function handleGenerateReportClick() {
    if (!clientId) return
    const fresh = await getFlaggedMessages(clientId)
      .then((res) => res.flagged_messages)
      .catch(() => flaggedNotes)
    setFlaggedNotes(fresh)
    if (fresh.length > 0) {
      setSelectedNoteIds(new Set())
      setShowNotesPicker(true)
    } else {
      void runGenerateReport([])
    }
  }

  function toggleSelectedNote(id: string) {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runGenerateReport(flaggedMessageIds: string[]) {
    if (!clientId) return
    setShowNotesPicker(false)
    setGenerating(true)
    setGenerateError(null)
    try {
      await postGenerateReport(clientId, flaggedMessageIds)
      navigate(`/clients/${clientId}/reports`)
    } catch (err) {
      // The one real failure mode here is the AI's narrative call — reports.py
      // hard-fails without a narrative (unlike the Dashboard's /insights,
      // which tolerates a missing one), so this is a real, expected error
      // path, not a bug to silently swallow.
      setGenerateError(err instanceof ApiError ? err.message : "Could not generate report.")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
    <header data-app-header className="sticky top-0 z-30 border-b border-border bg-[color-mix(in_oklab,var(--background)_88%,transparent)] px-6 backdrop-blur-[10px]">
      <div className="flex min-h-[60px] flex-wrap items-center gap-x-4 gap-y-2.5 py-2.5">
        <button
          type="button"
          title="Toggle sidebar"
          aria-label={sidebarOpen ? "Collapse client sidebar" : "Expand client sidebar"}
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
        >
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>

        <div className="flex min-w-0 flex-1 basis-60 flex-col leading-[1.2]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="m-0 overflow-hidden text-[16px] font-semibold tracking-[-0.015em] text-ellipsis whitespace-nowrap text-foreground">
              {client?.name ?? " "}
            </h1>
            {client && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
                {RISK_PROFILE_LABEL[client.risk_profile] ?? client.risk_profile}
              </span>
            )}
            {maxDriftPp !== null && (
              <span className="rounded-full border border-[color-mix(in_oklab,var(--secondary)_40%,transparent)] bg-[color-mix(in_oklab,var(--secondary)_12%,transparent)] px-2 py-0.5 text-[12px] font-medium text-secondary">
                Drift {maxDriftPp.toFixed(1)}pp
              </span>
            )}
          </div>
          <span className="mt-[3px] overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-muted-3">
            {accountTypes.length > 0 ? accountTypes.join(" + ") : " "}
            {analysis && ` · As of ${new Date(analysis.as_of).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2.5 gap-y-2">
          {clientId && (
            <div role="tablist" aria-label="Client views" className="flex gap-0.5 rounded-[9px] bg-muted p-[3px]">
              {buildTabs(clientId).map((tab) => {
                const isActive = location.pathname.startsWith(tab.to)
                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    role="tab"
                    aria-selected={isActive}
                    className={cn(
                      "flex h-7 items-center justify-center rounded-[7px] px-3 text-[12.5px] font-medium leading-none",
                      isActive ? "bg-card text-foreground shadow-[var(--shadow-card)]" : "bg-transparent text-muted-foreground"
                    )}
                  >
                    {tab.label}
                  </Link>
                )
              })}
            </div>
          )}

          <button
            type="button"
            title="Toggle theme"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggleTheme}
            className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-transform duration-150 ease-out hover:scale-[1.05] active:scale-95"
          >
            {/* Deliberate deviation from the mockup, which always shows the
                same crescent regardless of theme — a toggle should reflect
                the theme it'll switch you to: moon in light mode (switch to
                dark), sun in dark mode (switch to light). */}
            {theme === "dark" ? <Sun aria-hidden="true" size={15} /> : <Moon aria-hidden="true" size={15} />}
          </button>

          <CurrencyMenu />

          {generateError && (
            <span className="max-w-[220px] truncate text-[12px] text-destructive" title={generateError}>
              {generateError}
            </span>
          )}

          {clientId && (
            <button
              type="button"
              onClick={handleGenerateReportClick}
              disabled={generating}
              className="flex h-[34px] cursor-pointer items-center gap-[7px] rounded-md border border-primary bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-[0_1px_2px_var(--ring)] transition-transform duration-150 ease-out hover:not-disabled:scale-[1.02] active:not-disabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {generating ? (
                <Loader2 aria-hidden="true" width={14} height={14} className="animate-spin" />
              ) : (
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18v-6" />
                  <path d="m9 15 3 3 3-3" />
                </svg>
              )}
              {generating ? "Generating…" : "Generate report"}
            </button>
          )}
        </div>
      </div>
    </header>

    {/* Deliberately rendered as a sibling of <header>, NOT inside it: the
        header's own backdrop-blur-[10px] (backdrop-filter) establishes a
        containing block for `position: fixed` descendants — a real, easy-to-
        miss CSS rule (same effect as `filter`/`transform`/`contain`) — so a
        fixed-positioned dialog nested inside it gets sized/positioned
        relative to the header's own (short) box instead of the viewport.
        This is what clipped the notes picker to a sliver near the top of
        the screen instead of centering it in the real viewport. */}
    {showNotesPicker && (
      <NotesPickerDialog
        notes={flaggedNotes}
        selectedIds={selectedNoteIds}
        onToggle={toggleSelectedNote}
        onCancel={() => setShowNotesPicker(false)}
        onGenerate={() => runGenerateReport(Array.from(selectedNoteIds))}
      />
    )}
    </>
  )
}
