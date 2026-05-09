import { apiFetch, apiUpload, ApiError } from "./client"
import type {
  ConnectConfig, AuthFilesResponse, AuthStatsResponse, QuotaResponse,
  TokenStatsResponse, StartupSnapshotResponse, WarmupResponse,
  RefreshAllTokensResponse, LogsResponse, OAuthUrlResponse, OAuthStatusResponse,
  RequestHistoryResponse, BatchAuthFilesResponse, ManagementJob,
  ManagementEventToken, IssuesResponse, HealthSummaryResponse, AlertsResponse,
  OAuthRepairSession, OAuthRepairBatchResponse, AnalyticsResponse, StorageSummaryResponse, RoutingExplainResponse,
  DesktopInfoResponse, PoolModelsResponse,
  SystemStatusResponse, SystemUpdateQueuedResponse, SystemUpdateLogResponse,
  AuthMaintenanceSummary,
  APIKeyLimitsResponse, APIKeyLimit,
  WebhooksResponse, Webhook, WebhookDeliveriesResponse,
  AccountHealthResponse, AccountHealthItem,
  MaintenanceRule, MaintenanceDryRunResponse, MaintenanceApplyResponse,
  AuditLogResponse, TokenReportEnvelope,
  APIKeyInsightsResponse, RoutingSimulateResponse, CapacityForecastResponse,
  BackupListResponse, BackupManifest, BackupPreviewResponse, BackupRestoreResponse,
  SystemDiagnosticsResponse,
  UpstreamReleaseInfo, PricingResponse
} from "./types"

// Auth Files
export const fetchAuthFiles        = (c: ConnectConfig) => apiFetch<AuthFilesResponse>("GET", "/auth-files", c)
export const fetchAuthStats        = (c: ConnectConfig) => apiFetch<AuthStatsResponse>("GET", "/auth-stats", c)
export const fetchStartupSnapshot  = (c: ConnectConfig) => apiFetch<StartupSnapshotResponse>("GET", "/startup-snapshot", c)
export const fetchAPIKeys          = (c: ConnectConfig) => apiFetch<unknown>("GET", "/api-keys", c)
export const fetchAPIKeyUsage      = (c: ConnectConfig) => apiFetch<Record<string, Record<string, { success: number; failed: number }>>>("GET", "/api-key-usage", c)
export const refreshAllTokens      = (c: ConnectConfig) => apiFetch<RefreshAllTokensResponse>("POST", "/auth-files/refresh-all-tokens", c)
export const patchAuthFileStatus   = (c: ConnectConfig, name: string, disabled: boolean) => apiFetch("PATCH", "/auth-files/status", c, { name, disabled })
export const patchAuthFileStatusBatch = (c: ConnectConfig, names: string[], disabled: boolean) =>
  apiFetch<BatchAuthFilesResponse>("POST", "/auth-files/status-batch", c, { names, disabled })
export const patchAuthFileFields   = (c: ConnectConfig, name: string, fields: { label?: string; note?: string; priority?: number; proxy_url?: string; prefix?: string; group?: string; tags?: string[] }) => apiFetch("PATCH", "/auth-files/fields", c, { name, ...fields })
export const patchAuthFilesFieldsBatch = (c: ConnectConfig, names: string[], body: { set?: { label?: string; note?: string; priority?: number; group?: string }; add_tags?: string[]; remove_tags?: string[] }) =>
  apiFetch<BatchAuthFilesResponse>("POST", "/auth-files/fields-batch", c, { names, ...body })
export const deleteAuthFile        = (c: ConnectConfig, name: string) => apiFetch("DELETE", `/auth-files?name=${encodeURIComponent(name)}`, c)
export const deleteAuthFilesBatch  = (c: ConnectConfig, names: string[]) =>
  apiFetch<BatchAuthFilesResponse>("POST", "/auth-files/delete-batch", c, { names })
export const fetchAuthMaintenanceSummary = (c: ConnectConfig) =>
  apiFetch<AuthMaintenanceSummary>("GET", "/auth-files/maintenance-summary", c)

// Account Health (overlay §3)
export const fetchAccountHealth = (c: ConnectConfig) =>
  apiFetch<AccountHealthResponse>("GET", "/account-health", c)
export const fetchAccountHealthOne = (c: ConnectConfig, name: string) =>
  apiFetch<{ item: AccountHealthItem; computed_at: number }>(
    "GET", `/account-health/${encodeURIComponent(name)}`, c)
export const recomputeAccountHealth = (c: ConnectConfig) =>
  apiFetch<{ status: string; computed_at: number }>("POST", "/account-health/recompute", c)

