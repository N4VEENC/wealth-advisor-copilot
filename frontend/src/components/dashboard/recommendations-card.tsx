import { useState } from "react"

import { NarrativeText } from "@/components/dashboard/narrative-text"
import { useCurrency } from "@/components/providers/currency-provider"
import {
  postStructuredInsights,
  putTradeDecision,
  type InsightCard,
  type TaxDetail,
  type InsightsResponse,
  type TradeRecommendation,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type RowState = "pending" | "accepted" | "dismissed"
type Tab = "cards" | "briefing"

const SEVERITY_STYLE: Record<InsightCard["severity"], string> = {
  high: "bg-secondary/16 text-secondary",
  medium: "bg-accent text-accent-foreground",
  low: "bg-muted text-muted-3",
}

/** Builds the "long-term gain $X and short-term gain $Y" phrase straight
 * from the structured tax_detail object — not by re-parsing the note
 * string, so both figures always come through even though the note can
 * now mention two dollar amounts. `formatCurrencyPrecise` is always the
 * useCurrency()-bound one — never lib/format.ts's raw function — so this
 * phrase converts along with everything else. */
function buildGainPhrase(taxDetail: TaxDetail, formatCurrencyPrecise: (usdAmount: number) => string): string | null {
  const parts: string[] = []
  if (taxDetail.long_term_gain) parts.push(`long-term gain ${formatCurrencyPrecise(taxDetail.long_term_gain)}`)
  if (taxDetail.short_term_gain) parts.push(`short-term gain ${formatCurrencyPrecise(taxDetail.short_term_gain)}`)
  return parts.length > 0 ? parts.join(" and ") : null
}

function buildTradeAriaLabel(
  actionWord: "Accept" | "Dismiss",
  rec: TradeRecommendation,
  formatCurrencyPrecise: (usdAmount: number) => string
): string {
  const verb = rec.action === "SELL" ? "sell" : "buy"
  const gainPhrase = rec.action === "SELL" && rec.tax_detail ? buildGainPhrase(rec.tax_detail, formatCurrencyPrecise) : null
  return `${actionWord}: ${verb} ${rec.quantity} shares of ${rec.ticker} in ${rec.account_type}${
    gainPhrase ? `, estimated ${gainPhrase}` : ""
  }`
}

function SparkleIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  )
}

function TradeRow({
  rec,
  state,
  onAccept,
  onDismiss,
}: {
  rec: TradeRecommendation
  state: RowState
  onAccept: () => void
  onDismiss: () => void
}) {
  const isSell = rec.action === "SELL"
  const { formatCurrencyPrecise, convertMentionsInText } = useCurrency()
  const gainPhrase = isSell && rec.tax_detail ? buildGainPhrase(rec.tax_detail, formatCurrencyPrecise) : null

  return (
    <div
      className={cn(
        "flex items-center gap-[11px] rounded-[9px] border border-border p-[10px_12px] transition-all duration-200 ease-out",
        state === "dismissed" ? "bg-muted opacity-55" : state === "accepted" ? "bg-accent" : "bg-card"
      )}
    >
      <span
        className={cn(
          "shrink-0 rounded-[5px] px-[7px] py-[3px] font-mono text-[11px] font-semibold tracking-[0.06em]",
          isSell ? "bg-destructive/15 text-destructive" : "bg-positive/15 text-positive"
        )}
      >
        {rec.action}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-[7px]">
          <span className="font-mono text-[12.5px] font-semibold text-foreground">{rec.ticker}</span>
          <span className="font-mono text-[11.5px] text-muted-foreground">{rec.quantity} sh</span>
          <span className="font-mono text-[12px] font-medium text-foreground">
            {formatCurrencyPrecise(rec.dollar_amount).replace(/\.00$/, "")}
          </span>
          <span className="rounded-[5px] border border-border px-1.5 py-px text-[11px] text-muted-3">
            {rec.account_type}
          </span>
        </div>
        <span className="text-[11px] text-muted-3">
          {gainPhrase ? `Est. ${gainPhrase}` : convertMentionsInText(rec.note)}
        </span>
      </div>
      {state === "pending" ? (
        <div className="flex shrink-0 gap-[7px]">
          <button
            type="button"
            aria-label={buildTradeAriaLabel("Dismiss", rec, formatCurrencyPrecise)}
            onClick={onDismiss}
            className="cursor-pointer rounded-[7px] border border-border bg-card px-2.5 py-[5px] text-[11.5px] font-medium text-muted-foreground transition-transform duration-150 ease-out hover:scale-[1.03] active:scale-[0.97]"
          >
            Dismiss
          </button>
          <button
            type="button"
            aria-label={buildTradeAriaLabel("Accept", rec, formatCurrencyPrecise)}
            onClick={onAccept}
            className="cursor-pointer rounded-[7px] border border-primary bg-primary px-[11px] py-[5px] text-[11.5px] font-medium text-primary-foreground transition-transform duration-150 ease-out hover:scale-[1.03] active:scale-[0.97]"
          >
            Accept
          </button>
        </div>
      ) : (
        <span className={cn("shrink-0 text-[11.5px] font-medium", state === "accepted" ? "text-primary" : "text-muted-3")}>
          {state === "accepted" ? "Staged to blotter" : "Dismissed"}
        </span>
      )}
    </div>
  )
}

