// Connection
export interface ConnectConfig { url: string; key: string }

// Auth Files
export interface AuthFile {
  id: string; name: string; provider: string; type?: string
  email?: string; label?: string
  account_type?: string; account?: string
  status: string; status_message?: string; disabled: boolean; unavailable: boolean
  success: number; failed: number; last_refresh?: string; next_retry_after?: string
  last_error?: { code?: string; message?: string }
  priority?: number; note?: string; group?: string; tags?: string[]
  source: string; size: number
  runtime_only?: boolean
  created_at?: string; updated_at?: string; modtime?: string
  path?: string
  auth_index?: number
}
export interface AuthFilesResponse { files: AuthFile[] }

// Auth Stats
export interface RecentRequestBucket { time: string; success: number; failed: number }
export interface AuthStatEntry {
  id: string; provider: string; label?: string; email?: string
  status: string; disabled: boolean; unavailable: boolean
  success: number; failed: number; recent_requests: RecentRequestBucket[]
}
export interface AuthStatsResponse { auths: AuthStatEntry[]; total_success: number; total_failed: number; count: number }

// Quota
export interface QuotaWindow { used_percent: number; remaining_percent: number; window_minutes?: number; reset_at?: number; reset_in?: string }
export interface ExtraQuotaWindow { name: string; primary?: QuotaWindow }
export interface RawResponseMeta { has_additional_rate_limits: boolean; extra_rate_limit_keys?: string[] }
export interface CodexQuotaEntry {
  id: string; email?: string; status: string; disabled: boolean; refresh_status: string
  primary_window?: QuotaWindow; secondary_window?: QuotaWindow
  extra_windows?: ExtraQuotaWindow[]; raw_meta?: RawResponseMeta; error?: string
}
export interface QuotaSummary {
  total: number; success: number; failed: number; disabled: number
  needs_relogin?: number   // accounts excluded from totals because they need to be re-authenticated
  avg_primary_used: number; avg_primary_remaining: number
  avg_secondary_used?: number; avg_secondary_remaining?: number
  idle_count: number; above_50pct_count: number; below_20pct_count: number
  // Account-equivalent capacity (1.0 = one account fully available).
  // Total = accounts contributing data; Used = sum(used% / 100); Remaining = total - used.
  primary_capacity_total?: number; primary_capacity_used?: number; primary_capacity_remaining?: number
  secondary_capacity_total?: number; secondary_capacity_used?: number; secondary_capacity_remaining?: number
}
export interface QuotaResponse { entries: CodexQuotaEntry[]; summary: QuotaSummary }

// Token Stats
export interface TokenStatEntry {
  auth_id: string; provider?: string; email?: string; api_key_hash?: string
  input_tokens: number; output_tokens: number; cached_tokens: number
  reasoning_tokens: number; total_tokens: number; estimated_usd: number
  requests: number; failed_requests: number; last_used_at?: number
}
export interface TokenTotals {
  input_tokens: number; output_tokens: number; cached_tokens: number
  reasoning_tokens: number; total_tokens: number; estimated_usd: number
  requests: number; failed_requests: number
}
export interface TokenToday extends TokenTotals { date: string }
export interface TokenStatsResponse {
  entries: TokenStatEntry[]; totals: TokenTotals; today: TokenToday
  started_at: number; pricing_note: string
}

// Startup Snapshot
export interface StartupSnapshotResponse {
  files: AuthFilesResponse; stats: AuthStatsResponse; token_today: TokenToday; fetched_at: number
}

// Warmup
export interface WarmupResult { name: string; id: string; email?: string; provider: string; ok: boolean; message: string; latency_ms: number }
export interface WarmupResponse { results: WarmupResult[]; total: number; succeeded: number; failed: number }

// Refresh
export interface RefreshAllTokensResponse { status: string; queued: number; message: string }
export interface BatchAuthFilesResponse {
  status?: string
  disabled?: boolean
  updated?: number
  deleted?: number
  files: string[]
  failed: number
  errors: { name: string; error: string }[]
}

// Logs
export interface LogsResponse { lines: string[]; "line-count": number; "latest-timestamp": number }

// OAuth
export interface OAuthUrlResponse { url: string; state: string }
export interface OAuthStatusResponse { status: "pending" | "ok" | "error"; error?: string }

// Request History (in-memory ring buffer of last 5000 proxied requests)
export interface RequestRecord {
  ts: number
  method?: string
  path?: string
  status_code?: number
  model?: string
  alias?: string
  provider?: string
  auth_id?: string
  auth_index?: string
  auth_type?: string
  email?: string
  source?: string
  api_key_hash?: string
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated_usd: number
  latency_ms: number
  failed: boolean
}
export interface RequestHistorySummary {
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  total_tokens: number
  estimated_usd: number
  requests: number
  failed_requests: number
}
export interface RequestHistoryResponse {
  records: RequestRecord[]
  count: number
  total?: number
  limit?: number
  offset?: number
  summary: RequestHistorySummary
}

