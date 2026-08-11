import { Loader2 } from "lucide-react"

// Shared loading affordance for page-level async fetches — matches the
// spinner already used in header.tsx's "Generate report" button, so every
// page's loading state looks like the same app rather than plain text on
// some pages and an animated icon on others.
export function LoadingLine({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" width={14} height={14} className="animate-spin" />
      {label}
    </p>
  )
}
