/**
 * Semicircle risk gauge — pixel-matched to the mockup's "Diversification
 * risk" card (extracted via getComputedStyle from the live mockup).
 *
 * The mockup plots a "risk" number where LOW = good (green) and HIGH = bad
 * (red), with a fixed ceiling ("target ≤ 55"). Our backend's
 * `diversification_score` is the opposite polarity — HIGH = good (well
 * diversified) — so this component expects `riskValue = 100 - diversification_score`,
 * a direct algebraic inverse of a real number, not an invented one. The
 * mockup's own "target ≤ 55" is a static UI constant with no backend
 * equivalent in our schema (no per-client risk ceiling field exists), so
 * that line is intentionally omitted here rather than fabricated.
 *
 * The 5 band colors are literal hex values from the mockup's SVG (not CSS
 * variables — they don't change between light/dark theme there either).
 */
const BANDS = [
  { max: 20, color: "#9CC08A", label: "Low" },
  { max: 40, color: "#4E8B57", label: "Moderate" },
  { max: 60, color: "#D3A32F", label: "Watch" },
  { max: 80, color: "#C4712B", label: "Elevated" },
  { max: 100, color: "#A83A2C", label: "High" },
] as const

const CENTER_X = 110
const CENTER_Y = 100
const RADIUS = 90
const BAND_DRAW_LENGTH = 48
const BAND_GAP = 8.5

function bandFor(value: number) {
  return BANDS.find((b) => value <= b.max) ?? BANDS[BANDS.length - 1]
}

function pointOnArc(value: number) {
  const angleDeg = 180 - (value / 100) * 180
  const angleRad = (angleDeg * Math.PI) / 180
  return {
    x: CENTER_X + RADIUS * Math.cos(angleRad),
    y: CENTER_Y - RADIUS * Math.sin(angleRad),
  }
}

export function RiskGauge({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value))
  const band = bandFor(clamped)
  const marker = pointOnArc(clamped)

  return (
    <svg
      width="100%"
      height="130"
      viewBox="0 0 220 122"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${label}: ${Math.round(clamped)} out of 100 (${band.label})`}
    >
      {BANDS.map((b, i) => (
        <path
          key={b.label}
          d="M 20 100 A 90 90 0 0 1 200 100"
          fill="none"
          stroke={b.color}
          strokeWidth={13}
          strokeLinecap="round"
          strokeDasharray={`${BAND_DRAW_LENGTH} 235`}
          strokeDashoffset={i === 0 ? undefined : -(i * (BAND_DRAW_LENGTH + BAND_GAP))}
        />
      ))}
      <line x1={CENTER_X} y1={4} x2={CENTER_X} y2={15} stroke="var(--muted-3)" strokeWidth={1.5} />
      <circle cx={marker.x} cy={marker.y} r={7} fill="var(--card)" stroke={band.color} strokeWidth={3.5} />
      <text x="18" y="118" fill="var(--muted-3)" fontFamily="IBM Plex Mono, monospace" fontSize={11} fontWeight={500}>
        LOW RISK
      </text>
      <text
        x="202"
        y="118"
        textAnchor="end"
        fill="var(--muted-3)"
        fontFamily="IBM Plex Mono, monospace"
        fontSize={11}
        fontWeight={500}
      >
        HIGH RISK
      </text>
      <text
        x={CENTER_X}
        y="86"
        textAnchor="middle"
        fill={band.color}
        fontFamily="IBM Plex Sans, sans-serif"
        fontSize={36}
        fontWeight={600}
        letterSpacing="-0.03em"
      >
        {Math.round(clamped)}
      </text>
    </svg>
  )
}

export function riskBandLabel(value: number): string {
  return bandFor(Math.max(0, Math.min(100, value))).label
}