// API Key Insights (overlay §6)
export interface APIKeyInsightItem {
  hash: string
  preview?: string
  name?: string
  providers?: string[]
  status: "ok" | "warn" | "exceeded" | "unused" | "high_failure"
  today_tokens: number
  seven_day_tokens: number
  daily_limit?: number
  estimated_usd_today: number
  estimated_usd_7d: number
  failure_rate_24h: number
  last_used_at?: number
  reasons?: string[]
  has_limit_configured: boolean
}
export interface APIKeyInsightsResponse {
  summary: {
    configured: number
    active_today: number
    unused_within_window: number
    window_seconds: number
    over_limit: number
    high_failure: number
  }
  items: APIKeyInsightItem[]
}

// Routing simulate (overlay §7)
export interface RoutingSimulateCandidate {
  name: string
  score: number
  selected: boolean
  reasons?: string[]
  skip_reasons?: string[]
}
export interface RoutingSimulateResponse {
  selected: string
  strategy: string
  quota_mode: string
  candidates: RoutingSimulateCandidate[]
}

// Capacity forecast (overlay §8)
export interface CapacityGroupRow {
  group: string
  accounts: number
  remaining_ae: number
  burn_rate_ae_per_day: number
  estimated_days_remaining: number
  pool_risk: "green" | "amber" | "red" | "unknown"
}
export interface CapacityForecastResponse {
  range: string
  summary: {
    available_accounts: number
    secondary_capacity_remaining_ae: number
    burn_rate_ae_per_day: number
    estimated_days_remaining: number
    primary_pressure_pct: number
    pool_risk: "green" | "amber" | "red" | "unknown"
  }
  groups: CapacityGroupRow[]
  recommendations?: string[]
}

// Token Reports (overlay §5)
export interface TokenReportTotals {
  requests: number
  failed_requests: number
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated_usd: number
}
export interface TokenReportItem extends TokenReportTotals {
  key: string
  failure_rate: number
}
export interface TokenReportEnvelope {
  range: string
  window_start_ts: number
  window_end_ts: number
  truncated: boolean
  actual_range_seconds: number
  totals: TokenReportTotals
  items: TokenReportItem[]
}

// Maintenance Rules (overlay §4)
export interface MaintenanceCondition {
  field: string
  op: "==" | "!=" | ">=" | "<=" | ">" | "<" | "in" | "notin" | "contains"
  value: unknown
}
export interface MaintenanceAction {
  type: "select" | "warmup" | "disable" | "enable" | "move_group" | "add_tag" | "lower_priority" | "relogin" | "delete"
  params?: Record<string, unknown>
}
export interface MaintenanceScope {
  providers?: string[]
  groups?: string[]
  tags_any?: string[]
}
export interface MaintenanceRule {
  id: string
  name: string
  enabled: boolean
  mode: "dry_run" | "apply"
  conditions: MaintenanceCondition[]
  action: MaintenanceAction
  scope: MaintenanceScope
  created_at?: number
  updated_at?: number
}
export interface MaintenanceDryRunActionItem {
  id: string
  rule_id: string
  target: string
  action: string
  risk: "none" | "low" | "medium" | "high"
  would_change: boolean
  reason: string
}
export interface MaintenanceDryRunResponse {
  dry_run_token: string
  computed_at: number
  expires_at: number
  rules: number
  matched_accounts: number
  actions: MaintenanceDryRunActionItem[]
}
export interface MaintenanceApplyResultItem {
  id: string
  target: string
  action: string
  ok: boolean
  message?: string
  skipped?: boolean
}
export interface MaintenanceApplyResponse {
  status: string
  total: number
  succeeded: number
  failed: number
  skipped: number
  results: MaintenanceApplyResultItem[]
}

// Backup (overlay §10)
export interface BackupManifest {
  id: string
  created_at: number
  size_bytes: number
  files: string[]
  skipped?: string[]
  note?: string
  source: "manual" | "pre_restore"
}
export interface BackupListResponse {
  items: BackupManifest[]
  count: number
}
export interface BackupPreviewResponse {
  preview_id: string
  backup_id: string
  expires_at: number
  will_create: string[]
  will_update: string[]
  will_delete: string[]
  conflicts: string[]
}
export interface BackupRestoreResponse {
  status: string
  backup_id: string
  pre_restore_id: string
  succeeded: number
  failed: number
  results: { path: string; ok: boolean; error?: string }[]
}

