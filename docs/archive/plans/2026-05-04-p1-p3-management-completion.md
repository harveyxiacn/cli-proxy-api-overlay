# CPA Management P1-P3 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the remaining management-panel roadmap from the P1/P2/P3 design documents as a testable, backwards-compatible management surface.

**Architecture:** Add focused management endpoints for events, issues, alerts, analytics, API-key summaries, OAuth repair sessions, and desktop metadata. Keep existing REST endpoints and old UI entry points. Frontend adds lazy pages and shared API types, while old `/extended.html` and `/management.html` remain untouched.

**Tech Stack:** Go 1.26, Gin, existing in-memory/JSON persistence, React 18, TypeScript, TanStack Query, Vite.

---

## File map

- Create `CLIProxyAPI/internal/api/handlers/management/events.go`: SSE event bus, event token, publish helpers.
- Create `CLIProxyAPI/internal/api/handlers/management/events_test.go`: event bus and SSE token tests.
- Create `CLIProxyAPI/internal/api/handlers/management/issues_alerts.go`: issue detection, health summary, alerts, Prometheus-style metrics.
- Create `CLIProxyAPI/internal/api/handlers/management/issues_alerts_test.go`: issue/health/metrics tests.
- Modify `CLIProxyAPI/internal/api/handlers/management/auth_files.go`: expose group/tags and batch field updates.
- Create `CLIProxyAPI/internal/api/handlers/management/auth_files_fields_batch_test.go`: group/tag tests.
- Create `CLIProxyAPI/internal/api/handlers/management/oauth_repair.go`: repair session APIs.
- Create `CLIProxyAPI/internal/api/handlers/management/oauth_repair_test.go`: repair session tests.
- Create `CLIProxyAPI/internal/api/handlers/management/analytics.go`: request-history analytics endpoints using current persisted/ring data.
- Create `CLIProxyAPI/internal/api/handlers/management/analytics_test.go`: analytics tests.
- Create `CLIProxyAPI/internal/api/handlers/management/desktop.go`: desktop metadata endpoint.
- Modify `CLIProxyAPI/internal/api/server.go`: register new routes.
- Modify `frontend/src/api/types.ts`: add P1/P2/P3 response types.
- Modify `frontend/src/api/queries.ts`: add new API helpers.
- Create `frontend/src/api/events.ts`: SSE/fallback connection helper.
- Create pages: `Issues.tsx`, `Alerts.tsx`, `ApiKeys.tsx`, `Analytics.tsx`, `Jobs.tsx`, `Desktop.tsx`.
- Modify `frontend/src/App.tsx` and `frontend/src/components/layout/Sidebar.tsx`: add lazy routes and navigation.
- Modify `frontend/src/pages/Dashboard.tsx`: show health/issues summary.
- Modify `docs/DEVELOPMENT_LOG.md`: record implementation and verification.

## Tasks

### Task 1: P1 realtime events

- [x] Write `TestManagementEventBusReplayAndToken` in `events_test.go` to assert event IDs, replay, and token creation.
- [x] Run `go test ./internal/api/handlers/management -run TestManagementEventBusReplayAndToken -count=1` and confirm it fails because the event bus does not exist.
- [x] Implement `events.go` with `managementEventBus`, `PublishManagementEvent`, `PostEventsToken`, and `GetEvents`.
- [x] Publish `job.created/job.updated`, `request.recorded`, and `auth.status_changed` from existing job/request/auth code paths.
- [x] Register `/events-token` and `/events`.
- [x] Run the focused test and management package tests.

### Task 2: P1 issues, health, alerts, metrics

- [x] Write tests for needs-relogin issue detection, health critical state, and metrics output.
- [x] Run focused tests and confirm they fail because endpoints/helpers do not exist.
- [x] Implement `issues_alerts.go` with `BuildManagementIssues`, `GetIssues`, `GetHealthSummary`, `GetAlerts`, `PostAlertAck`, `PostAlertResolve`, and `GetManagementMetrics`.
- [x] Register `/issues`, `/health-summary`, `/alerts`, `/alerts/:id/ack`, `/alerts/:id/resolve`, `/metrics`.
- [x] Run focused tests and management package tests.

### Task 3: P1 account organization

- [x] Write tests proving `PATCH /auth-files/fields` saves `group/tags` and `POST /auth-files/fields-batch` can set group and add/remove tags.
- [x] Run focused tests and confirm failure.
- [x] Extend auth file entry building and field patching for `group/tags`.
- [x] Implement `PostAuthFilesFieldsBatch`.
- [x] Register `/auth-files/fields-batch`.
- [x] Run focused tests and management package tests.

### Task 4: P1 OAuth repair session foundation

- [x] Write tests for creating, reading, cancelling, and warmup-marking an OAuth repair session.
- [x] Run focused tests and confirm failure.
- [x] Implement `oauth_repair.go` with in-memory expiring sessions and provider URL dispatch.
- [x] Register `/oauth/repair-session`, `/oauth/sessions/:id`, `/oauth/sessions/:id/warmup`, `/oauth/sessions/:id/cancel`.
- [x] Run focused tests and management package tests.

### Task 5: P2 analytics and API-key management UI support

- [x] Write tests for daily usage aggregation and API-key summary shape using current request history/token stats.
- [x] Run focused tests and confirm failure.
- [x] Implement `analytics.go` with `/analytics/usage-daily`, `/analytics/top-auths`, `/analytics/errors`, `/analytics/storage-summary`, and `/routing/explain`.
- [x] Add API-key frontend summary helpers without changing proxy authentication semantics.
- [x] Register analytics and routing explain endpoints.
- [x] Run focused tests and management package tests.

### Task 6: P2/P3 frontend pages

- [x] Add TypeScript types and query helpers for events, issues, alerts, analytics, API keys, OAuth repair, and desktop.
- [x] Add lazy pages and navigation entries.
- [x] Add health/issues panel to Dashboard.
- [x] Build with `pnpm build`.

### Task 7: P3 desktop metadata and legacy validation

- [x] Write test that desktop metadata includes `/management/`, `/extended.html`, and `/management.html`.
- [x] Implement `GetDesktopInfo`.
- [x] Register `/desktop/info`.
- [x] Add Desktop page showing browser mode, legacy links, and fallback instructions.
- [x] Verify old entry files still exist in the outer project root.

### Task 8: Final verification and log

- [x] Run `gofmt` on modified Go files.
- [x] Run `go test ./internal/api/handlers/management -count=1`.
- [x] Run `go test ./internal/api -run "TestRedisProtocol_AUTH_IPBan|TestRedisProtocol_LOCALHOST_AUTH|TestRedisProtocol_IPBan" -count=1`.
- [x] Run `pnpm build`.
- [x] Refresh `CLIProxyAPI/internal/api/frontend_dist/` from `frontend/dist`.
- [x] Run `go build -tags embed_frontend -o ..\cli-proxy-api-test.exe .\cmd\server`.
- [x] Remove `cli-proxy-api-test.exe`.
- [x] Append implementation results to `docs/DEVELOPMENT_LOG.md`.
