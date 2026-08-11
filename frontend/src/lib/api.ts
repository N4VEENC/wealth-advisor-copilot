// Falls back to the project's standardized local dev port (see README) only
// if VITE_API_BASE_URL is somehow entirely unset — every real setup should
// have it defined via frontend/.env (copied from .env.example).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8010"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body.detail ?? detail
    } catch {
      // response body wasn't JSON — fall back to statusText
    }
    throw new ApiError(response.status, detail)
  }

  return response.json() as Promise<T>
}

export type AllocationBuckets = {
  equities: number
  fixed_income: number
  cash: number
}

export type AnalysisResponse = {
  client_id: string
  market_data_source: string
  as_of: string
  current_allocation: AllocationBuckets
  target_allocation: AllocationBuckets
  drift: AllocationBuckets
  diversification_score: number
  health_score: number
  health_score_components: { allocation_drift: number; concentration: number }
  total_portfolio_value: number
  position_values: Record<string, number>
  total_cost_basis: number
  total_return_dollar: number
  total_return_pct: number
  value_by_account_type: Record<string, number>
}

export type TaxLot = {
  quantity: number
  cost_basis_per_share: number
  purchase_date: string | null
  term: "long_term" | "short_term"
  gain: number
}

export type TaxDetail = {
  long_term_gain: number
  short_term_gain: number
  lots: TaxLot[]
}

export type TradeDecision = "accepted" | "dismissed" | "pending"

export type TradeRecommendation = {
  ticker: string
  action: "BUY" | "SELL"
  quantity: number
  account_type: string
  dollar_amount: number
  note: string
  tax_detail: TaxDetail | null
  // The advisor's persisted Accept/Dismiss choice (see PUT
  // /clients/{id}/trade-decisions) — "pending" if never decided.
  decision: TradeDecision
}

export type InsightsResponse = {
  client_id: string
  market_data_source: string
  as_of: string
  analysis: Omit<AnalysisResponse, "client_id" | "market_data_source" | "as_of">
  recommendations: TradeRecommendation[]
  // Null when the AI narration call failed (e.g. rate limit) — the
  // deterministic recommendations above are still valid and shown
  // regardless; only the narrative is missing. See App Flow doc's AI
  // error state.
  narrative: string | null
  narrative_error: string | null
}

export type ProjectionPoint = {
  year: number
  current_trajectory: number
  target_trajectory: number
}

export type ProjectionResponse = {
  client_id: string
  market_data_source: string
  path_count: number
  goal_year: number
  goal_amount: number
  // "advisor_provided" when the client has a real target_retirement_amount
  // set — services/projection.py's resolve_goal_amount() is the single
  // source of truth for this; every consumer of goal_amount gets this flag
  // alongside it rather than re-deriving whether the number is real or
  // estimated.
  goal_amount_source: "advisor_provided" | "estimated"
  probability_of_reaching_goal: number
  probability_of_reaching_goal_current: number
  annualized_volatility_current: number
  annualized_volatility_target: number
  annual_contribution: number
  projection_chart_data: ProjectionPoint[]
}

export type SectorBucket = { value: number; pct_of_portfolio: number }

export type SectorExposureResponse = {
  client_id: string
  market_data_source: string
  total_portfolio_value: number
  equity_sectors: Record<string, SectorBucket>
  non_equity: Record<string, SectorBucket>
  look_through_note: string
}

export type ComplianceFlag = {
  id: string
  severity: "high" | "medium" | "low"
  category: string
  message: string
  // The AI's plain-language explanation of this flag's own real numbers
  // (services/groq_client.py's narrate_compliance_flags) — null for the
  // 2 fixed disclosure lines (never narrated) and whenever the AI itself
  // is unavailable, in which case `message` is still shown on its own.
  narrative: string | null
}

export type ComplianceResponse = {
  client_id: string
  market_data_source: string
  flags: ComplianceFlag[]
}