// Upstream check
export interface UpstreamReleaseInfo {
  upstream_repo: string
  latest_tag: string
  latest_name?: string
  latest_url?: string
  published_at?: string
  prerelease?: boolean
  body?: string
  asset_count?: number
  current_version: string
  current_commit?: string
  current_build_date?: string
  update_available: boolean
  version_uncertain: boolean
  checked_at: number
}

// Pricing
export interface PricingRow {
  prefix: string
  input_per_1m: number
  cached_input_per_1m: number
  output_per_1m: number
  reasoning_per_1m: number
  reasoning_inherits_output: boolean
}
export interface PricingResponse {
  items: PricingRow[]
  count: number
  unit: string
  source: string
  note: string
}

// System Diagnostics (overlay §11)
export interface SystemDiagnosticsResponse {
  generated_at: number
  binary_hash?: string
  frontend_build_hash?: string
  overlay_version_note?: string
  config_path?: string
  auth_dir?: string
  data_dir?: string
  go_version: string
  os: string
  arch: string
  uptime_seconds: number
  checks: { name: string; ok: boolean; note?: string }[]
  overlay_features: string[]
  update_log_tail?: string
  env_summary: Record<string, string>
}

// Audit Log (overlay §9)
export interface AuditEvent {
  id: string
  ts: number
  actor: { management_key_hash?: string; ip?: string; user_agent?: string }
  action: string
  target: { type?: string; ids?: string[] }
  request: { path?: string; method?: string }
  result: { ok: boolean; succeeded?: number; failed?: number; error?: string }
}
export interface AuditLogResponse {
  items: AuditEvent[]
  count: number
  total: number
  limit: number
  offset: number
}

// Account Health (overlay §3)
export interface AccountHealthReason {
  code: string
  severity: "info" | "warning" | "critical"
  message?: string
}
export interface AccountHealthSuggestion {
  type: "relogin" | "warmup" | "disable" | "enable" | "lower_priority" | "move_group" | "delete_review" | "none"
  label: string
  risk: "none" | "low" | "medium" | "high"
}
export interface AccountHealthQuota {
  primary_remaining?: number
  secondary_remaining?: number
}
export interface AccountHealthRequestWindow {
  requests_24h: number
  failed_24h: number
  failure_rate_24h: number
}
export interface AccountHealthItem {
  name: string
  id: string
  provider: string
  email?: string
  group?: string
  tags?: string[]
  score: number
  level: "healthy" | "warning" | "critical"
  reasons: AccountHealthReason[]
  suggested_actions: AccountHealthSuggestion[]
  last_request_at?: number
  last_refresh_at?: string
  quota?: AccountHealthQuota
  request_window: AccountHealthRequestWindow
}
export interface AccountHealthSummary {
  total: number
  healthy: number
  warning: number
  critical: number
  needs_relogin: number
  quota_low: number
  stale: number
}
export interface AccountHealthCandidates {
  relogin: string[]
  disable: string[]
  warmup: string[]
  delete_review: string[]
}
export interface AccountHealthResponse {
  summary: AccountHealthSummary
  items: AccountHealthItem[]
  candidates: AccountHealthCandidates
  computed_at: number
}

export interface AuthMaintenanceSummary {
  summary: {
    total: number
    active: number
    ready: number
    disabled: number
    unavailable: number
    error: number
    needs_relogin: number
    unavailable_free: number
    problem: number
  }
  counts: {
    providers: Record<string, number>
    groups: Record<string, number>
    tags: Record<string, number>
    plans: Record<string, number>
  }
  candidates: {
    needs_relogin: string[]
    unavailable_free: string[]
    problem: string[]
  }
}

export interface ManagementJob {
  id: string
  type: string
  status: "running" | "completed" | "timeout" | "not_found"
  started_at: number
  updated_at: number
  total: number
  queued: number
  done: number
  success: number
  failed: number
  skipped: number
  pending: number
}

export interface ManagementEventToken { token: string; expires_at: number }
export interface ManagementEventEnvelope<T = unknown> {
  id: number
  type: string
  ts: number
  source: string
  payload: T
}

export interface ManagementIssue {
  id: string
  severity: "critical" | "warning" | "info"
  kind: string
  auth_name?: string
  title: string
  detail?: string
  action?: string
  ts: number
}
export interface IssuesResponse {
  summary: { critical: number; warning: number; info: number }
  items: ManagementIssue[]
}

export interface HealthSummaryResponse {
  score: number
  status: "healthy" | "degraded" | "critical"
  reasons: string[]
  metrics: { active_accounts: number; healthy_accounts: number; issues: number }
}

