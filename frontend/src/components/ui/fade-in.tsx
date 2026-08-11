import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// Thin transition wrapper — no layout/color/spacing opinions of its own,
// just a gentle fade+rise for content that just became available (a card
// whose data finished loading, a newly-routed page). Uses tw-animate-css's
// existing animate-in utilities (already a dependency, see index.css),
// not a new animation library.
export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("h-full animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out", className)}>
      {children}
    </div>
  )
}
