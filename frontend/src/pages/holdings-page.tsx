import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"

import { useCurrency } from "@/components/providers/currency-provider"
import {
  ApiError,
  getClient,
  getHoldings,
  postUploadHoldings,
  type ClientRecord,
  type HoldingRow,
  type HoldingsResponse,
} from "@/lib/api"
import { formatPercent, formatSignedPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LoadingLine } from "@/components/ui/loading-line"

type CurrencyFormatters = {
  formatCurrency: (usdAmount: number) => string
  formatCurrencyPrecise: (usdAmount: number) => string
  formatSignedCurrency: (usdAmount: number) => string
}

// Mockup's own subtitle uses this short, lowercase-for-taxable form (not the
// header nav's longer "Taxable brokerage") — matched verbatim per-page since
// that's literally what was extracted for this specific element.
function accountTypeShort(accountType: string): string {
  if (accountType === "401k") return "401(k)"
  if (accountType === "ira") return "IRA"
  if (accountType === "roth_ira") return "Roth IRA"
  return accountType
}

// The table's own Account column capitalizes "Taxable" (unlike the lowercase
// form the subtitle above uses) — matched per its own extracted cell text.
function accountTypeTableLabel(accountType: string): string {
  if (accountType === "taxable") return "Taxable"
  return accountTypeShort(accountType)
}

// Exact grid extracted from the mockup's Holdings table (getComputedStyle on
// the header row + a data row): Ticker/Name/Quantity/Cost basis/Market
// value/Weight/Return/Account.
const GRID_TEMPLATE_COLUMNS = "82px 1.4fr 96px 100px 110px 76px 92px 84px"

const HEADER_CELL_CLASS = "text-[11px] font-medium tracking-[0.07em] text-muted-3 uppercase"

function HeaderRow() {
  return (
    <div
      className="grid gap-0 border-b border-border bg-muted px-[18px] py-[9px]"
      style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, minWidth: 880 }}
    >
      <span className={cn(HEADER_CELL_CLASS, "text-left")}>Ticker</span>
      <span className={cn(HEADER_CELL_CLASS, "text-left")}>Name</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Quantity</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Cost basis</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Market value</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Weight</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Return</span>
      <span className={cn(HEADER_CELL_CLASS, "text-right")}>Account</span>
    </div>
  )
}

function DataRow({ row, fmt }: { row: HoldingRow; fmt: CurrencyFormatters }) {
  const hasReturn = row.gain_pct !== null
  return (
    <div
      className="grid items-center gap-0 border-b border-border px-[18px] py-2.5"
      style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, minWidth: 880 }}
    >
      <span className="font-mono text-xs font-semibold text-foreground">{row.ticker ?? "—"}</span>
      <span className="truncate pr-3 text-xs text-muted-foreground">{row.name}</span>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {row.quantity !== null ? row.quantity.toLocaleString() : "—"}
      </span>
      <span className="text-right font-mono text-xs text-muted-3">
        {row.average_cost_basis_per_share !== null ? fmt.formatCurrencyPrecise(row.average_cost_basis_per_share) : "—"}
      </span>
      <span className="text-right font-mono text-xs font-medium text-foreground">
        {row.market_value !== null ? fmt.formatCurrency(row.market_value) : "—"}
      </span>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {row.weight !== null ? formatPercent(row.weight) : "—"}
      </span>
      <span
        className={cn(
          "text-right font-mono text-xs font-medium",
          !hasReturn ? "text-muted-3" : row.gain_pct! >= 0 ? "text-positive" : "text-destructive"
        )}
      >
        {hasReturn ? formatSignedPercent(row.gain_pct!) : "—"}
      </span>
      <span className="text-right font-sans text-[11px] text-muted-3">{accountTypeTableLabel(row.account_type)}</span>
    </div>
  )
}

function TotalRow({ data, fmt }: { data: HoldingsResponse; fmt: CurrencyFormatters }) {
  return (
    <div
      className="grid gap-0 bg-muted px-[18px] py-2.5"
      style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, minWidth: 880 }}
    >
      <span className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">TOTAL</span>
      <span />
      <span />
      <span />
      <span className="text-right font-mono text-xs font-semibold text-foreground">
        {fmt.formatCurrency(data.total_portfolio_value)}
      </span>
      <span className="text-right font-mono text-xs font-semibold text-foreground">100.0%</span>
      <span
        className={cn(
          "text-right font-mono text-xs font-semibold",
          data.total_return_pct >= 0 ? "text-positive" : "text-destructive"
        )}
      >
        {formatSignedPercent(data.total_return_pct)}
      </span>
      <span />
    </div>
  )
}