export interface ManagementAlert {
  id: string
  level: "critical" | "warning" | "info"
  category: string
  title: string
  message?: string
  target?: string
  first_seen: number
  last_seen: number
  count: number
  status: "active" | "acknowledged" | "resolved"
  action?: string
}
export interface AlertsResponse { alerts: ManagementAlert[]; count: number }

export interface OAuthRepairSession {
  session_id: string
  provider: string
  target_name: string
  mode: string
  status: string
  auth_url: string
  error?: string
  created_at: number
  expires_at: number
  updated_at: number
}

export interface OAuthRepairBatchSlot {
  target_name: string
  provider: string
  session?: OAuthRepairSession
  error?: string
}
export interface OAuthRepairBatchResponse {
  sessions: OAuthRepairBatchSlot[]
  total: number
  succeeded: number
  failed: number
}

export interface UsageAggregate {
  day?: string
  hour?: string
  auth_id?: string
  provider?: string
  model?: string
  requests: number
  failed_requests: number
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated_usd: number
  last_ts?: number
}
export interface AnalyticsResponse { items: UsageAggregate[]; count: number }
export interface StorageSummaryResponse {
  mode: string
  sqlite_enabled: boolean
  request_history_capacity: number
  records_loaded: number
}
export interface RoutingExplainResponse {
  selected: string
  candidates: { name: string; score: number; reasons: string[] }[]
}
export interface DesktopInfoResponse {
  mode: string
  entrypoints: Record<string, string>
  legacy_supported: boolean
  tauri_supported: boolean
}

// Version (from response headers)
export interface VersionInfo { version: string; commit: string; buildDate: string }

// API Key Limits — soft daily limits + status snapshot (v1: display + alert only)
export interface APIKeyLimit {
  id: string
  key_hash: string
  name?: string
  key_preview?: string
  daily_token_limit: number
  enabled: boolean
  created_at: number
  updated_at: number
  note?: string
}
export interface APIKeyLimitWithUsage extends APIKeyLimit {
  used_tokens: number
  used_percent: number
  status: "ok" | "warn" | "exceeded" | "disabled" | "unused"
  last_used_at?: number
  requests: number
}
export interface APIKeyOrphan {
  key_hash: string
  used_tokens: number
  requests: number
  last_used_at?: number
}
export interface APIKeyLimitsResponse {
  date: string
  limits: APIKeyLimitWithUsage[]
  orphans: APIKeyOrphan[]
  total: number
  note: string
}

// Webhooks (Discord-only for v1; bus subscribes to a curated set of management events)
export interface Webhook {
  id: string
  name: string
  url: string
  provider: string
  events: string[]
  enabled: boolean
  created_at: number
  updated_at: number
  last_error?: string
  last_sent_at?: number
}
export interface WebhooksResponse {
  webhooks: Webhook[]
  known_events: string[]
  total: number
  note: string
}
export interface WebhookDelivery {
  id: string
  webhook_id: string
  event: string
  status: "ok" | "error" | "skipped"
  http_code: number
  error?: string
  started_at: number
  duration_ms: number
}
export interface WebhookDeliveriesResponse {
  webhook_id: string
  deliveries: WebhookDelivery[]
}

// Pool Models (aggregated view across all auth files registered to the global Model Registry)
export interface PoolModelProvider { name: string; count: number }
export interface PoolModelEntry {
  id: string
  display_name?: string
  type?: string
  owned_by?: string
  version?: string
  description?: string
  context_length?: number
  max_completion_tokens?: number
  total_clients: number
  available_clients: number
  quota_exceeded: number
  suspended: number
  suspended_cooldown: number
  providers?: PoolModelProvider[]
  thinking_levels?: string[]
}
export interface PoolModelsResponse { models: PoolModelEntry[]; total: number }

// System status / update
export interface SystemUpdateMeta {
  started_at: number
  ended_at: number
  duration_sec: number
  success: boolean
  exit_code: number
  image_before: string
  image_after: string
  image_changed: boolean
  trigger_content: string
}
export interface SystemStatusResponse {
  version: string
  commit: string
  build_date: string
  go_version: string
  started_at: number
  uptime_sec: number
  binary_mtime?: number
  binary_size?: number
  update_pending: boolean
  pending_since?: number
  last_update?: SystemUpdateMeta
}
export interface SystemUpdateQueuedResponse {
  status: "queued"
  message: string
  queued_at: number
}
export interface SystemUpdateLogResponse {
  log: string
  exists: boolean
  size: number
  mtime?: number
  hint?: string
}
