import { useCurrency } from "@/components/providers/currency-provider"
import type { ComplianceFlag, ComplianceResponse } from "@/lib/api"

/**
 * Bullet-list style pixel-matched to the mockup's "Compliance flags" card
 * (dot + bold title + description, not badge-heavy — extracted via
 * outerHTML from the live mockup).
 *
 * The mockup's per-flag titles ("Sector concentration breach") don't match
 * what compliance.py actually checks (a single-POSITION cap, not a sector
 * cap — sector concentration isn't a compliance check anywhere in this
 * app), so titles below are derived from the real `category` field with
 * accurate wording instead of reusing the mockup's mismatched text. The
 * mockup's "open 41 days" / "23-month lapse" durations have no backend
 * equivalent (flags are recomputed fresh on every request, nothing tracks
 * when a flag first appeared), so that clause is dropped rather than
 * invented. The mockup's "Suitability re-attestation due" flag has zero
 * backend equivalent (no questionnaire/attestation model exists anywhere
 * in this app) and is omitted entirely, per explicit instruction.
 */
const CATEGORY_TITLE: Record<string, string> = {
  concentration: "Position concentration breach",
  wash_sale: "Wash-sale risk",
  disclosure: "Disclosure",
}

function FlagRow({ flag }: { flag: ComplianceFlag }) {
  const { convertMentionsInText } = useCurrency()
  const isOpen = flag.severity !== "low"
  return (
    <div className="flex items-start gap-[9px]">
      <span
        aria-hidden="true"
        className={`mt-[5px] block h-[7px] w-[7px] shrink-0 rounded-full ${isOpen ? "bg-secondary" : "bg-muted-3"}`}
      />
      <div className="flex min-w-0 flex-col gap-px">
        <span className="text-[12px] font-medium text-foreground">{CATEGORY_TITLE[flag.category] ?? flag.category}</span>
        {/* Gemini's plain-language narration of this flag's own real
            numbers, falling back to the raw deterministic message
            whenever narration is unavailable (e.g. AI rate-limited) —
            the flag itself never depends on Gemini to be shown. Either
            way the text may embed a real USD figure (e.g. a wash-sale
            loss amount), so it always goes through the same
            currency-mention conversion as everywhere else. */}
        <span className="text-[11px] leading-[1.45] text-muted-3">{convertMentionsInText(flag.narrative ?? flag.message)}</span>
      </div>
    </div>
  )
}

export function ComplianceCard({ compliance }: { compliance: ComplianceResponse }) {
  const openCount = compliance.flags.filter((flag) => flag.severity !== "low").length

  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-card p-[18px] shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-foreground">Compliance flags</span>
        {openCount > 0 && (
          <span className="rounded-full bg-secondary/15 px-2 py-0.5 text-[12px] font-medium text-secondary">
            {openCount} open
          </span>
        )}
      </div>
      {compliance.flags.length === 0 ? (
        <p className="text-[11px] text-muted-3">No compliance flags at this time.</p>
      ) : (
        compliance.flags.map((flag) => <FlagRow key={flag.id} flag={flag} />)
      )}
    </div>
  )
}