export type ClientSummary = {
  id: string
  name: string
  risk_profile: string
  goal_year: number
  email: string | null
  age: number | null
  // Advisor-entered descriptive label (e.g. "Taxable + 401(k)") shown only
  // until real holdings exist — once they do, the real account types
  // derived from holdings take over everywhere else in the app.
  accounts_note: string | null
  holdings_source: "upload" | "manual" | null
  uploaded_at: string
  has_holdings: boolean
  holdings_count: number
  // Real corpus/return, computed from each holding's last stored live
  // price (not a fresh fetch) — see backend services/holdings.summarize_for_list.
  // Both are null (never 0) for a client with no holdings yet — there is
  // no real portfolio to summarize, so the table shows the empty state.
  corpus: number | null
  return_pct: number | null
}

export type ClientRecord = {
  id: string
  name: string
  email: string | null
  age: number | null
  risk_profile: string
  goal_year: number
  annual_contribution: number
  holdings: Array<{ ticker: string; account_type: string }>
  cash_balance: number
  cash_account_type: string
  target_allocation: AllocationBuckets
  accounts_note: string | null
  // Real, advisor-provided retirement goal dollar amount — null means no
  // real goal is set, in which case every consumer falls back to the
  // derived-compounding estimate (see services/projection.resolve_goal_amount).
  target_retirement_amount: number | null
  notes: string | null
  holdings_source: "upload" | "manual" | null
  original_filename: string | null
  uploaded_at: string
}

// All fields optional except ai_narrative/disclosures — report-0001.json (an
// early Phase-7 test fixture) predates several of these being added to the
// report content schema, so real stored reports can genuinely lack them.
export type ReportContent = {
  total_portfolio_value?: number
  total_cost_basis?: number
  total_return_dollar?: number
  total_return_pct?: number
  value_by_account_type?: Record<string, number>
  scores?: { diversification: number; health: number }
  allocation?: { current: AllocationBuckets; target: AllocationBuckets }
  projection_chart_data?: ProjectionPoint[]
  monte_carlo?: {
    path_count: number
    goal_amount: number
    goal_amount_source?: "advisor_provided" | "estimated"
    probability_of_reaching_goal: number
  }
  recommended_trades?: TradeRecommendation[]
  compliance_flags?: ComplianceFlag[]
  ai_narrative: string | null
  disclosures: string[]
  // Only present when the advisor explicitly attached flagged Exploratory
  // notes at generation time (see postGenerateReport) — absent, not an
  // empty array, for the vast majority of reports that never used this.
  advisor_notes?: AdvisorNote[]
}

export type AdvisorNote = {
  id: string
  content: string
  created_at: string
  flagged_at: string
  // The user question that prompted this Exploratory answer, if the
  // conversation had one immediately before it.
  prompted_by: string | null
  // Frozen verbatim from the backend at report-generation time — render
  // this string as-is rather than hardcoding an equivalent one, so the
  // report always shows exactly the disclosure that existed when it was
  // generated.
  label: string
}

export type ReportSummary = {
  id: string
  client_id: string
  generated_at: string
  status: "draft" | "approved"
  approved_at: string | null
  content: ReportContent
}

export type ScenarioBreakdownEntry = { before: number; after: number }

export type ScenarioResponse = {
  client_id: string
  market_data_source: string
  scenario_id: string
  scenario_label: string
  matched_input: string
  projected_total_value: number
  dollar_change: number
  percent_change: number
  breakdown: {
    equities: ScenarioBreakdownEntry
    fixed_income: ScenarioBreakdownEntry
    cash: ScenarioBreakdownEntry
  }
}

export function getAnalysis(clientId: string): Promise<AnalysisResponse> {
  return apiFetch(`/clients/${clientId}/analysis`)
}

export function postInsights(clientId: string): Promise<InsightsResponse> {
  return apiFetch(`/clients/${clientId}/insights`, { method: "POST" })
}

export type InsightCard = {
  id: string
  kind: string
  severity: "high" | "medium" | "low"
  tag: string | null
  source_label: string
  title: string
  description: string
  ai_generated: boolean
}