// Maintenance Rules (overlay §4)
export const fetchMaintenanceRules = (c: ConnectConfig) =>
  apiFetch<{ items: MaintenanceRule[]; count: number }>("GET", "/maintenance-rules", c)
export const upsertMaintenanceRule = (c: ConnectConfig, rule: MaintenanceRule) =>
  apiFetch<MaintenanceRule>("PUT", "/maintenance-rules", c, rule)
export const deleteMaintenanceRule = (c: ConnectConfig, id: string) =>
  apiFetch<{ status: string; id: string }>("DELETE", `/maintenance-rules/${encodeURIComponent(id)}`, c)
export const dryRunMaintenanceRules = (c: ConnectConfig) =>
  apiFetch<MaintenanceDryRunResponse>("POST", "/maintenance-rules/dry-run", c, {})
export const applyMaintenanceRules = (c: ConnectConfig, body: { dry_run_token: string; action_ids: string[]; confirmed?: boolean }) =>
  apiFetch<MaintenanceApplyResponse>("POST", "/maintenance-rules/apply", c, body)

// Token Reports (overlay §5)
export const fetchTokenReportSummary  = (c: ConnectConfig, range: string) => apiFetch<TokenReportEnvelope>("GET", `/token-reports/summary?range=${range}`, c)
export const fetchTokenReportByModel  = (c: ConnectConfig, range: string) => apiFetch<TokenReportEnvelope>("GET", `/token-reports/by-model?range=${range}`, c)
export const fetchTokenReportByProvider = (c: ConnectConfig, range: string) => apiFetch<TokenReportEnvelope>("GET", `/token-reports/by-provider?range=${range}`, c)
export const fetchTokenReportByAPIKey = (c: ConnectConfig, range: string) => apiFetch<TokenReportEnvelope>("GET", `/token-reports/by-api-key?range=${range}`, c)
export const fetchTokenReportByAccount = (c: ConnectConfig, range: string) => apiFetch<TokenReportEnvelope>("GET", `/token-reports/by-account?range=${range}`, c)

// API Key Insights (overlay §6)
export const fetchAPIKeyInsights = (c: ConnectConfig) =>
  apiFetch<APIKeyInsightsResponse>("GET", "/api-key-insights", c)

// Routing Simulate (overlay §7)
export const simulateRouting = (c: ConnectConfig, body: {
  provider?: string; model?: string; api_key_hash?: string; group?: string;
  strategy?: string; include_disabled?: boolean; quota_mode?: "cached" | "fresh"
} = {}) => apiFetch<RoutingSimulateResponse>("POST", "/routing/simulate", c, body)

// Capacity Forecast (overlay §8)
export const fetchCapacityForecast = (c: ConnectConfig, opts: { range?: string; group?: string } = {}) => {
  const params = new URLSearchParams()
  if (opts.range) params.set("range", opts.range)
  if (opts.group) params.set("group", opts.group)
  const qs = params.toString()
  return apiFetch<CapacityForecastResponse>("GET", `/capacity-forecast${qs ? "?" + qs : ""}`, c)
}

// Backup (overlay §10)
export const fetchBackups = (c: ConnectConfig) => apiFetch<BackupListResponse>("GET", "/backups", c)
export const createBackup = (c: ConnectConfig) => apiFetch<BackupManifest>("POST", "/backups", c, {})
export const previewRestore = (c: ConnectConfig, id: string) =>
  apiFetch<BackupPreviewResponse>("POST", `/backups/${encodeURIComponent(id)}/preview-restore`, c, {})
export const restoreBackup = (c: ConnectConfig, id: string, previewID: string) =>
  apiFetch<BackupRestoreResponse>("POST", `/backups/${encodeURIComponent(id)}/restore`, c, { preview_id: previewID })
export const removeBackup = (c: ConnectConfig, id: string) =>
  apiFetch<{ status: string; id: string }>("DELETE", `/backups/${encodeURIComponent(id)}`, c)

// System Diagnostics (overlay §11)
export const fetchSystemDiagnostics = (c: ConnectConfig) =>
  apiFetch<SystemDiagnosticsResponse>("GET", "/system/diagnostics", c)

// Upstream check (system_update.go)
export const checkUpstream = (c: ConnectConfig) =>
  apiFetch<UpstreamReleaseInfo>("GET", "/system/check-upstream", c)

// Pricing (pricing_view.go)
export const fetchPricing = (c: ConnectConfig) =>
  apiFetch<PricingResponse>("GET", "/pricing", c)

