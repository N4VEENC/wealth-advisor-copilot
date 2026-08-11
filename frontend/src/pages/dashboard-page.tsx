import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

import { AllocationCard } from "@/components/dashboard/allocation-card"
import { ChatPanel } from "@/components/dashboard/chat-panel"
import { ComplianceCard } from "@/components/dashboard/compliance-card"
import { ProjectionCard } from "@/components/dashboard/projection-card"
import { RecommendationsCard } from "@/components/dashboard/recommendations-card"
import { RetirementFundingCard } from "@/components/dashboard/retirement-funding-card"
import { ScenarioCard } from "@/components/dashboard/scenario-card"
import { TotalCorpusCard, TotalReturnsCard } from "@/components/dashboard/portfolio-summary-cards"
import { DiversificationRiskCard, InvestmentHealthCard } from "@/components/dashboard/scores-card"
import { SectorExposureCard } from "@/components/dashboard/sector-exposure-card"
import {
  ApiError,
  getAnalysis,
  getCompliance,
  getProjection,
  getSectorExposure,
  postInsights,
  type AnalysisResponse,
  type ComplianceResponse,
  type InsightsResponse,
  type ProjectionResponse,
  type SectorExposureResponse,
} from "@/lib/api"
import { LoadingLine } from "@/components/ui/loading-line"
import { FadeIn } from "@/components/ui/fade-in"

export function DashboardPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [insights, setInsights] = useState<InsightsResponse | null>(null)
  const [projection, setProjection] = useState<ProjectionResponse | null>(null)
  const [sectorExposure, setSectorExposure] = useState<SectorExposureResponse | null>(null)
  const [compliance, setCompliance] = useState<ComplianceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noHoldings, setNoHoldings] = useState(false)
  // Insights (AI narrative + recommendations) is fetched independently of
  // the deterministic calls below — a pure Gemini failure is already
  // tolerated inside postInsights itself (narrative comes back null,
  // RecommendationsCard shows its own "insights unavailable" message), but
  // a total fetch failure (network, market-data-inside-insights, etc.) must
  // still not take down the deterministic cards. See insightsError below.
  const [insightsError, setInsightsError] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setNoHoldings(false)
    setInsightsError(false)

    Promise.all([getAnalysis(clientId), getProjection(clientId), getSectorExposure(clientId), getCompliance(clientId)])
      .then(([analysisResponse, projectionResponse, sectorResponse, complianceResponse]) => {
        if (cancelled) return
        setAnalysis(analysisResponse)
        setProjection(projectionResponse)
        setSectorExposure(sectorResponse)
        setCompliance(complianceResponse)
      })
      .catch((err) => {
        if (cancelled) return
        // 422 here means the client has no holdings yet — that's the
        // documented empty state (App Flow doc), not a real error.
        if (err instanceof ApiError && err.status === 422) {
          setNoHoldings(true)
        } else if (err instanceof ApiError && err.status === 503) {
          setError("Market data temporarily unavailable — please retry shortly.")
        } else {
          setError(err instanceof ApiError ? err.message : "Could not load dashboard data.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    postInsights(clientId)
      .then((insightsResponse) => {
        if (cancelled) return
        setInsights(insightsResponse)
      })
      .catch(() => {
        if (cancelled) return
        setInsightsError(true)
      })

    return () => {
      cancelled = true
    }
  }, [clientId])

  return (
    <div className="space-y-6">
      {loading && <LoadingLine label="Loading portfolio data…" />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {noHoldings && (
        <div className="flex flex-col items-center gap-3 rounded-[12px] border border-border bg-card py-16 text-center shadow-[var(--shadow-card)]">
          <p className="text-sm text-muted-foreground">No portfolio data yet — upload holdings to see analysis.</p>
          <Link
            to={`/clients/${clientId}/holdings`}
            className="text-[12.5px] font-medium text-primary hover:underline"
          >
            Go to Holdings
          </Link>
        </div>
      )}

      {analysis?.market_data_source === "stale" && (
        <p className="rounded-md border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">
          Market data temporarily unavailable — showing last known prices.
        </p>
      )}

      {analysis && (
        <FadeIn>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(252px,1fr))] gap-4 [align-items:stretch]">
            <TotalCorpusCard analysis={analysis} />
            <TotalReturnsCard analysis={analysis} />
            <DiversificationRiskCard analysis={analysis} sectorExposure={sectorExposure} />
            <InvestmentHealthCard analysis={analysis} />
          </div>
        </FadeIn>
      )}

      {(analysis || sectorExposure) && (
        <FadeIn>
          <div className="grid grid-cols-2 items-stretch gap-4 max-[900px]:grid-cols-1">
            {analysis && <AllocationCard analysis={analysis} recommendations={insights?.recommendations ?? []} />}
            {sectorExposure && <SectorExposureCard exposure={sectorExposure} />}
          </div>
        </FadeIn>
      )}

      {projection && (
        <FadeIn>
          <ProjectionCard projection={projection} />
        </FadeIn>
      )}

      <div className="grid grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)] gap-4 items-start max-[900px]:grid-cols-1">
        {insights && (
          <FadeIn>
            <RecommendationsCard insights={insights} />
          </FadeIn>
        )}
        {!insights && insightsError && (
          <div className="rounded-[12px] border border-border bg-card p-4 text-xs text-muted-foreground">
            Insights unavailable, please retry. This only affects the AI recommendations panel — the scores and
            charts above are unaffected.
          </div>
        )}
        <div className="flex flex-col gap-4">
          <ScenarioCard clientId={clientId!} />
          {projection && (
            <FadeIn>
              <RetirementFundingCard projection={projection} />
            </FadeIn>
          )}
          {compliance && (
            <FadeIn>
              <ComplianceCard compliance={compliance} />
            </FadeIn>
          )}
        </div>
      </div>

      {clientId && <ChatPanel clientId={clientId} />}
    </div>
  )
}
