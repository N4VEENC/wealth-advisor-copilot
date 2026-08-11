import type { Currency } from "@/components/providers/currency-provider"

// JPY has no minor unit (no decimal places in normal use) — USD/EUR/GBP/INR
// all use 2. Intl already knows this per-currency default when you DON'T
// override fraction digits; forcing minimumFractionDigits:2 unconditionally
// (the previous bug here) produced "¥1,234.00", which no one writing yen
// actually does. formatCurrency's own maximumFractionDigits:0 is a
// deliberate whole-number headline style, not this bug — that one already
// happens to be correct for JPY too, so it's untouched.
const HAS_MINOR_UNIT: Record<Currency, boolean> = {
  USD: true,
  EUR: true,
  GBP: true,
  INR: true,
  JPY: false,
}

/**
 * Real currency conversion + display formatting, in one step: every dollar
 * figure in this app is computed in USD by the deterministic backend, and
 * `rate` (USD -> `currency`, from services/exchange_rate_service.py via
 * CurrencyProvider) converts it before formatting. `amount` is ALWAYS the
 * original USD figure — never pre-converted by a caller — so this is the
 * one place the multiplication happens, matching every other figure's path.
 */
export function formatCurrency(amount: number, currency: Currency, rate: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount * rate)
}

/** Cent-precise currency formatting — for figures where rounding to whole
 * units would misrepresent an exact computed amount (e.g. a realized
 * capital gain), unlike the whole-unit headline figures formatCurrency is
 * used for elsewhere. Never forces 2 decimals for JPY (see HAS_MINOR_UNIT). */
export function formatCurrencyPrecise(amount: number, currency: Currency, rate: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    ...(HAS_MINOR_UNIT[currency] ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}),
  }).format(amount * rate)
}

/** Compact form for headline totals (e.g. "$2.40M") — mockup shows 2
 * decimal places even in compact notation, unlike the browser default.
 * Never forces 2 decimals for JPY (see HAS_MINOR_UNIT). */
export function formatCompactCurrency(amount: number, currency: Currency, rate: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    notation: "compact",
    ...(HAS_MINOR_UNIT[currency] ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}),
  }).format(amount * rate)
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

export function formatSignedPercent(fraction: number, digits = 1): string {
  const value = fraction * 100
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(digits)}%`
}

/** Drift is measured in percentage points, not percent — the mockup labels
 * these "pp" (e.g. "+5.0pp"), consistent with the header's own drift badge. */
export function formatSignedPercentagePoints(fraction: number, digits = 1): string {
  const value = fraction * 100
  const sign = value > 0 ? "+" : value < 0 ? "−" : ""
  return `${sign}${Math.abs(value).toFixed(digits)}pp`
}

export function formatSignedCurrency(amount: number, currency: Currency, rate: number): string {
  const sign = amount > 0 ? "+" : ""
  return `${sign}${formatCurrency(amount, currency, rate)}`
}

// Matches a USD-formatted dollar mention as written by either the
// deterministic backend (recommendation_matcher.py's f"${x:,.2f}" notes) or
// Gemini's prose (it's only ever given USD figures, so it only ever writes
// USD-style mentions: "$1,234.56", "$1,234", "-$67.12"). Requires the "$" so
// it can never mistake a bare number or a percentage for a dollar figure.
const USD_MENTION_PATTERN = /-?\$[\d,]+(?:\.\d+)?/g

/**
 * Rewrites every embedded USD dollar mention in already-generated text (a
 * deterministic trade note, or Gemini's narrative/Cards prose — both are
 * always written against raw USD figures, see gemini_client.py) into the
 * selected display currency. This is the deliberate alternative to
 * re-generating that text per currency: Gemini is never called again just
 * because the advisor switched currencies (it has a scarce daily free-tier
 * quota, and the switch must be instant, not a network round-trip), and a
 * deterministic note was never AI text to begin with. Every number Gemini
 * or the backend already decided to mention is preserved exactly — this
 * only ever reformats a number already present in the text, never invents
 * or drops one.
 */
export function convertCurrencyMentionsInText(text: string, currency: Currency, rate: number): string {
  if (currency === "USD") return text
  return text.replace(USD_MENTION_PATTERN, (match) => {
    const negative = match.startsWith("-")
    const numeric = Number(match.replace(/[-$,]/g, ""))
    if (Number.isNaN(numeric)) return match
    const hasDecimals = match.includes(".")
    const converted = (negative ? -numeric : numeric) * rate
    return hasDecimals ? formatCurrencyPrecise(converted, currency, 1) : formatCurrency(converted, currency, 1)
  })
}