// Audit Log (overlay §9)
export const fetchAuditLog = (c: ConnectConfig, opts: { limit?: number; offset?: number; q?: string; action?: string; target?: string } = {}) => {
  const params = new URLSearchParams()
  if (opts.limit) params.set("limit", String(opts.limit))
  if (opts.offset) params.set("offset", String(opts.offset))
  if (opts.q) params.set("q", opts.q)
  if (opts.action) params.set("action", opts.action)
  if (opts.target) params.set("target", opts.target)
  const qs = params.toString()
  return apiFetch<AuditLogResponse>("GET", `/audit-log${qs ? "?" + qs : ""}`, c)
}

export async function downloadAuthFilesBatch(c: ConnectConfig, names: string[]): Promise<{ blob: Blob; filename: string }> {
  const url = c.url.replace(/\/$/, "") + "/v0/management/auth-files/download-batch"
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + c.key, "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const d = await res.json() as { error?: string }; msg = d.error ?? msg } catch { /* ignore */ }
    throw new ApiError(msg, res.status)
  }
  const blob = await res.blob()
  const cd = res.headers.get("Content-Disposition") ?? ""
  const m = cd.match(/filename="?([^";]+)"?/i)
  const filename = m?.[1] ?? `auth-files-${Date.now()}.zip`
  return { blob, filename }
}
export const uploadAuthFile        = (c: ConnectConfig, blob: ArrayBuffer, filename: string) => apiUpload(c, blob, filename)
export const warmupAccounts        = (c: ConnectConfig, names: string[]) => apiFetch<WarmupResponse>("POST", "/auth-files/warmup", c, { names })

// Quota
export const fetchCodexQuota = (c: ConnectConfig) => apiFetch<QuotaResponse>("GET", "/codex-quota", c)

// Pool models (aggregated across all auth files; backed by GET /v0/management/pool-models)
export const fetchPoolModels = (c: ConnectConfig) => apiFetch<PoolModelsResponse>("GET", "/pool-models", c)

// System (one-click CPA update; backed by /v0/management/system/*)
export const fetchSystemStatus    = (c: ConnectConfig) => apiFetch<SystemStatusResponse>("GET", "/system/status", c)
export const triggerSystemUpdate  = (c: ConnectConfig) => apiFetch<SystemUpdateQueuedResponse>("POST", "/system/update", c)
export const fetchSystemUpdateLog = (c: ConnectConfig) => apiFetch<SystemUpdateLogResponse>("GET", "/system/update-log", c)

// Token Stats
export const fetchTokenStats  = (c: ConnectConfig) => apiFetch<TokenStatsResponse>("GET", "/token-stats", c)
export const resetTokenStats  = (c: ConnectConfig) => apiFetch("POST", "/token-stats/reset", c)

// Logs
export const fetchLogs        = (c: ConnectConfig, limit = 500, after = 0) => apiFetch<LogsResponse>("GET", `/logs?limit=${limit}${after ? `&after=${after}` : ""}`, c)
export const clearLogs        = (c: ConnectConfig) => apiFetch("DELETE", "/logs", c)

// OAuth
export const fetchCodexAuthUrl = (c: ConnectConfig) => apiFetch<OAuthUrlResponse>("GET", "/codex-auth-url?is_webui=1", c)
export const fetchAuthStatus   = (c: ConnectConfig, state: string) => apiFetch<OAuthStatusResponse>("GET", `/get-auth-status?state=${encodeURIComponent(state)}`, c)

// Request History
export const fetchRequestHistory = (
  c: ConnectConfig,
  opts: { limit?: number; offset?: number; q?: string; status?: string; model?: string; provider?: string; failed?: boolean; afterTs?: number; beforeTs?: number } = {}
) => {
  const params = new URLSearchParams()
  if (opts.limit) params.set("limit", String(opts.limit))
  if (opts.offset) params.set("offset", String(opts.offset))
  if (opts.q) params.set("q", opts.q)
  if (opts.status && opts.status !== "all") params.set("status", opts.status)
  if (opts.model) params.set("model", opts.model)
  if (opts.provider) params.set("provider", opts.provider)
  if (opts.failed) params.set("failed", "true")
  if (opts.afterTs) params.set("after_ts", String(opts.afterTs))
  if (opts.beforeTs) params.set("before_ts", String(opts.beforeTs))
  const qs = params.toString()
  return apiFetch<RequestHistoryResponse>("GET", `/request-history${qs ? "?" + qs : ""}`, c)
}
export const clearRequestHistory = (c: ConnectConfig) => apiFetch("POST", "/request-history/clear", c)