export type StructuredInsightsResponse = {
  client_id: string
  market_data_source: string
  cards: InsightCard[]
  insights_error: string | null
}

export function postStructuredInsights(clientId: string): Promise<StructuredInsightsResponse> {
  return apiFetch(`/clients/${clientId}/insights/cards`, { method: "POST" })
}

export function getProjection(clientId: string): Promise<ProjectionResponse> {
  return apiFetch(`/clients/${clientId}/projection`)
}

export function postScenario(clientId: string, scenario: string): Promise<ScenarioResponse> {
  return apiFetch(`/clients/${clientId}/scenario`, {
    method: "POST",
    body: JSON.stringify({ scenario }),
  })
}

export function getSectorExposure(clientId: string): Promise<SectorExposureResponse> {
  return apiFetch(`/clients/${clientId}/sector-exposure`)
}

export function getCompliance(clientId: string): Promise<ComplianceResponse> {
  return apiFetch(`/clients/${clientId}/compliance`)
}

export type ExchangeRatesResponse = {
  base: "USD"
  rates: Record<string, number>
  source: "live" | "live-frankfurter" | "cached-fresh" | "cached-stale" | "fallback"
  as_of: string | null
}

export function getExchangeRates(): Promise<ExchangeRatesResponse> {
  return apiFetch(`/exchange-rates`)
}

export type HoldingRow = {
  ticker: string | null
  name: string
  account_type: string
  quantity: number | null
  average_cost_basis_per_share: number | null
  cost_basis: number | null
  current_price: number | null
  market_value: number | null
  weight: number | null
  gain_dollar: number | null
  gain_pct: number | null
}

export type HoldingsResponse = {
  client_id: string
  market_data_source: string
  as_of: string
  rows: HoldingRow[]
  cash_row: HoldingRow | null
  total_positions: number
  total_portfolio_value: number
  total_cost_basis: number
  total_return_dollar: number
  total_return_pct: number
}

export function getHoldings(clientId: string): Promise<HoldingsResponse> {
  return apiFetch(`/clients/${clientId}/holdings`)
}

export function getClients(): Promise<{ clients: ClientSummary[] }> {
  return apiFetch(`/clients`)
}

export function getClient(clientId: string): Promise<ClientRecord> {
  return apiFetch(`/clients/${clientId}`)
}

export function postCreateClient(input: {
  name: string
  risk_profile: string
  goal_year: number
  email?: string
  age?: number
  accounts_note?: string
  target_retirement_amount?: number
  notes?: string
}): Promise<ClientRecord> {
  return apiFetch(`/clients`, { method: "POST", body: JSON.stringify(input) })
}

export function postAddManualHolding(
  clientId: string,
  input: {
    ticker: string
    quantity: number
    cost_basis_per_share: number
    account_type: string
    purchase_date?: string
  }
): Promise<ClientRecord> {
  return apiFetch(`/clients/${clientId}/holdings/manual`, { method: "POST", body: JSON.stringify(input) })
}

export function getHoldingsSourceFileUrl(clientId: string): string {
  return `${API_BASE_URL}/clients/${clientId}/holdings/source-file`
}

export type StrategyOption = {
  id: string
  label: string
  target_allocation: AllocationBuckets
  rebalancing_threshold_pct: number
  typical_holdings: string[]
}

export function getStrategies(): Promise<{ strategies: StrategyOption[] }> {
  return apiFetch(`/strategies`)
}

export function deleteClient(clientId: string, force = false): Promise<{ deleted: string; reports_deleted: number }> {
  return apiFetch(`/clients/${clientId}${force ? "?force=true" : ""}`, { method: "DELETE" })
}

// Not routed through apiFetch — a multipart upload must NOT set
// Content-Type: application/json (apiFetch's default), the browser needs to
// set its own multipart boundary header for FormData.
export async function postUploadHoldings(clientId: string, file: File): Promise<ClientRecord> {
  const formData = new FormData()
  formData.append("file", file)
  const response = await fetch(`${API_BASE_URL}/clients/${clientId}/holdings/upload`, {
    method: "POST",
    body: formData,
  })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body.detail ?? detail
    } catch {
      // response body wasn't JSON — fall back to statusText
    }
    throw new ApiError(response.status, detail)
  }
  return response.json()
}

