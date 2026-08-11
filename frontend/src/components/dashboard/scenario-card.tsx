import { useState, type FormEvent } from "react"

import {
  BUCKET_LABEL,
  BUCKET_ORDER,
} from "@/components/charts/allocation-donut-chart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCurrency } from "@/components/providers/currency-provider"
import { ApiError, postScenario, type ScenarioResponse } from "@/lib/api"
import { formatSignedPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

const PRESET_SCENARIOS = [
  { id: "rate_hike_100bps", label: "Rate hike +100bps" },
  { id: "recession", label: "Recession" },
  { id: "tech_selloff_25pct", label: "Tech selloff -25%" },
] as const

export function ScenarioCard({ clientId }: { clientId: string }) {
  const { formatCurrency, formatSignedCurrency } = useCurrency()
  const [inputText, setInputText] = useState("")
  const [result, setResult] = useState<ScenarioResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeScenario, setActiveScenario] = useState<string | null>(null)

  async function runScenario(scenario: string) {
    setLoading(true)
    setError(null)
    setActiveScenario(scenario)
    try {
      const response = await postScenario(clientId, scenario)
      setResult(response)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run the scenario.")
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (inputText.trim()) runScenario(inputText.trim())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scenario analysis</CardTitle>
        <CardDescription>Deterministic stress tests — numbers come from the simulator, not the AI.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {PRESET_SCENARIOS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => runScenario(preset.id)}
              aria-pressed={activeScenario === preset.id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                activeScenario === preset.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="scenario-text" className="sr-only">
              Describe a scenario to stress-test
            </Label>
            <Input
              id="scenario-text"
              placeholder="Describe a scenario to stress-test (e.g. what if rates go up)"
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!inputText.trim() || loading}>
            Run
          </Button>
        </form>

        {loading && <p className="text-xs text-muted-foreground">Running scenario&hellip;</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {result && !loading && (
          <div
            key={`${result.scenario_label}-${result.dollar_change}`}
            className="animate-flash-highlight rounded-lg border border-border bg-muted/40 p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{result.scenario_label}</span>
              <span
                className={cn(
                  "font-mono text-sm font-semibold",
                  result.dollar_change < 0 ? "text-destructive" : "text-primary"
                )}
              >
                {formatSignedCurrency(result.dollar_change)} ({formatSignedPercent(result.percent_change)})
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Projected total value:{" "}
              <span className="font-mono">{formatCurrency(result.projected_total_value)}</span>
            </p>
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-1 font-medium">Bucket</th>
                  <th className="pb-1 font-medium">Before</th>
                  <th className="pb-1 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {BUCKET_ORDER.map((bucket) => (
                  <tr key={bucket} className="border-t border-border">
                    <td className="py-1 pr-2">{BUCKET_LABEL[bucket]}</td>
                    <td className="py-1 pr-2 font-mono">{formatCurrency(result.breakdown[bucket].before)}</td>
                    <td className="py-1 font-mono">{formatCurrency(result.breakdown[bucket].after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