function InsightCardRow({ card, convertMentionsInText }: { card: InsightCard; convertMentionsInText: (text: string) => string }) {
  return (
    <div className="flex flex-col gap-[7px] rounded-[10px] border border-border bg-background p-[13px_14px]">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "shrink-0 rounded-[5px] px-[7px] py-[2px] font-mono text-[11px] font-semibold tracking-[0.05em]",
            SEVERITY_STYLE[card.severity]
          )}
        >
          {card.severity === "medium" ? "MED" : card.severity.toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] font-medium text-foreground">{convertMentionsInText(card.title)}</span>
      </div>
      <p className="m-0 text-[12.5px] leading-[1.55] text-muted-foreground">{convertMentionsInText(card.description)}</p>
      <div className="flex flex-wrap items-center gap-2">
        {card.tag && (
          <span className="rounded-[5px] bg-accent px-[7px] py-[3px] font-mono text-[12px] text-accent-foreground">
            {card.tag}
          </span>
        )}
        <span className="text-[12px] text-muted-3">{card.source_label}</span>
        {!card.ai_generated && <span className="text-[12px] text-muted-3">&middot; unnarrated (AI unavailable)</span>}
      </div>
    </div>
  )
}

export function RecommendationsCard({ insights }: { insights: InsightsResponse }) {
  // Seeded from the advisor's real persisted decision (see PUT
  // /clients/{id}/trade-decisions) rather than always starting blank — a
  // page reload must not silently forget a real Accept/Dismiss choice.
  const [rowStates, setRowStates] = useState<Record<number, RowState>>(() =>
    Object.fromEntries(insights.recommendations.map((rec, i) => [i, rec.decision]))
  )
  const [activeTab, setActiveTab] = useState<Tab>("briefing")
  const [cards, setCards] = useState<InsightCard[] | null>(null)
  const [cardsLoading, setCardsLoading] = useState(false)
  const [cardsError, setCardsError] = useState<string | null>(null)
  const { formatCurrencyPrecise, convertMentionsInText } = useCurrency()

  function handleDecision(index: number, rec: TradeRecommendation, decision: RowState) {
    setRowStates({ ...rowStates, [index]: decision })
    // Best-effort: the UI already reflects the choice optimistically: a
    // failed save here just means it won't survive a reload, not that the
    // click silently did nothing.
    putTradeDecision(insights.client_id, rec.ticker, rec.action, decision).catch(() => {})
  }

  function handleTabClick(tab: Tab) {
    setActiveTab(tab)
    if (tab === "cards" && cards === null && !cardsLoading) {
      setCardsLoading(true)
      postStructuredInsights(insights.client_id)
        .then((res) => setCards(res.cards))
        .catch(() => setCardsError("Could not load structured insights."))
        .finally(() => setCardsLoading(false))
    }
  }

  const acceptedCount = Object.values(rowStates).filter((s) => s === "accepted").length
  const total = insights.recommendations.length
  const totalDollar = insights.recommendations.reduce((sum, r) => sum + r.dollar_amount, 0)
  const acceptedDollar = insights.recommendations.reduce(
    (sum, r, i) => (rowStates[i] === "accepted" ? sum + r.dollar_amount : sum),
    0
  )
  const tradesMeta =
    acceptedCount > 0
      ? `${acceptedCount} of ${total} staged · ${formatCurrencyPrecise(acceptedDollar).replace(/\.00$/, "")} to rebalance`
      : `${total} trade${total === 1 ? "" : "s"} · ${formatCurrencyPrecise(totalDollar).replace(/\.00$/, "")} total`

  return (
    <div className="flex flex-col rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3 border-b border-border p-[16px_18px_12px]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <SparkleIcon />
            <span className="text-[13px] font-medium text-foreground">AI recommendations</span>
          </div>
          <span className="text-[11.5px] text-muted-3">
            Language model explains; all figures computed by the optimizer
          </span>
        </div>
        <div className="ml-auto flex shrink-0 gap-0.5 rounded-md bg-muted p-[3px]">
          {(["cards", "briefing"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabClick(tab)}
              className={cn(
                "h-6 cursor-pointer rounded-[6px] px-2.5 text-[11.5px] font-medium capitalize",
                activeTab === tab ? "bg-card text-primary shadow-[var(--shadow-card)]" : "bg-transparent text-muted-3"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 p-[16px_18px_18px]">
        {activeTab === "briefing" && (
          <>
            <div className="flex gap-[11px]">
              <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-accent text-[11px] font-semibold text-accent-foreground">
                AI
              </div>
              <div className="min-w-0 flex-1">
                {insights.narrative ? (
                  <NarrativeText text={convertMentionsInText(insights.narrative)} />
                ) : (
                  <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Insights unavailable, please retry. The trade suggestions below are unaffected — they come from
                    the deterministic optimizer, not the language model.
                  </p>
                )}
              </div>
            </div>
            {insights.narrative && (
              <div className="flex items-center gap-2 border-t border-border pt-[11px] text-[12px] text-muted-3">
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16v-5M12 8h.01" />
                </svg>
                Narrative generated from optimizer output. No figure in this text was produced by the model.
              </div>
            )}
          </>
        )}

        {activeTab === "cards" && (
          <div className="flex flex-col gap-2.5">
            {cardsLoading && <p className="text-xs text-muted-foreground">Loading structured insights&hellip;</p>}
            {cardsError && <p className="text-xs text-destructive">{cardsError}</p>}
            {cards && cards.length === 0 && (
              <p className="text-xs text-muted-foreground">No flagged insights right now.</p>
            )}
            {cards?.map((card) => (
              <InsightCardRow key={card.id} card={card} convertMentionsInText={convertMentionsInText} />
            ))}
          </div>
        )}

        {total > 0 && (
          <div className="flex flex-col gap-2.5 border-t border-border pt-3.5">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-medium text-foreground">Suggested rebalancing trades</span>
              <span className="text-[11px] text-muted-3">{tradesMeta}</span>
            </div>
            {insights.recommendations.map((rec, index) => (
              <TradeRow
                key={`${rec.ticker}-${rec.action}-${index}`}
                rec={rec}
                state={rowStates[index] ?? "pending"}
                onAccept={() => handleDecision(index, rec, "accepted")}
                onDismiss={() => handleDecision(index, rec, "dismissed")}
              />
            ))}
            <div className="flex items-center gap-[7px] rounded-md border border-dashed border-border px-2.5 py-2 text-[12px] text-muted-3">
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              Nothing is traded or sent to the client without your explicit approval. Accepted trades stage to the
              blotter for sign-off.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