export function getReports(clientId: string): Promise<{ reports: ReportSummary[] }> {
  return apiFetch(`/reports?client_id=${encodeURIComponent(clientId)}`)
}

// `flaggedMessageIds` is opt-in and empty by default — omitting it (or
// passing none) generates a report identical to before this ever existed;
// nothing here makes attaching notes a required step.
export function postGenerateReport(clientId: string, flaggedMessageIds: string[] = []): Promise<ReportSummary> {
  return apiFetch(`/clients/${clientId}/reports`, {
    method: "POST",
    body: JSON.stringify({ flagged_message_ids: flaggedMessageIds }),
  })
}

export function getReport(reportId: string): Promise<ReportSummary> {
  return apiFetch(`/reports/${reportId}`)
}

export function putApproveReport(reportId: string): Promise<ReportSummary> {
  return apiFetch(`/reports/${reportId}/approve`, { method: "PATCH" })
}

export type ChatMode = "verified" | "exploratory"

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  mode: ChatMode
  content: string
  // Human-readable source labels (e.g. "Scenario simulator") for an
  // assistant message in verified mode — empty for user messages, and
  // empty for a verified assistant message that answered without needing
  // a tool at all (the model said it had no verified way to answer).
  tools_used: string[]
  created_at: string
  flagged_for_report: boolean
  flagged_at: string | null
}

export type ChatStreamEvent =
  | { type: "user_message"; message: ChatMessage }
  | { type: "tool_call"; tool: string; tool_label: string }
  | { type: "tool_result"; tool: string; tool_label: string }
  | { type: "final"; message: ChatMessage }
  | { type: "error"; detail: string }

export function getChatHistory(clientId: string): Promise<{ client_id: string; messages: ChatMessage[] }> {
  return apiFetch(`/clients/${clientId}/chat-history`)
}

export function deleteChatHistory(clientId: string): Promise<{ client_id: string; cleared: boolean }> {
  return apiFetch(`/clients/${clientId}/chat-history`, { method: "DELETE" })
}

export function postFlagForReport(clientId: string, messageId: string): Promise<ChatMessage> {
  return apiFetch(`/clients/${clientId}/chat/${messageId}/flag-for-report`, { method: "POST" })
}

export type FlaggedMessage = {
  id: string
  content: string
  created_at: string
  flagged_at: string
  prompted_by: string | null
}

// Retrievable entirely on its own — has nothing to do with report
// generation, and works whether or not the client has ever had a report
// generated at all.
export function getFlaggedMessages(clientId: string): Promise<{ client_id: string; flagged_messages: FlaggedMessage[] }> {
  return apiFetch(`/clients/${clientId}/chat/flagged`)
}

// Not routed through apiFetch: the response body is newline-delimited JSON
// streamed as the backend's tool-calling loop progresses (see
// services/chat_service.py), not one parsed JSON object — apiFetch always
// awaits response.json() once, which would only ever see the first line.
export async function postChatMessage(
  clientId: string,
  message: string,
  mode: ChatMode,
  onEvent: (event: ChatStreamEvent) => void
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/clients/${clientId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, mode }),
  })

  if (!response.ok || !response.body) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body.detail ?? detail
    } catch {
      // response body wasn't JSON — fall back to statusText
    }
    throw new ApiError(response.status, detail)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as ChatStreamEvent)
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ChatStreamEvent)
}

export function putTradeDecision(
  clientId: string,
  ticker: string,
  action: "BUY" | "SELL",
  decision: TradeDecision
): Promise<{ client_id: string; trade_decisions: Record<string, string> }> {
  return apiFetch(`/clients/${clientId}/trade-decisions`, {
    method: "PUT",
    body: JSON.stringify({ ticker, action, decision }),
  })
}
