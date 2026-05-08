# CPA P0B Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist request history and token statistics across CPA restarts without adding a new database dependency.

**Architecture:** Store request history as append-only JSONL and token stats as a compact JSON snapshot under `<config dir>/data`. Configure persistence from the management handler when `configFilePath` is available.

**Tech Stack:** Go 1.26 standard library, existing Gin management handlers, React UI text updates.

---

## File map

- `CLIProxyAPI/internal/api/handlers/management/request_log_store.go`: add JSONL append/load/clear support.
- `CLIProxyAPI/internal/api/handlers/management/token_stats.go`: add snapshot save/load/clear support.
- `CLIProxyAPI/internal/api/handlers/management/handler.go`: configure persistence path from config directory.
- `CLIProxyAPI/internal/api/handlers/management/usage_persistence_test.go`: verify request JSONL and token snapshot restore.
- `frontend/src/pages/RequestHistory.tsx`: update persistence explanatory text.
- `frontend/src/pages/TokenStats.tsx`: update process-only explanatory text.
- `docs/DEVELOPMENT_LOG.md`: append P0B results.

## Tasks

### Task 1: Failing tests

- [x] Add a test that writes request records to JSONL and loads them newest-first into a ring buffer.
- [x] Add a test that saves a token stats snapshot and restores it into a fresh plugin.
- [x] Run:

```powershell
go test ./internal/api/handlers/management -run "TestRequestHistoryPersistence|TestTokenStatsPersistence" -count=1
```

Expected before implementation: build failure or missing function failure.

### Task 2: Backend persistence

- [x] Implement request history JSONL helpers.
- [x] Implement token stats snapshot helpers.
- [x] Call persistence configure from `NewHandler` when `configFilePath` is set.
- [x] Ensure clear/reset handlers clear disk files.
- [x] Run focused tests.

### Task 3: Frontend text and docs

- [x] Update Request History alert to describe persisted 5000-entry history.
- [x] Update Token Stats alert to describe persisted snapshot.
- [x] Append development log entry.

### Task 4: Verification

- [x] Run `pnpm build`.
- [x] Run `go test ./internal/api/handlers/management -count=1`.
- [x] Run `go build -tags embed_frontend -o ..\cli-proxy-api-test.exe .\cmd\server`.
- [x] Refresh `CLIProxyAPI/internal/api/frontend_dist/` from `frontend/dist`.
