# CPA P0 Management Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve CPA management daily operations by adding reliable batch APIs, safer localhost auth failure behavior, request-history time filters, and a first token chart.

**Architecture:** Keep the current REST management API and React SPA. Add small backend endpoints and query filters, then update frontend callers to use those endpoints. Avoid new storage dependencies in this P0A pass.

**Tech Stack:** Go 1.26, Gin, React 18, TypeScript, TanStack Query, Recharts, Vite.

---

## File map

- `CLIProxyAPI/internal/api/handlers/management/handler.go`: adjust management auth failure accounting.
- `CLIProxyAPI/internal/api/handlers/management/handler_test.go`: verify localhost is not banned and remote clients still are.
- `CLIProxyAPI/internal/api/handlers/management/auth_files.go`: add `PostStatusAuthFilesBatch`.
- `CLIProxyAPI/internal/api/handlers/management/auth_files_batch_test.go`: verify batch status API.
- `CLIProxyAPI/internal/api/handlers/management/request_log_store.go`: add `after_ts` and `before_ts` filtering.
- `CLIProxyAPI/internal/api/handlers/management/request_log_store_test.go`: verify time filters.
- `CLIProxyAPI/internal/api/server.go`: register `/auth-files/status-batch`.
- `frontend/src/api/types.ts`: add batch response type and request-history filter fields.
- `frontend/src/api/queries.ts`: add `patchAuthFileStatusBatch`, `deleteAuthFilesBatch`, and time params.
- `frontend/src/pages/Accounts.tsx`: replace batch loops with batch APIs.
- `frontend/src/pages/Duplicates.tsx`: replace cleanup loops with batch delete API.
- `frontend/src/pages/RequestHistory.tsx`: add datetime range filters.
- `frontend/src/pages/TokenStats.tsx`: add Recharts Top 10 account bar chart.
- `docs/DEVELOPMENT_LOG.md`: append this implementation log.

## Tasks

### Task 1: Backend tests for management auth and batch APIs

- [x] Change `handler_test.go` so localhost wrong keys do not ban a later correct key.
- [x] Keep or add a separate test proving a non-local client is still banned after 5 failures.
- [x] Add `TestPostStatusAuthFilesBatch_UpdatesMultipleFiles`.
- [x] Add `TestGetRequestHistory_TimeRangeFilters`.
- [x] Run:

```powershell
go test ./internal/api/handlers/management -run "TestAuthenticateManagementKey|TestPostStatusAuthFilesBatch|TestGetRequestHistory_TimeRangeFilters" -count=1
```

Expected before implementation: failure for the new localhost and missing endpoint behaviors.

### Task 2: Backend implementation

- [x] Update `AuthenticateManagementKey` so `fail()` returns remaining attempts and skips counting for localhost.
- [x] Add `PostStatusAuthFilesBatch` by reusing the same update path as `PatchAuthFileStatus`.
- [x] Register `POST /auth-files/status-batch`.
- [x] Add `after_ts` and `before_ts` filtering in `GetRequestHistory`.
- [x] Run the focused management tests and `gofmt`.

### Task 3: Frontend API client and pages

- [x] Add `BatchAuthFilesResponse`.
- [x] Add `patchAuthFileStatusBatch` and `deleteAuthFilesBatch`.
- [x] Update `fetchRequestHistory` to pass `after_ts` and `before_ts`.
- [x] Update `Accounts.tsx` batch enable/disable/delete handlers.
- [x] Update `Duplicates.tsx` cleanup handlers.
- [x] Update `RequestHistory.tsx` datetime filters.
- [x] Add a Recharts Top 10 Token chart to `TokenStats.tsx`.

### Task 4: Verification and log

- [x] Run frontend build:

```powershell
pnpm build
```

- [x] Run focused Go tests:

```powershell
go test ./internal/api/handlers/management -count=1
```

- [x] Run Go build:

```powershell
go build -o ..\cli-proxy-api-test.exe .\cmd\server
```

- [x] Remove `cli-proxy-api-test.exe` if build succeeds.
- [x] Append the implementation result to `docs/DEVELOPMENT_LOG.md`.