// Jobs
export const startRefreshTokensJob = (
  c: ConnectConfig,
  opts?: { force?: boolean; concurrency?: number },
) => apiFetch<ManagementJob>("POST", "/jobs/refresh-tokens", c, opts ?? {})
export const fetchManagementJob = (c: ConnectConfig, id: string) =>
  apiFetch<ManagementJob>("GET", `/jobs/${encodeURIComponent(id)}`, c)
export const fetchManagementJobs = (c: ConnectConfig) =>
  apiFetch<{ jobs: ManagementJob[]; count: number }>("GET", "/jobs", c)

// Polls a running job until it leaves "running" state or times out
// (default 120s — bulk OAuth refresh on 280+ accounts at concurrency 8 takes
// ~30-70s, so 30s previously caused spurious "全部失败" timeouts).
// Calls onUpdate with each snapshot so callers can drive a progress UI.
export async function waitForManagementJob(
  c: ConnectConfig,
  initial: ManagementJob,
  onUpdate: (job: ManagementJob) => void,
  maxIterations = 120,
): Promise<ManagementJob> {
  let current = initial
  onUpdate(current)
  for (let i = 0; i < maxIterations; i++) {
    if (current.status !== "running") return current
    await new Promise(r => setTimeout(r, 1000))
    current = await fetchManagementJob(c, initial.id)
    onUpdate(current)
  }
  return current
}

// Realtime / issues / alerts
export const createEventsToken = (c: ConnectConfig) => apiFetch<ManagementEventToken>("POST", "/events-token", c)
export const fetchIssues = (c: ConnectConfig) => apiFetch<IssuesResponse>("GET", "/issues", c)
export const fetchHealthSummary = (c: ConnectConfig) => apiFetch<HealthSummaryResponse>("GET", "/health-summary", c)
export const fetchAlerts = (c: ConnectConfig) => apiFetch<AlertsResponse>("GET", "/alerts", c)
export const ackAlert = (c: ConnectConfig, id: string) => apiFetch("POST", `/alerts/${encodeURIComponent(id)}/ack`, c)
export const resolveAlert = (c: ConnectConfig, id: string) => apiFetch("POST", `/alerts/${encodeURIComponent(id)}/resolve`, c)

// OAuth repair
export const createOAuthRepairSession = (c: ConnectConfig, provider: string, targetName: string, mode = "replace") =>
  apiFetch<OAuthRepairSession>("POST", "/oauth/repair-session", c, { provider, target_name: targetName, mode })

export const createOAuthRepairBatch = (c: ConnectConfig, body: {
  provider?: string
  mode?: string
  targets: { provider?: string; target_name: string; mode?: string }[]
}) => apiFetch<OAuthRepairBatchResponse>("POST", "/oauth/repair-session-batch", c, body)

// startOAuthRepairFlow does the full 2-step dance:
//   1. Create the repair session via authenticated POST.
//   2. Hit the returned auth_url (still on /v0/management/...) WITH auth so the
//      backend mints the real OAuth URL (state + PKCE).
// Returns { sessionId, providerOAuthUrl } so the caller can window.open() it.
export async function startOAuthRepairFlow(
  c: ConnectConfig, provider: string, targetName: string, mode = "replace",
): Promise<{ sessionId: string; providerOAuthUrl: string }> {
  const session = await createOAuthRepairSession(c, provider, targetName, mode)
  // session.auth_url is like "/v0/management/codex-auth-url?is_webui=1&repair_session=<id>"
  const path = session.auth_url.replace(/^\/v0\/management/, "")
  const oauth = await apiFetch<{ url: string; state: string }>("GET", path, c)
  return { sessionId: session.session_id, providerOAuthUrl: oauth.url }
}
export const fetchOAuthRepairSession = (c: ConnectConfig, id: string) =>
  apiFetch<OAuthRepairSession>("GET", `/oauth/sessions/${encodeURIComponent(id)}`, c)
export const warmupOAuthRepairSession = (c: ConnectConfig, id: string) =>
  apiFetch<OAuthRepairSession>("POST", `/oauth/sessions/${encodeURIComponent(id)}/warmup`, c)
export const cancelOAuthRepairSession = (c: ConnectConfig, id: string) =>
  apiFetch<OAuthRepairSession>("POST", `/oauth/sessions/${encodeURIComponent(id)}/cancel`, c)

