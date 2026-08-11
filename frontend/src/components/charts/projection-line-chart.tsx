import { useRef, useState } from "react"

import type { ProjectionPoint } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Dual-line Monte Carlo projection chart — pixel-matched to the mockup's
 * "Financial modeling" card (extracted via getComputedStyle/outerHTML from
 * the live mockup). viewBox and point x-spacing are the mockup's own literal
 * numbers; the y-domain/tick values are necessarily derived from our real
 * data (the mockup's $2.2M–$5.0M axis is specific to its fictional numbers).
 */
const VIEW_WIDTH = 780
const VIEW_HEIGHT = 240
const X_START = 74
const X_END = 762
const Y_TOP = 16
const Y_BOTTOM = 232
const GRIDLINE_YS = [16, 70, 124, 178, 232]

// The mockup's static export froze the hover tooltip mid-hover (at year
// 2032) rather than gating it behind live JS — its markup/styling (min-width
// 168px, 9px radius, box-shadow: var(--sh2), 9px/11px padding, translateX
// offset) was extracted verbatim from that frozen instance. The mockup had
// no example of the tooltip near the chart's left edge, so the flip-to-the-
// right behavior below is our own addition for real usability, not an
// extraction.
const TOOLTIP_FLIP_THRESHOLD_PX = 180

type ProjectionLineChartProps = {
  data: ProjectionPoint[]
  // Bound to the selected currency + live rate via useCurrency() — this
  // component must never format a dollar figure on its own (see
  // currency-provider.tsx). This used to hardcode a "$"-prefixed compact
  // formatter with no currency awareness at all, which is exactly the
  // hover-tooltip bug this prop fixes: axis labels and tooltip values now
  // convert and relabel correctly with everything else in the app.
  formatCompactCurrency: (usdAmount: number) => string
}

type HoverState = {
  index: number
  leftPct: number
  flipRight: boolean
}

export function ProjectionLineChart({ data, formatCompactCurrency }: ProjectionLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  if (data.length === 0) return null

  const n = data.length
  const xAt = (i: number) => X_START + (n === 1 ? 0 : (i * (X_END - X_START)) / (n - 1))

  const allValues = data.flatMap((d) => [d.current_trajectory, d.target_trajectory])
  const dataMin = Math.min(...allValues)
  const dataMax = Math.max(...allValues)
  // Pad the domain a bit above/below the real min/max so lines don't touch
  // the plot edges — the mockup's own axis has similar headroom.
  const domainMax = dataMax * 1.06
  const domainMin = Math.max(0, dataMin * 0.88)
  const yAt = (value: number) =>
    Y_BOTTOM - ((value - domainMin) / (domainMax - domainMin)) * (Y_BOTTOM - Y_TOP)

  const currentPoints = data.map((d, i) => [xAt(i), yAt(d.current_trajectory)] as const)
  const targetPoints = data.map((d, i) => [xAt(i), yAt(d.target_trajectory)] as const)

  const toPointsAttr = (pts: readonly (readonly [number, number])[]) =>
    pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")

  const areaPoints = [...targetPoints, ...[...currentPoints].reverse()]

  const yTickValues = GRIDLINE_YS.map((y) => domainMax - ((y - Y_TOP) / (Y_BOTTOM - Y_TOP)) * (domainMax - domainMin))

  const last = data[data.length - 1]

  function indexFromClientX(clientX: number): number {
    const rect = svgRef.current!.getBoundingClientRect()
    const relX = ((clientX - rect.left) / rect.width) * VIEW_WIDTH
    const step = (X_END - X_START) / (n - 1)
    return Math.max(0, Math.min(n - 1, Math.round((relX - X_START) / step)))
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect()
    const index = indexFromClientX(e.clientX)
    const xPx = (xAt(index) / VIEW_WIDTH) * rect.width
    setHover({ index, leftPct: (xAt(index) / VIEW_WIDTH) * 100, flipRight: xPx < TOOLTIP_FLIP_THRESHOLD_PX })
  }

  function handleMouseLeave() {
    setHover(null)
  }

  const hoverPoint = hover ? data[hover.index] : null
  const hoverDelta = hoverPoint ? hoverPoint.target_trajectory - hoverPoint.current_trajectory : 0

  return (
    <div className="relative mt-1.5 pb-[18px]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        width="100%"
        style={{ display: "block", overflow: "visible", height: "auto", cursor: "crosshair" }}
        role="img"
        aria-label={`Projected portfolio value from ${data[0].year} to ${last.year}: current allocation path reaches ${formatCompactCurrency(
          last.current_trajectory
        )}, target allocation path reaches ${formatCompactCurrency(last.target_trajectory)}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <g stroke="var(--grid-line)" strokeWidth={1}>
          {GRIDLINE_YS.map((y) => (
            <line key={y} x1={X_START} y1={y} x2={X_END} y2={y} />
          ))}
        </g>
        <polygon points={toPointsAttr(areaPoints)} fill="var(--primary)" opacity={0.07} />
        <polyline points={toPointsAttr(currentPoints)} fill="none" stroke="var(--muted-3)" strokeWidth={2} strokeLinejoin="round" />
        <polyline points={toPointsAttr(targetPoints)} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" />

        {hoverPoint && (
          <g pointerEvents="none">
            <line
              x1={xAt(hover!.index)}
              x2={xAt(hover!.index)}
              y1={Y_TOP}
              y2={Y_BOTTOM}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={xAt(hover!.index)} cy={yAt(hoverPoint.current_trajectory)} r={4} fill="var(--muted-3)" stroke="var(--card)" strokeWidth={2} />
            <circle cx={xAt(hover!.index)} cy={yAt(hoverPoint.target_trajectory)} r={4} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <div
        className="absolute inset-x-0 top-0 bottom-[18px] pointer-events-none font-mono text-[12px] text-muted-3"
      >
        {GRIDLINE_YS.map((y, i) => (
          <span
            key={y}
            className="absolute whitespace-nowrap pr-[7px] -translate-y-1/2"
            style={{ right: "91.5%", top: `${(y / VIEW_HEIGHT) * 100}%` }}
          >
            {formatCompactCurrency(yTickValues[i])}
          </span>
        ))}
        {data.map((d, i) => {
          const showLabel = i % 2 === 0 || i === n - 1
          if (!showLabel) return null
          return (
            <span
              key={d.year}
              className="absolute -translate-x-1/2"
              style={{ left: `${(xAt(i) / VIEW_WIDTH) * 100}%`, bottom: -17 }}
            >
              {d.year}
            </span>
          )
        })}

        {hoverPoint && (
          <div
            className="absolute min-w-[168px] rounded-[9px] border border-border bg-card px-[11px] py-[9px] shadow-[var(--shadow-elevated)]"
            style={{
              left: `${hover!.leftPct}%`,
              top: 6,
              transform: hover!.flipRight ? "translateX(12px)" : "translateX(calc(-100% - 12px))",
              zIndex: 5,
            }}
          >
            <div className="mb-[5px] font-mono text-[11px] font-medium text-muted-3">{hoverPoint.year}</div>
            <div className="flex items-center gap-2 font-sans text-[11.5px] text-muted-foreground">
              <span aria-hidden="true" className="block h-2 w-2 shrink-0 rounded-[2px] bg-muted-3" />
              Current
              <span className="ml-auto font-mono text-[11.5px] font-medium text-foreground">
                {formatCompactCurrency(hoverPoint.current_trajectory)}
              </span>
            </div>
            <div className="mt-[3px] flex items-center gap-2 font-sans text-[11.5px] text-muted-foreground">
              <span aria-hidden="true" className="block h-2 w-2 shrink-0 rounded-[2px] bg-primary" />
              Optimized
              <span className="ml-auto font-mono text-[11.5px] font-medium text-foreground">
                {formatCompactCurrency(hoverPoint.target_trajectory)}
              </span>
            </div>
            <div
              className={cn(
                "mt-1.5 border-t border-border pt-1.5 font-mono text-[11px] font-medium",
                hoverDelta >= 0 ? "text-primary" : "text-destructive"
              )}
            >
              {hoverDelta >= 0 ? "+" : "-"}
              {formatCompactCurrency(Math.abs(hoverDelta))} vs. current
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
