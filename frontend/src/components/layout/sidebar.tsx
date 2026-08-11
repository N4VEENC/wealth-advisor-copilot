import { useEffect, useState, type ReactNode } from "react"
import { NavLink, useMatch } from "react-router-dom"

import { getClient, getClients, getHoldingsSourceFileUrl, getReports, type ClientRecord } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Icon paths copied verbatim (viewBox/stroke/path data) from the mockup's
 * own inline SVGs — matched by exact glyph, not by nearest lucide-react
 * icon name, since the goal here is pixel identity, not semantic naming. */
function Icon({ paths, rects, circles }: { paths?: string[]; rects?: [number, number, number, number][]; circles?: [number, number, number][] }) {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0">
      {rects?.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} />)}
      {circles?.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} />)}
      {paths?.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

const CLIENTS_ICON = <Icon paths={["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M22 21v-2a4 4 0 0 0-3-3.87"]} circles={[[9, 7, 4]]} />
const DASHBOARD_ICON = <Icon rects={[[3, 3, 7, 9], [14, 3, 7, 5], [14, 12, 7, 9], [3, 16, 7, 5]]} />
const HOLDINGS_ICON = <Icon paths={["M3 6h18M3 12h18M3 18h18"]} />
const REPORTS_ICON = <Icon paths={["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"]} />
const EXPLANATIONS_ICON = <Icon paths={["M4 19.5V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-1.5", "M8 7h7M8 11h7"]} />

type NavItemProps = {
  to: string
  icon: ReactNode
  label: string
  count?: number
  disabledReason?: string
  end?: boolean
}

function NavItem({ to, icon, label, count, disabledReason, end }: NavItemProps) {
  if (disabledReason) {
    return (
      <span
        title={disabledReason}
        aria-disabled="true"
        className="flex cursor-not-allowed items-center gap-[9px] rounded-[7px] px-[9px] py-[7px] text-[13px] font-normal text-muted-3 opacity-60"
      >
        {icon}
        {label}
      </span>
    )
  }
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-[9px] rounded-[7px] px-[9px] py-[7px] text-[13px] cursor-pointer",
          isActive ? "bg-accent font-medium text-accent-foreground" : "font-normal text-muted-foreground"
        )
      }
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className="ml-auto font-mono text-[11px] font-medium text-muted-3">{count}</span>
      )}
    </NavLink>
  )
}

function SectionLabel({ children, withTopBorder }: { children: ReactNode; withTopBorder?: boolean }) {
  return (
    <div
      className={cn(
        "px-2 pb-1.5 text-[12px] font-medium tracking-[0.07em] text-muted-3 uppercase",
        withTopBorder && "border-t border-border pt-3"
      )}
    >
      {children}
    </div>
  )
}

export function Sidebar() {
  const clientMatch = useMatch("/clients/:clientId/*")
  const clientId = clientMatch?.params.clientId
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [clientCount, setClientCount] = useState<number | null>(null)
  const [reportCount, setReportCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setClient(null)
    setReportCount(null)
    getClients().then((r) => !cancelled && setClientCount(r.clients.length))
    if (clientId) {
      getClient(clientId).then((c) => !cancelled && setClient(c))
      getReports(clientId).then((r) => !cancelled && setReportCount(r.reports.length))
    }
    return () => {
      cancelled = true
    }
  }, [clientId])

  const importedLabel = client
    ? new Date(client.uploaded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null

  return (
    <aside data-app-sidebar className="box-border flex h-full w-[236px] shrink-0 flex-col gap-[22px] overflow-y-auto border-r border-border bg-card p-3 py-4">
      <div className="flex items-center gap-[10px] px-1.5 py-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-primary text-[11px] font-semibold tracking-[0.02em] text-primary-foreground">
          WAC
        </div>
        <div className="flex flex-col leading-[1.15]">
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">Wealth Advisor</span>
          <span className="text-[11px] font-normal text-muted-3">Copilot</span>
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>Workspace</SectionLabel>
        {/* end: NavLink's default non-exact matching treats "/clients" as a
            prefix match, so without it this stayed highlighted on every
            /clients/:id/* subpage (Dashboard, Holdings, Reports) too. */}
        <NavItem to="/clients" icon={CLIENTS_ICON} label="Clients" count={clientCount ?? undefined} end />
        {clientId ? (
          <>
            <NavItem to={`/clients/${clientId}/dashboard`} icon={DASHBOARD_ICON} label="Dashboard" />
            <NavItem
              to={`/clients/${clientId}/holdings`}
              icon={HOLDINGS_ICON}
              label="Client holdings"
              count={client?.holdings.length}
            />
            <NavItem to={`/clients/${clientId}/reports`} icon={REPORTS_ICON} label="Reports" count={reportCount ?? undefined} />
          </>
        ) : (
          <>
            <NavItem to="" icon={DASHBOARD_ICON} label="Dashboard" disabledReason="Select a client first" />
            <NavItem to="" icon={HOLDINGS_ICON} label="Client holdings" disabledReason="Select a client first" />
            <NavItem to="" icon={REPORTS_ICON} label="Reports" disabledReason="Select a client first" />
          </>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel withTopBorder>Reference</SectionLabel>
        <NavItem to="/explanations" icon={EXPLANATIONS_ICON} label="Explanations" />
      </div>

      <div className="flex flex-col gap-2">
        <div className="px-2 text-[12px] font-medium tracking-[0.07em] text-muted-3 uppercase">Data source</div>
        {/* Real, reopenable file when one was actually uploaded (see
            backend's POST /clients/{id}/holdings/upload, which now persists
            the original bytes) — a manually-entered or empty client has no
            such file, so it stays a plain, non-interactive summary. */}
        {client?.original_filename ? (
          <a
            href={getHoldingsSourceFileUrl(client.id)}
            target="_blank"
            rel="noreferrer"
            title="Open the original uploaded file"
            className="flex items-center gap-[7px] rounded-md border border-dashed border-border px-[9px] py-2"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-positive">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="m9 15 2 2 4-4" />
            </svg>
            <div className="flex min-w-0 flex-col leading-[1.3]">
              <span className="truncate font-mono text-[11px] font-medium text-muted-foreground">{client.original_filename}</span>
              <span className="text-[11px] font-normal text-muted-3">
                Imported {importedLabel} · {client.holdings.length} positions
              </span>
            </div>
          </a>
        ) : (
          <div className="flex items-center gap-[7px] rounded-md border border-dashed border-border px-[9px] py-2">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-positive">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="m9 15 2 2 4-4" />
            </svg>
            <div className="flex min-w-0 flex-col leading-[1.3]">
              <span className="truncate font-mono text-[11px] font-medium text-muted-foreground">
                {client?.holdings_source === "manual" ? "Entered manually" : "Portfolio data"}
              </span>
              <span className="text-[11px] font-normal text-muted-3">
                {!clientId
                  ? "No client selected"
                  : client
                    ? client.holdings.length > 0
                      ? `${client.holdings.length} position${client.holdings.length === 1 ? "" : "s"} · no file on record`
                      : "No holdings on file yet"
                    : "Loading…"}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center gap-[6px] rounded-[7px] bg-muted px-2 py-[6px] text-[12px] font-medium tracking-[0.02em] text-muted-3">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" />
          Demo &middot; fictional client data
        </div>
        <div className="flex items-center gap-[9px] rounded-[7px] px-[9px] py-[7px] text-[12.5px] text-muted-foreground">
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
            NC
          </div>
          NAVEEN C, Financial Advisor
        </div>
      </div>
    </aside>
  )
}