// API Key Limits
export const fetchAPIKeyLimits = (c: ConnectConfig) => apiFetch<APIKeyLimitsResponse>("GET", "/api-key-limits", c)
export const upsertAPIKeyLimit = (c: ConnectConfig, body: {
  id?: string; key_hash?: string; key?: string;
  name?: string; note?: string;
  daily_token_limit: number; enabled?: boolean;
}) => apiFetch<APIKeyLimit>("PUT", "/api-key-limits", c, body)
export const deleteAPIKeyLimit = (c: ConnectConfig, hash: string) =>
  apiFetch<{ status: string; hash: string }>("DELETE", `/api-key-limits/${encodeURIComponent(hash)}`, c)

// Webhooks
export const fetchWebhooks = (c: ConnectConfig) => apiFetch<WebhooksResponse>("GET", "/webhooks", c)
export const upsertWebhook = (c: ConnectConfig, body: Partial<Webhook> & { url: string }) =>
  apiFetch<Webhook>("PUT", "/webhooks", c, body)
export const deleteWebhook = (c: ConnectConfig, id: string) =>
  apiFetch<{ status: string; id: string }>("DELETE", `/webhooks/${encodeURIComponent(id)}`, c)
export const testWebhook = (c: ConnectConfig, id: string) =>
  apiFetch<{ status: string; duration_ms?: number; http_code?: number; error?: string }>(
    "POST", `/webhooks/${encodeURIComponent(id)}/test`, c)
export const fetchWebhookDeliveries = (c: ConnectConfig, id: string) =>
  apiFetch<WebhookDeliveriesResponse>("GET", `/webhooks/${encodeURIComponent(id)}/deliveries`, c)

// Analytics / routing / desktop
export const fetchUsageDailyAnalytics = (c: ConnectConfig) => apiFetch<AnalyticsResponse>("GET", "/analytics/usage-daily", c)
export const fetchUsageHourlyAnalytics = (c: ConnectConfig) => apiFetch<AnalyticsResponse>("GET", "/analytics/usage-hourly", c)
export const fetchTopAuthsAnalytics = (c: ConnectConfig) => apiFetch<AnalyticsResponse>("GET", "/analytics/top-auths", c)
export const fetchErrorsAnalytics = (c: ConnectConfig) => apiFetch<{ items: { provider: string; model: string; count: number }[]; count: number }>("GET", "/analytics/errors", c)
export const fetchStorageSummary = (c: ConnectConfig) => apiFetch<StorageSummaryResponse>("GET", "/analytics/storage-summary", c)
export const explainRouting = (c: ConnectConfig, body: { provider?: string; model?: string; api_key_hash?: string } = {}) =>
  apiFetch<RoutingExplainResponse>("POST", "/routing/explain", c, body)
export const fetchDesktopInfo = (c: ConnectConfig) => apiFetch<DesktopInfoResponse>("GET", "/desktop/info", c)

// Query key factories
export const qkeys = {
  snapshot:  (c: ConnectConfig) => ["startup-snapshot", c.url, c.key] as const,
  authFiles: (c: ConnectConfig) => ["auth-files", c.url, c.key] as const,
  quota:     (c: ConnectConfig) => ["codex-quota", c.url, c.key] as const,
  tokens:    (c: ConnectConfig) => ["token-stats", c.url, c.key] as const,
  logs:      (c: ConnectConfig) => ["logs", c.url, c.key] as const,
  history:   (c: ConnectConfig) => ["request-history", c.url, c.key] as const,
  maintenance:(c: ConnectConfig) => ["auth-maintenance", c.url, c.key] as const,
  issues:    (c: ConnectConfig) => ["issues", c.url, c.key] as const,
  health:    (c: ConnectConfig) => ["health-summary", c.url, c.key] as const,
  alerts:    (c: ConnectConfig) => ["alerts", c.url, c.key] as const,
  analytics: (c: ConnectConfig) => ["analytics", c.url, c.key] as const,
  desktop:   (c: ConnectConfig) => ["desktop", c.url, c.key] as const,
  poolModels:(c: ConnectConfig) => ["pool-models", c.url, c.key] as const,
  system:    (c: ConnectConfig) => ["system-status", c.url, c.key] as const,
  systemLog: (c: ConnectConfig) => ["system-update-log", c.url, c.key] as const,
  apiKeyLimits:(c: ConnectConfig) => ["api-key-limits", c.url, c.key] as const,
  webhooks:  (c: ConnectConfig) => ["webhooks", c.url, c.key] as const,
  webhookDeliveries: (c: ConnectConfig, id: string) => ["webhook-deliveries", c.url, c.key, id] as const,
  accountHealth: (c: ConnectConfig) => ["account-health", c.url, c.key] as const,
  maintenanceRules: (c: ConnectConfig) => ["maintenance-rules", c.url, c.key] as const,
  auditLog: (c: ConnectConfig) => ["audit-log", c.url, c.key] as const,
}
