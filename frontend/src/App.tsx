import { Suspense, lazy } from "react"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ToastProvider } from "@/components/ui/Toast"
import { AppLayout } from "@/components/layout/AppLayout"
import { CommandPalette } from "@/components/CommandPalette"

const Dashboard = lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.Dashboard })))
const Accounts = lazy(() => import("@/pages/Accounts").then(m => ({ default: m.Accounts })))
const Quota = lazy(() => import("@/pages/Quota").then(m => ({ default: m.Quota })))
const PoolModels = lazy(() => import("@/pages/PoolModels").then(m => ({ default: m.PoolModels })))
const System = lazy(() => import("@/pages/System").then(m => ({ default: m.System })))
const TokenStats = lazy(() => import("@/pages/TokenStats").then(m => ({ default: m.TokenStats })))
const RequestHistory = lazy(() => import("@/pages/RequestHistory").then(m => ({ default: m.RequestHistory })))
const OAuth = lazy(() => import("@/pages/OAuth").then(m => ({ default: m.OAuth })))
const Logs = lazy(() => import("@/pages/Logs").then(m => ({ default: m.Logs })))
const Duplicates = lazy(() => import("@/pages/Duplicates").then(m => ({ default: m.Duplicates })))
const Settings = lazy(() => import("@/pages/Settings").then(m => ({ default: m.Settings })))
const Issues = lazy(() => import("@/pages/Issues").then(m => ({ default: m.Issues })))
const AccountHealth = lazy(() => import("@/pages/AccountHealth").then(m => ({ default: m.AccountHealth })))
const MaintenanceRules = lazy(() => import("@/pages/MaintenanceRules").then(m => ({ default: m.MaintenanceRules })))
const AuditLog = lazy(() => import("@/pages/AuditLog").then(m => ({ default: m.AuditLog })))
const AccountDetail = lazy(() => import("@/pages/AccountDetail").then(m => ({ default: m.AccountDetail })))
const TokenReports = lazy(() => import("@/pages/TokenReports").then(m => ({ default: m.TokenReports })))
const ApiKeyInsights = lazy(() => import("@/pages/ApiKeyInsights").then(m => ({ default: m.ApiKeyInsights })))
const RoutingLab = lazy(() => import("@/pages/RoutingLab").then(m => ({ default: m.RoutingLab })))
const CapacityForecast = lazy(() => import("@/pages/CapacityForecast").then(m => ({ default: m.CapacityForecast })))
const BackupCenter = lazy(() => import("@/pages/BackupCenter").then(m => ({ default: m.BackupCenter })))
const SystemDiagnostics = lazy(() => import("@/pages/SystemDiagnostics").then(m => ({ default: m.SystemDiagnostics })))
const Pricing = lazy(() => import("@/pages/Pricing").then(m => ({ default: m.Pricing })))
const Alerts = lazy(() => import("@/pages/Alerts").then(m => ({ default: m.Alerts })))
const Analytics = lazy(() => import("@/pages/Analytics").then(m => ({ default: m.Analytics })))
const ApiKeys = lazy(() => import("@/pages/ApiKeys").then(m => ({ default: m.ApiKeys })))
const ApiKeyLimits = lazy(() => import("@/pages/ApiKeyLimits").then(m => ({ default: m.ApiKeyLimits })))
const Webhooks = lazy(() => import("@/pages/Webhooks").then(m => ({ default: m.Webhooks })))
const Jobs = lazy(() => import("@/pages/Jobs").then(m => ({ default: m.Jobs })))
const Desktop = lazy(() => import("@/pages/Desktop").then(m => ({ default: m.Desktop })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter basename="/cpa-management">
          <CommandPalette />
          <AppLayout>
            <Suspense fallback={<div className="text-sm text-[#94a3b8]">页面加载中…</div>}>
              <Routes>
                <Route path="/"           element={<Dashboard />} />
                <Route path="/accounts"   element={<Accounts />} />
                <Route path="/quota"      element={<Quota />} />
                <Route path="/models"     element={<PoolModels />} />
                <Route path="/system"     element={<System />} />
                <Route path="/tokens"     element={<TokenStats />} />
                <Route path="/history"    element={<RequestHistory />} />
                <Route path="/oauth"      element={<OAuth />} />
                <Route path="/logs"       element={<Logs />} />
                <Route path="/duplicates" element={<Duplicates />} />
                <Route path="/settings"   element={<Settings />} />
                <Route path="/issues"     element={<Issues />} />
                <Route path="/account-health" element={<AccountHealth />} />
                <Route path="/maintenance-rules" element={<MaintenanceRules />} />
                <Route path="/audit-log" element={<AuditLog />} />
                <Route path="/accounts/:encodedName" element={<AccountDetail />} />
                <Route path="/token-reports" element={<TokenReports />} />
                <Route path="/api-key-insights" element={<ApiKeyInsights />} />
                <Route path="/routing-lab" element={<RoutingLab />} />
                <Route path="/capacity-forecast" element={<CapacityForecast />} />
                <Route path="/backups" element={<BackupCenter />} />
                <Route path="/system-diagnostics" element={<SystemDiagnostics />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/alerts"     element={<Alerts />} />
                <Route path="/analytics"  element={<Analytics />} />
                <Route path="/api-keys"   element={<ApiKeys />} />
                <Route path="/api-key-limits" element={<ApiKeyLimits />} />
                <Route path="/webhooks"   element={<Webhooks />} />
                <Route path="/jobs"       element={<Jobs />} />
                <Route path="/desktop"    element={<Desktop />} />
              </Routes>
            </Suspense>
          </AppLayout>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
