import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { getExchangeRates } from "@/lib/api"
import {
  convertCurrencyMentionsInText,
  formatCompactCurrency,
  formatCurrency,
  formatCurrencyPrecise,
  formatSignedCurrency,
} from "@/lib/format"

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY"] as const
export type Currency = (typeof CURRENCIES)[number]

/** Symbol + full name per currency — matches the mockup's currency dropdown
 * exactly (it lists these five, in this order, each with its own symbol). */
export const CURRENCY_INFO: Record<Currency, { symbol: string; name: string }> = {
  USD: { symbol: "$", name: "US dollar" },
  EUR: { symbol: "€", name: "Euro" },
  GBP: { symbol: "£", name: "Pound sterling" },
  INR: { symbol: "₹", name: "Indian rupee" },
  JPY: { symbol: "¥", name: "Japanese yen" },
}

// Identity rates (1 USD = 1 of everything) used only for the brief window
// before the real rates have loaded, or if they never do — every figure
// still renders correctly labeled as USD-equivalent rather than blocking
// the whole app on a network call, matching this app's "never block on an
// external call" pattern used for market data and the AI elsewhere.
const IDENTITY_RATES: Record<Currency, number> = { USD: 1, EUR: 1, GBP: 1, INR: 1, JPY: 1 }

type CurrencyContextValue = {
  currency: Currency
  setCurrency: (currency: Currency) => void
  /** "live" | "cached-fresh" | "cached-stale" | "fallback" | "loading" —
   * see backend/services/exchange_rate_service.py for what each means. */
  ratesSource: string
  /** Every dollar-displaying component MUST go through these — never
   * lib/format.ts's raw functions directly, and never its own
   * Intl.NumberFormat/string interpolation — so a real conversion can never
   * be missed in one spot while applied everywhere else. Each takes the
   * ORIGINAL USD amount; the rate multiplication happens inside. */
  formatCurrency: (usdAmount: number) => string
  formatCurrencyPrecise: (usdAmount: number) => string
  formatCompactCurrency: (usdAmount: number) => string
  formatSignedCurrency: (usdAmount: number) => string
  /** For already-generated prose (AI narrative/Cards text, or a
   * deterministic trade note) that embeds "$1,234.56"-style USD mentions
   * directly in the string — see lib/format.ts's
   * convertCurrencyMentionsInText for why this rewrites rather than
   * re-generates. */
  convertMentionsInText: (text: string) => string
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined)

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("USD")
  const [rates, setRates] = useState<Record<Currency, number>>(IDENTITY_RATES)
  const [ratesSource, setRatesSource] = useState("loading")

  useEffect(() => {
    let cancelled = false
    getExchangeRates()
      .then((res) => {
        if (cancelled) return
        setRates({ ...IDENTITY_RATES, ...res.rates } as Record<Currency, number>)
        setRatesSource(res.source)
      })
      .catch(() => {
        // Real exchange rates unavailable at all (network down, backend
        // down) — fall back to identity rather than leaving every dollar
        // figure blank; still clearly labeled via ratesSource so a
        // component COULD surface it, same graceful-degradation spirit as
        // a missing AI narrative elsewhere in this app.
        if (!cancelled) setRatesSource("unavailable")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rate = rates[currency] ?? 1

  const value: CurrencyContextValue = {
    currency,
    setCurrency,
    ratesSource,
    formatCurrency: (usdAmount) => formatCurrency(usdAmount, currency, rate),
    formatCurrencyPrecise: (usdAmount) => formatCurrencyPrecise(usdAmount, currency, rate),
    formatCompactCurrency: (usdAmount) => formatCompactCurrency(usdAmount, currency, rate),
    formatSignedCurrency: (usdAmount) => formatSignedCurrency(usdAmount, currency, rate),
    convertMentionsInText: (text) => convertCurrencyMentionsInText(text, currency, rate),
  }

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  const context = useContext(CurrencyContext)
  if (!context) throw new Error("useCurrency must be used within a CurrencyProvider")
  return context
}
