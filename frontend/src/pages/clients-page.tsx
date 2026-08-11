import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react"
import { useMatch, useNavigate } from "react-router-dom"

import { useCurrency } from "@/components/providers/currency-provider"
import {
  ApiError,
  deleteClient,
  getClients,
  getStrategies,
  postAddManualHolding,
  postCreateClient,
  postUploadHoldings,
  type ClientSummary,
  type StrategyOption,
} from "@/lib/api"
import { formatSignedPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LoadingLine } from "@/components/ui/loading-line"

const CURRENT_YEAR = new Date().getFullYear()

const ACCOUNT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "taxable", label: "Taxable" },
  { value: "401k", label: "401(k)" },
  { value: "ira", label: "IRA" },
  { value: "roth_ira", label: "Roth IRA" },
]

// Every literal px/font/color value below (grid columns, paddings, the
// rgba(22,19,15,0.55) overlay tint, the exact --token names) is copied from
// the live mockup's inline styles for its real Clients table + Add-client
// dialog + client-action dialog + upload dropzone — this whole screen was
// missed in an earlier extraction pass because its sidebar nav item looked
// inert; it isn't, all 4 states are real and pixel-matched here.
const FIELD_LABEL_CLASS = "text-[12px] font-medium tracking-[0.05em] uppercase text-muted-3"
const FIELD_INPUT_CLASS =
  "h-[34px] w-full box-border rounded-lg border border-border bg-background px-[11px] text-[12.5px] text-foreground outline-none"
const DIALOG_TRANSITION_CLASS = "transition-transform duration-150 ease-out"
const DIALOG_CANCEL_CLASS = `rounded-lg border border-border bg-card px-[13px] py-2 text-[12.5px] font-medium text-muted-foreground cursor-pointer ${DIALOG_TRANSITION_CLASS} hover:scale-[1.02] active:scale-[0.98]`
const DIALOG_PRIMARY_ENABLED_CLASS = `rounded-lg border border-primary bg-primary px-3.5 py-2 text-[12.5px] font-medium text-primary-foreground cursor-pointer ${DIALOG_TRANSITION_CLASS} hover:scale-[1.02] active:scale-[0.98]`
const DIALOG_PRIMARY_DISABLED_CLASS =
  "rounded-lg border border-border bg-muted px-3.5 py-2 text-[12.5px] font-medium text-muted-3 cursor-not-allowed"