export function HoldingsPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // A brand-new client (or one whose holdings were just deleted) has no
  // holdings to analyze yet — that's a 422 from GET /holdings, not a real
  // error. Distinguishing it lets this page show the same upload prompt as
  // the App Flow doc's empty-state spec, instead of leaking the backend's
  // "has no holdings to analyze" sentence as if something had gone wrong.
  const [noHoldings, setNoHoldings] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { formatCurrency, formatCurrencyPrecise, formatSignedCurrency } = useCurrency()
  const fmt: CurrencyFormatters = { formatCurrency, formatCurrencyPrecise, formatSignedCurrency }

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setNoHoldings(false)

    // getClient and getHoldings don't depend on each other's result (both
    // only need clientId, already known from the route) — firing them
    // together instead of chaining saves one full round-trip. Settled
    // rather than Promise.all so a 422 from getHoldings (no holdings yet)
    // doesn't discard the getClient result we still need for the upload
    // prompt's "Upload {client.name}'s holdings" text.
    Promise.allSettled([getClient(clientId), getHoldings(clientId)]).then(([clientResult, holdingsResult]) => {
      if (cancelled) return

      if (clientResult.status === "fulfilled") {
        setClient(clientResult.value)
      } else {
        setError(clientResult.reason instanceof ApiError ? clientResult.reason.message : "Could not load holdings.")
        setLoading(false)
        return
      }

      if (holdingsResult.status === "fulfilled") {
        setHoldings(holdingsResult.value)
      } else if (holdingsResult.reason instanceof ApiError && holdingsResult.reason.status === 422) {
        setNoHoldings(true)
      } else {
        setError(holdingsResult.reason instanceof ApiError ? holdingsResult.reason.message : "Could not load holdings.")
      }

      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [clientId])

  async function handleFileSelected(file: File) {
    if (!clientId) return
    setUploading(true)
    setUploadError(null)
    try {
      const updatedClient = await postUploadHoldings(clientId, file)
      setClient(updatedClient)
      const holdingsResponse = await getHoldings(clientId)
      setHoldings(holdingsResponse)
      setNoHoldings(false)
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Could not parse that file.")
    } finally {
      setUploading(false)
    }
  }

  const accountTypesLabel = client
    ? Array.from(new Set([...client.holdings.map((h) => h.account_type), client.cash_account_type]))
        .map(accountTypeShort)
        .join(" + ")
    : ""

  const pricesAsOf = holdings
    ? new Date(holdings.as_of).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null

  return (
    <div className="space-y-6">
      {loading && <LoadingLine label="Loading holdings…" />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {noHoldings && client && (
        <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 rounded-[12px] border border-dashed border-border bg-card p-10 text-center shadow-[var(--shadow-card)]">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M12 18v-6" />
              <path d="m9 15 3 3 3-3" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-[18px] font-semibold text-foreground">No holdings uploaded yet</h1>
            <p className="m-0 text-sm text-muted-foreground">
              Upload {client.name}&rsquo;s holdings as a .csv or .xlsx export to get started. Expected columns:
              ticker, quantity, cost basis, account type.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileSelected(file)
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-[38px] cursor-pointer items-center gap-2 rounded-md border border-primary bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
          >
            {uploading ? "Parsing…" : "Upload holdings file"}
          </button>
          {uploadError && <p className="m-0 text-[12px] text-destructive">{uploadError}</p>}
        </div>
      )}

      {client && holdings && (
        <>
          <div className="flex items-end gap-3.5">
            <div className="flex flex-col gap-[3px]">
              <h1 className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-foreground">Client holdings</h1>
              <span className="text-xs text-muted-3">
                {client.name} &middot; {accountTypesLabel} &middot; {holdings.total_positions} positions
              </span>
            </div>
            <div className="ml-auto flex gap-4">
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs text-muted-3">Total corpus</span>
                <span className="font-mono text-[17px] font-semibold tracking-[-0.02em] text-foreground">
                  {formatCurrency(holdings.total_portfolio_value)}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs text-muted-3">Total returns</span>
                <span
                  className={cn(
                    "font-mono text-[17px] font-semibold tracking-[-0.02em]",
                    holdings.total_return_dollar >= 0 ? "text-positive" : "text-destructive"
                  )}
                >
                  {formatSignedCurrency(holdings.total_return_dollar)}
                </span>
              </div>
              <button
                type="button"
                disabled
                title="Adding holdings isn't wired to a backend mutation yet — holdings are imported via the client's Excel upload."
                aria-disabled="true"
                className="flex h-[34px] cursor-not-allowed items-center gap-[7px] self-end rounded-md border border-primary bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground opacity-60"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add holding
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]">
            <div
              className="flex items-center gap-3 border-b border-border"
              style={{ padding: "16px 18px 13px" }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-foreground">Holdings</span>
                <span className="text-[11.5px] text-muted-3">
                  Real tax-lot holdings &middot; ticker, quantity, cost basis &middot; prices as of {pricesAsOf} close
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <HeaderRow />
              {holdings.rows.map((row) => (
                <DataRow key={`${row.ticker}-${row.account_type}`} row={row} fmt={fmt} />
              ))}
              {holdings.cash_row && <DataRow row={holdings.cash_row} fmt={fmt} />}
              <TotalRow data={holdings} fmt={fmt} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
