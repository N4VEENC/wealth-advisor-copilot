/**
 * Full-circle donut — pixel-matched to the mockup's "Investment health
 * score" card (extracted via getComputedStyle from the live mockup).
 *
 * The mockup shows 5 fictional weighted sub-factors (Diversification, Cost
 * efficiency, Tax posture, Goal alignment, Liquidity) under the donut.
 * Our backend's health_score is only ever built from 2 real components
 * (allocation_drift, concentration — see optimizer.py's _score_health).
 * Rather than inventing 3 more factors to match the mockup's row count,
 * this shows exactly the 2 real components, correctly labeled for what
 * they actually are.
 */
const RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function qualifier(score: number): string {
  if (score >= 70) return "GOOD"
  if (score >= 40) return "FAIR"
  return "NEEDS ATTENTION"
}

// Inner-disc width available to text at a given vertical offset from
// center (Pythagorean distance to the ring's inner edge) — used so the
// qualifier line (up to "NEEDS ATTENTION", the longest case) never runs
// past the donut into the card padding.
const INNER_RADIUS = RADIUS - 11 / 2 - 2

function maxTextWidthAt(yOffsetFromCenter: number): number {
  return 2 * Math.sqrt(Math.max(INNER_RADIUS ** 2 - yOffsetFromCenter ** 2, 0))
}

export function HealthDonut({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score))
  const drawn = (clamped / 100) * CIRCUMFERENCE
  const q = qualifier(clamped)
  const isLong = q.length > 6

  return (
    <svg width={132} height={132} viewBox="0 0 132 132" role="img" aria-label={`Investment health score: ${Math.round(clamped)} out of 100 (${q})`}>
      <circle cx={66} cy={66} r={RADIUS} fill="none" stroke="var(--grid-line)" strokeWidth={11} />
      <circle
        cx={66}
        cy={66}
        r={RADIUS}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={11}
        strokeLinecap="round"
        strokeDasharray={`${drawn} ${CIRCUMFERENCE}`}
        transform="rotate(-90 66 66)"
      />
      <text x={66} y={68} textAnchor="middle" fill="var(--foreground)" fontFamily="IBM Plex Sans, sans-serif" fontSize={30} fontWeight={600} letterSpacing="-0.03em">
        {Math.round(clamped)}
      </text>
      <text x={66} y={83} textAnchor="middle" fill="var(--muted-3)" fontFamily="IBM Plex Mono, monospace" fontSize={10} fontWeight={500}>
        / 100
      </text>
      <text
        x={66}
        y={96}
        textAnchor="middle"
        fill="var(--muted-3)"
        fontFamily="IBM Plex Mono, monospace"
        fontSize={isLong ? 8 : 10.5}
        fontWeight={500}
        letterSpacing="0.01em"
        textLength={isLong ? maxTextWidthAt(96 - 66) : undefined}
        lengthAdjust={isLong ? "spacingAndGlyphs" : undefined}
      >
        {q}
      </text>
    </svg>
  )
}

type FactorBarProps = {
  label: string
  value: number
}

export function FactorBar({ label, value }: FactorBarProps) {
  const clamped = Math.max(0, Math.min(100, value))
  const color = clamped < 70 ? "var(--secondary)" : "var(--primary)"

  return (
    <div className="flex items-center gap-2">
      <span className="w-[100px] shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="block h-[5px] flex-1 overflow-hidden rounded-[3px] bg-[var(--grid-line)]">
        <span className="block h-full rounded-[3px]" style={{ width: `${clamped}%`, background: color }} />
      </span>
      <span className="w-[22px] shrink-0 text-right font-mono text-[11px] font-medium text-muted-3">
        {Math.round(clamped)}
      </span>
    </div>
  )
}