function ModalOverlay({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex animate-in items-center justify-center p-8 fade-in-0 duration-150"
      style={{ background: "rgba(22, 19, 15, 0.55)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[5px]">
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-[1.4] text-muted-3">{hint}</span>}
    </label>
  )
}

function AddClientDialog({
  strategies,
  onClose,
  onCreated,
}: {
  strategies: StrategyOption[]
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [age, setAge] = useState("")
  const [riskProfile, setRiskProfile] = useState(strategies[0]?.id ?? "")
  const [accountsNote, setAccountsNote] = useState("")
  const [targetRetirementAmount, setTargetRetirementAmount] = useState("")
  const [goalYear, setGoalYear] = useState(String(CURRENT_YEAR + 15))
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim().length > 0 && riskProfile.length > 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await postCreateClient({
        name: name.trim(),
        risk_profile: riskProfile,
        goal_year: Number(goalYear),
        email: email.trim() || undefined,
        age: age ? Number(age) : undefined,
        accounts_note: accountsNote.trim() || undefined,
        target_retirement_amount: targetRetirementAmount ? Number(targetRetirementAmount) : undefined,
        notes: notes.trim() || undefined,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create client.")
      setSubmitting(false)
    }
  }

  return (
    <ModalOverlay onDismiss={onClose}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[560px] animate-in overflow-hidden rounded-[14px] border border-border bg-card fade-in-0 zoom-in-95 duration-150 shadow-[var(--shadow-elevated)]"
      >
        <div className="flex flex-col gap-[3px] border-b border-border p-[20px_22px_16px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">Add client</span>
          <span className="text-[12px] text-muted-3">A client ID is generated on save. Holdings can be imported afterwards.</span>
        </div>

        <div className="grid grid-cols-2 gap-3 p-[18px_22px]">
          <Field label="Full name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Alvarez"
              className={FIELD_INPUT_CLASS}
            />
          </Field>
          <Field label="Email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@example.com"
              className={FIELD_INPUT_CLASS}
            />
          </Field>
          <Field label="Age">
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="46"
              className={FIELD_INPUT_CLASS}
            />
          </Field>
          <Field label="Risk profile">
            <select value={riskProfile} onChange={(e) => setRiskProfile(e.target.value)} className={FIELD_INPUT_CLASS}>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Accounts">
            <input
              value={accountsNote}
              onChange={(e) => setAccountsNote(e.target.value)}
              placeholder="Taxable + 401(k)"
              className={FIELD_INPUT_CLASS}
            />
          </Field>
          <Field label="Target retirement year">
            <input
              type="number"
              value={goalYear}
              onChange={(e) => setGoalYear(e.target.value)}
              placeholder="2044"
              className={FIELD_INPUT_CLASS}
            />
          </Field>
          <div className="col-span-2">
            <Field
              label="Target retirement amount (optional)"
              hint="Leave blank to estimate automatically from current holdings and target allocation."
            >
              <input
                type="number"
                value={targetRetirementAmount}
                onChange={(e) => setTargetRetirementAmount(e.target.value)}
                placeholder="2500000"
                className={FIELD_INPUT_CLASS}
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Notes">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Referred by H. Osei"
                className={FIELD_INPUT_CLASS}
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-[9px] border-t border-border p-[14px_22px_18px]">
          <span className="flex-1 text-[11px] text-muted-3">
            {error ?? (canSubmit ? "Ready to save." : "Enter at least a full name")}
          </span>
          <button type="button" onClick={onClose} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit || submitting} className={canSubmit ? DIALOG_PRIMARY_ENABLED_CLASS : DIALOG_PRIMARY_DISABLED_CLASS}>
            {submitting ? "Saving…" : "Save client"}
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-primary">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

function UploadDropzone({ clientId, onUploaded }: { clientId: string; onUploaded: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      await postUploadHoldings(clientId, file)
      onUploaded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload file.")
      setUploading(false)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload holdings file"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) void handleFile(file)
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      className={cn(
        "mx-[22px] mb-[18px] flex flex-col items-center gap-[7px] rounded-[11px] border border-dashed border-primary p-[22px] text-center cursor-pointer transition-colors duration-150 ease-out",
        dragging ? "bg-primary/15" : "bg-accent"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <UploadIcon />
      <span className="text-[12.5px] font-medium text-foreground">
        {uploading ? "Uploading…" : "Drop an .xlsx or .csv here, or click to browse"}
      </span>
      <span className={cn("text-[11px]", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? "Real import — parsed and saved to this client's holdings immediately."}
      </span>
    </div>
  )
}

function ManualHoldingDialog({
  client,
  onCancel,
  onAdded,
}: {
  client: ClientSummary
  onCancel: () => void
  onAdded: () => void
}) {
  const [ticker, setTicker] = useState("")
  const [quantity, setQuantity] = useState("")
  const [costBasis, setCostBasis] = useState("")
  const [accountType, setAccountType] = useState(ACCOUNT_TYPE_OPTIONS[0].value)
  const [purchaseDate, setPurchaseDate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = ticker.trim().length > 0 && Number(quantity) > 0 && costBasis.trim().length > 0 && accountType.length > 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await postAddManualHolding(client.id, {
        ticker: ticker.trim().toUpperCase(),
        quantity: Number(quantity),
        cost_basis_per_share: Number(costBasis),
        account_type: accountType,
        purchase_date: purchaseDate || undefined,
      })
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this holding.")
      setSubmitting(false)
    }
  }

  return (
    <ModalOverlay onDismiss={onCancel}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[560px] animate-in overflow-hidden rounded-[14px] border border-border bg-card fade-in-0 zoom-in-95 duration-150 shadow-[var(--shadow-elevated)]"
      >
        <div className="flex flex-col gap-[3px] border-b border-border p-[20px_22px_16px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">Add holding</span>
          <span className="text-[12px] text-muted-3">
            Manual entry for {client.name} · weights and returns recalculate once this client's Dashboard is opened
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 p-[18px_22px]">
          <Field label="Ticker">
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="VTI" className={FIELD_INPUT_CLASS} />
          </Field>
          <Field label="Account">
            <select value={accountType} onChange={(e) => setAccountType(e.target.value)} className={FIELD_INPUT_CLASS}>
              {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="420" className={FIELD_INPUT_CLASS} />
          </Field>
          <Field label="Cost basis / share">
            <input
              type="number"
              step="0.01"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              placeholder="238.55"
              className={FIELD_INPUT_CLASS}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Purchase date (optional)">
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={FIELD_INPUT_CLASS} />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-[9px] border-t border-border p-[14px_22px_18px]">
          <span className="flex-1 text-[11px] text-muted-3">
            {error ?? "Ticker, quantity, cost basis and account are required"}
          </span>
          <button type="button" onClick={onCancel} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit || submitting} className={canSubmit ? DIALOG_PRIMARY_ENABLED_CLASS : DIALOG_PRIMARY_DISABLED_CLASS}>
            {submitting ? "Adding…" : "Add holding"}
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}

function OptionCard({
  icon,
  title,
  description,
  highlighted,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  highlighted?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-[7px] rounded-[11px] border p-4 text-left cursor-pointer",
        highlighted ? "border-primary bg-accent" : "border-border bg-background"
      )}
    >
      {icon}
      <span className="text-[13px] font-medium text-foreground">{title}</span>
      <span className="text-[11.5px] leading-[1.5] text-muted-3">{description}</span>
    </button>
  )
}

function ClientActionDialog({
  client,
  strategies,
  onClose,
  onUpdated,
}: {
  client: ClientSummary
  strategies: StrategyOption[]
  onClose: () => void
  onUpdated: () => void
}) {
  const navigate = useNavigate()
  const [uploadExpanded, setUploadExpanded] = useState(false)
  const [manualMode, setManualMode] = useState(false)

  const riskLabel = strategies.find((s) => s.id === client.risk_profile)?.label ?? client.risk_profile
  const accountsLabel = client.accounts_note

  function goToDashboard() {
    onClose()
    navigate(`/clients/${client.id}/dashboard`)
  }

  function handleHoldingsChanged() {
    onUpdated()
    onClose()
    navigate(`/clients/${client.id}/dashboard`)
  }

  if (manualMode) {
    return <ManualHoldingDialog client={client} onCancel={() => setManualMode(false)} onAdded={handleHoldingsChanged} />
  }

  const importedLabel = client.uploaded_at
    ? new Date(client.uploaded_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null

  const hintText = !client.has_holdings
    ? "No holdings on file yet"
    : client.holdings_source === "upload"
      ? `Holdings on file — last import ${importedLabel}`
      : `Holdings on file — last updated ${importedLabel}`

  return (
    <ModalOverlay onDismiss={onClose}>
      <div className="w-full max-w-[520px] animate-in overflow-hidden rounded-[14px] border border-border bg-card fade-in-0 zoom-in-95 duration-150 shadow-[var(--shadow-elevated)]">
        <div className="flex flex-col gap-[3px] border-b border-border p-[20px_22px_16px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{client.name}</span>
          <span className="text-[12px] text-muted-3">
            {client.id} · {riskLabel}
            {accountsLabel ? ` · ${accountsLabel}` : ""}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 p-[18px_22px]">
          <OptionCard
            highlighted={!uploadExpanded}
            onClick={() => setUploadExpanded(true)}
            icon={
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-primary">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 18v-6" />
                <path d="m9 15 3-3 3 3" />
              </svg>
            }
            title="Upload holdings file"
            description=".xlsx or .csv with ticker, quantity and cost basis columns. Columns are mapped on import."
          />
          <OptionCard
            onClick={() => setManualMode(true)}
            icon={
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-primary">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            }
            title="Enter holdings manually"
            description="Add positions one at a time. Good for a handful of lots or an account the file missed."
          />
        </div>

        {uploadExpanded && <UploadDropzone clientId={client.id} onUploaded={handleHoldingsChanged} />}

        <div className="flex items-center gap-[9px] border-t border-border p-[14px_22px_18px]">
          <span className="flex-1 text-[11px] text-muted-3">{hintText}</span>
          <button type="button" onClick={onClose} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button type="button" onClick={goToDashboard} className={DIALOG_PRIMARY_ENABLED_CLASS}>
            Open dashboard
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

const TABLE_GRID_COLUMNS = "104px 1.5fr 54px 1.1fr 128px 108px 104px 112px 40px"
const HEADER_CELL_CLASS = "text-[11px] font-medium tracking-[0.07em] uppercase text-muted-3"

function StatusBadge({ hasHoldings }: { hasHoldings: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        hasHoldings ? "bg-positive/15 text-positive" : "bg-muted text-muted-3"
      )}
    >
      {hasHoldings ? "Data imported" : "Awaiting data"}
    </span>
  )
}

function ClientRow({
  summary,
  isCurrent,
  formatCurrency,
  onOpenAction,
  onDeleted,
  onDeleteFailed,
}: {
  summary: ClientSummary
  isCurrent: boolean
  formatCurrency: (usdAmount: number) => string
  onOpenAction: () => void
  onDeleted: (id: string, name: string) => void
  onDeleteFailed: (name: string, message: string) => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: MouseEvent) {
    e.stopPropagation()
    if (!window.confirm(`Remove ${summary.name}? This permanently deletes their record and cannot be undone.`)) return
    setDeleting(true)
    try {
      await deleteClient(summary.id)
      onDeleted(summary.id, summary.name)
    } catch (err) {
      // 409 = this client has reports referencing it (DELETE /clients/{id}'s
      // default, safe behavior — never bypassed silently). The ONLY way
      // past it is a second, explicit confirmation naming exactly how many
      // reports will also be destroyed, then a deliberate force=true retry.
      // Every other error is surfaced at the page level (a per-row tooltip
      // only shows on hover, which reads as "nothing happened").
      if (err instanceof ApiError && err.status === 409) {
        const reportCount = err.message.match(/(\d+) report/)?.[1] ?? "existing"
        const forceConfirmed = window.confirm(
          `${summary.name} has ${reportCount} report(s) that will also be permanently deleted — are you sure?`
        )
        if (forceConfirmed) {
          try {
            await deleteClient(summary.id, true)
            onDeleted(summary.id, summary.name)
          } catch (forceErr) {
            onDeleteFailed(summary.name, forceErr instanceof ApiError ? forceErr.message : "Could not remove client.")
          }
        }
        setDeleting(false)
        return
      }
      onDeleteFailed(summary.name, err instanceof ApiError ? err.message : "Could not remove client.")
      setDeleting(false)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenAction}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpenAction()
        }
      }}
      className="grid items-center border-b border-border p-[11px_18px] cursor-pointer transition-colors duration-150 ease-out"
      style={{ gridTemplateColumns: TABLE_GRID_COLUMNS, background: isCurrent ? "var(--accent)" : "transparent" }}
    >
      <span className="font-mono text-[11.5px] font-medium text-muted-3">{summary.id}</span>
      <div className="flex min-w-0 flex-col gap-px pr-3">
        <span className="text-[12.5px] font-medium text-foreground">{summary.name}</span>
        {summary.email && <span className="truncate text-xs text-muted-3">{summary.email}</span>}
      </div>
      <span className="font-mono text-xs text-muted-foreground">{summary.age ?? "—"}</span>
      <span className="pr-[10px] text-xs text-muted-foreground">{summary.risk_profile}</span>
      <span className="truncate pr-[10px] text-[11.5px] text-muted-3">
        {summary.accounts_note ?? (summary.has_holdings ? "" : "—")}
      </span>
      <span className="text-right font-mono text-xs font-medium text-foreground">
        {summary.corpus !== null ? formatCurrency(summary.corpus) : "—"}
      </span>
      <span
        className={cn(
          "text-right font-mono text-xs font-medium",
          summary.return_pct === null ? "text-muted-3" : summary.return_pct >= 0 ? "text-positive" : "text-destructive"
        )}
      >
        {summary.return_pct !== null ? formatSignedPercent(summary.return_pct) : "—"}
      </span>
      <span className="flex justify-end pr-2">
        <StatusBadge hasHoldings={summary.has_holdings} />
      </span>
      <button
        type="button"
        title="Remove client"
        aria-label={`Remove ${summary.name}`}
        onClick={handleDelete}
        disabled={deleting}
        className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center justify-self-end rounded-md border border-transparent text-muted-3 transition-transform duration-150 ease-out hover:scale-110 active:scale-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
        </svg>
      </button>
    </div>
  )
}

// The mockup's own Clients screen (list + Add-client dialog + client-action
// dialog + upload dropzone) was missed in an earlier extraction pass — its
// sidebar nav item looked inert on first pass, but it's a real, fully
// interactive screen. Every literal style value here is copied from that
// live mockup, not invented for this app.
export function ClientsPage() {
  const clientMatch = useMatch("/clients/:clientId/*")
  const currentClientId = clientMatch?.params.clientId
  const { formatCurrency } = useCurrency()

  const [clients, setClients] = useState<ClientSummary[] | null>(null)
  const [strategies, setStrategies] = useState<StrategyOption[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [addClientOpen, setAddClientOpen] = useState(false)
  const [actionClient, setActionClient] = useState<ClientSummary | null>(null)
  const [deleteNotice, setDeleteNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getClients(), getStrategies()])
      .then(([clientsRes, strategiesRes]) => {
        if (cancelled) return
        setClients(clientsRes.clients)
        setStrategies(strategiesRes.strategies)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : "Could not load clients.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function refetchClients() {
    getClients()
      .then((res) => setClients(res.clients))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not refresh clients."))
  }

  const filtered = useMemo(() => {
    if (!clients) return null
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
  }, [clients, search])

  const importedCount = clients?.filter((c) => c.has_holdings).length ?? 0
  const awaitingCount = (clients?.length ?? 0) - importedCount

  function handleCreated() {
    setAddClientOpen(false)
    refetchClients()
  }

  function handleDeleted(id: string, name: string) {
    setClients((prev) => prev && prev.filter((c) => c.id !== id))
    setDeleteNotice({ kind: "success", text: `${name} was removed.` })
  }

  function handleDeleteFailed(name: string, message: string) {
    setDeleteNotice({ kind: "error", text: `Could not remove ${name}: ${message}` })
  }

  return (
    <div className="flex flex-col gap-4">
      {loading && <LoadingLine label="Loading clients…" />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Delete outcome — deliberately a visible, dismiss-until-acted-on
          banner rather than a hover tooltip. A tooltip-only error is
          indistinguishable from nothing happening (a 409-blocked delete
          looked identical to a successful one), and a silent success on a
          list that reflows afterward risks a follow-up click landing on a
          different row than the one the advisor meant to delete. */}
      {deleteNotice && (
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] font-medium",
            deleteNotice.kind === "success"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          <span className="flex-1">{deleteNotice.text}</span>
          <button
            type="button"
            onClick={() => setDeleteNotice(null)}
            className="cursor-pointer text-[11px] font-medium underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {clients && (
        <>
          <div className="flex flex-wrap items-end gap-[10px_14px]">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <h1 className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-foreground">Clients</h1>
              <span className="text-xs text-muted-3">
                {clients.length} clients · {importedCount} with imported holdings · {awaitingCount} awaiting data
              </span>
            </div>
            <div className="ml-auto flex items-center gap-[9px]">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or ID…"
                className="h-[34px] w-[210px] rounded-lg border border-border bg-card px-[11px] text-[12.5px] text-foreground outline-none"
              />
              <button
                type="button"
                onClick={() => setAddClientOpen(true)}
                className="flex h-[34px] cursor-pointer items-center gap-[7px] rounded-lg border border-primary bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add client
              </button>
            </div>
          </div>

          <section className="overflow-hidden rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]">
            <div className="overflow-x-auto">
              <div
                className="grid border-b border-border bg-muted p-[9px_18px]"
                style={{ gridTemplateColumns: TABLE_GRID_COLUMNS, minWidth: 940 }}
              >
                <span className={HEADER_CELL_CLASS}>Client ID</span>
                <span className={HEADER_CELL_CLASS}>Name</span>
                <span className={HEADER_CELL_CLASS}>Age</span>
                <span className={HEADER_CELL_CLASS}>Risk profile</span>
                <span className={HEADER_CELL_CLASS}>Accounts</span>
                <span className={cn(HEADER_CELL_CLASS, "text-right")}>Corpus</span>
                <span className={cn(HEADER_CELL_CLASS, "text-right")}>Return</span>
                <span className={cn(HEADER_CELL_CLASS, "text-right")}>Status</span>
                <span className={HEADER_CELL_CLASS} />
              </div>

              <div style={{ minWidth: 940 }}>
                {filtered && filtered.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 px-6 py-14 text-center">
                    <span className="text-sm font-medium text-foreground">
                      {clients.length === 0 ? "No clients yet" : "No clients match your search"}
                    </span>
                    <span className="text-xs text-muted-3">
                      {clients.length === 0 ? 'Use "Add client" above to create the first one.' : "Try a different name or client ID."}
                    </span>
                  </div>
                ) : (
                  filtered?.map((summary) => (
                    <ClientRow
                      key={summary.id}
                      summary={summary}
                      isCurrent={summary.id === currentClientId}
                      formatCurrency={formatCurrency}
                      onOpenAction={() => setActionClient(summary)}
                      onDeleted={handleDeleted}
                      onDeleteFailed={handleDeleteFailed}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 bg-muted p-[11px_18px]">
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-3">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16v-5M12 8h.01" />
              </svg>
              <span className="text-[11px] text-muted-3">
                Select a client to import a holdings file or enter positions manually. Prices are fetched live the first
                time that client's Dashboard is opened.
              </span>
            </div>
          </section>
        </>
      )}

      {addClientOpen && strategies && (
        <AddClientDialog strategies={strategies} onClose={() => setAddClientOpen(false)} onCreated={handleCreated} />
      )}

      {actionClient && strategies && (
        <ClientActionDialog
          client={actionClient}
          strategies={strategies}
          onClose={() => setActionClient(null)}
          onUpdated={refetchClients}
        />
      )}
    </div>
  )
}
