import { useState } from "react"
import { Outlet, useLocation } from "react-router-dom"

import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const location = useLocation()

  return (
    <div data-app-shell className="fixed inset-0 flex overflow-hidden bg-background text-foreground">
      {sidebarOpen && <Sidebar />}
      <div data-app-shell-inner className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Header sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <main data-app-main className="min-h-0 flex-1 overflow-y-auto p-6">
          {/* Keyed by path so React remounts this wrapper on every route
              change, replaying the fade — a calm cross-fade between pages
              instead of an abrupt content swap. */}
          <div key={location.pathname} className="animate-in fade-in-0 duration-200 ease-out">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
