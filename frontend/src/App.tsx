import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/layout/app-shell"
import { ClientsPage } from "@/pages/clients-page"
import { ClientEntryPage } from "@/pages/client-entry-page"
import { DashboardPage } from "@/pages/dashboard-page"
import { HoldingsPage } from "@/pages/holdings-page"
import { ReportsPage } from "@/pages/reports-page"
import { ReportViewPage } from "@/pages/report-view-page"
import { ExplanationsPage } from "@/pages/explanations-page"

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/clients" replace />} />
      <Route element={<AppShell />}>
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:clientId" element={<ClientEntryPage />} />
        <Route path="clients/:clientId/dashboard" element={<DashboardPage />} />
        <Route path="clients/:clientId/holdings" element={<HoldingsPage />} />
        <Route path="clients/:clientId/reports" element={<ReportsPage />} />
        <Route path="clients/:clientId/reports/:reportId" element={<ReportViewPage />} />
        <Route path="explanations" element={<ExplanationsPage />} />
        <Route path="*" element={<Navigate to="/clients" replace />} />
      </Route>
    </Routes>
  )
}

export default App
