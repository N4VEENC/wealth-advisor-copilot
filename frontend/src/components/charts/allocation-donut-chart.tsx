import type { AllocationBuckets } from "@/lib/api"

/**
 * Concentric donut — pixel-matched to the mockup's "Allocation vs. target"
 * card (extracted via getComputedStyle/outerHTML from the live mockup).
 * Outer ring (r58, stroke 19): current allocation, 3 full segments.
 * Inner ring (r41, stroke 6): target allocation — only equities (full
 * opacity) and fixed_income (60% opacity) are drawn; cash's target segment
 * is left as an implicit gap in the mockup's own markup, not a 3rd arc.
 */
const BUCKET_ORDER: (keyof AllocationBuckets)[] = ["equities", "fixed_income", "cash"]
const BUCKET_LABEL: Record<keyof AllocationBuckets, string> = {
  equities: "Equities",
  fixed_income: "Fixed income",
  cash: "Cash",
}
// Literal colors from the mockup: equities uses the brand primary, fixed
// income is a 42%-mixed tint of that same primary (not a separate hue), and
// cash uses the muted tertiary text color — not our old generic chart-1/2/5.
const BUCKET_COLOR: Record<keyof AllocationBuckets, string> = {
  equities: "var(--primary)",
  fixed_income: "color-mix(in oklab, var(--primary) 42%, var(--card))",
  cash: "var(--muted-3)",
}

const OUTER_RADIUS = 58
const OUTER_STROKE = 19
const INNER_RADIUS = 41
const INNER_STROKE = 6

function currentAllocationRing(allocation: AllocationBuckets) {
  const circumference = 2 * Math.PI * OUTER_RADIUS
  let cumulative = 0

  return BUCKET_ORDER.map((bucket) => {
    const length = allocation[bucket] * circumference
    const el = (
      <circle
        key={bucket}
        cx={75}
        cy={75}
        r={OUTER_RADIUS}
        fill="none"
        stroke={BUCKET_COLOR[bucket]}
        strokeWidth={OUTER_STROKE}
        strokeDasharray={`${length} ${circumference - length}`}
        strokeDashoffset={cumulative === 0 ? undefined : -cumulative}
      />
    )
    cumulative += length
    return el
  })
}

// Only equities + fixed_income are drawn (grid-colored, distinguished by
// opacity) — cash's target share is left as an implicit gap, matching the
// mockup's own markup exactly (it never draws a 3rd inner-ring arc).
function targetBandRing(allocation: AllocationBuckets) {
  const circumference = 2 * Math.PI * INNER_RADIUS
  let cumulative = 0

  return (["equities", "fixed_income"] as const).map((bucket, i) => {
    const length = allocation[bucket] * circumference
    const el = (
      <circle
        key={bucket}
        cx={75}
        cy={75}
        r={INNER_RADIUS}
        fill="none"
        stroke="var(--grid-line)"
        strokeWidth={INNER_STROKE}
        strokeDasharray={`${length} ${circumference - length}`}
        strokeDashoffset={cumulative === 0 ? undefined : -cumulative}
        opacity={i === 1 ? 0.6 : undefined}
      />
    )
    cumulative += length
    return el
  })
}

type AllocationDonutChartProps = {
  current: AllocationBuckets
  target: AllocationBuckets
}

export function AllocationDonutChart({ current, target }: AllocationDonutChartProps) {
  const currentLabel = BUCKET_ORDER.map((b) => Math.round(current[b] * 100)).join(" / ")
  const targetLabel = BUCKET_ORDER.map((b) => Math.round(target[b] * 100)).join(" / ")

  return (
    <svg
      width="100%"
      height="164"
      viewBox="0 0 150 150"
      preserveAspectRatio="xMidYMid meet"
      style={{ maxWidth: 164 }}
      role="img"
      aria-label={`Current allocation ${currentLabel}, target ${targetLabel}`}
    >
      <g transform="rotate(-90 75 75)">
        {currentAllocationRing(current)}
        {targetBandRing(target)}
      </g>
      <text x="75" y="72" textAnchor="middle" fill="var(--foreground)" fontFamily="IBM Plex Sans, sans-serif" fontSize={20} fontWeight={600} letterSpacing="-0.02em">
        {currentLabel}
      </text>
      <text x="75" y="88" textAnchor="middle" fill="var(--muted-3)" fontFamily="IBM Plex Sans, sans-serif" fontSize={11}>
        target {targetLabel}
      </text>
    </svg>
  )
}

export { BUCKET_ORDER, BUCKET_LABEL, BUCKET_COLOR }
