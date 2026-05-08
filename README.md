# cli-proxy-api-overlay

A custom React management panel + 12 ops modules layered on top of [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (CPA) via an **overlay/patch** model — upstream code is never modified directly, and we don't fork the upstream repo.

This repo intentionally does **NOT** include the upstream CPA source. You download the upstream source separately and apply our overlay onto it.

## What's inside

```
.
├── docs/                                      # Project documentation (in Chinese)
│   ├── DEVELOPMENT_LOG.md                     # 30 sections, dev log by date
│   ├── MAINTAINING.md                         # Overlay maintenance + upgrade guide
│   ├── OVERLAY_FEATURE_MODULES_DESIGN.md      # 12-module ops layer design spec
│   ├── CPA_vs_CodexManager_API_Analysis.md    # API surface comparison
│   ├── README.md                              # docs index
│   └── archive/                               # archived design plans
├── frontend/                                  # React + Vite SPA (mounts at /cpa-management)
│   ├── src/{pages,components,api,...}
│   ├── package.json, pnpm-lock.yaml
│   └── vite.config.ts, tailwind.config.js, ...
├── overlay/                                   # the CPA tree overlay (heart of project)
│   ├── files/
│   │   ├── internal/api/handlers/management/  # 47 new management endpoints (.go)
│   │   ├── internal/api/frontend_embed*.go    # SPA embedding entry points
│   │   └── sdk/cliproxy/auth/                 # SDK extensions (Manager methods)
│   ├── patches/                               # 13 git diffs against upstream files
│   ├── apply-overlay.bat                      # ✅ still works without git
│   ├── refresh-overlay.bat                    # ⚠ requires CLIProxyAPI/.git
│   ├── verify-overlay.bat                     # ⚠ requires CLIProxyAPI/.git
│   ├── selftest.bat                           # ⚠ requires CLIProxyAPI/.git
│   ├── update-cpa.bat                         # ⚠ requires CLIProxyAPI/.git
│   ├── detect-removed.{bat,ps1}               # ⚠ requires CLIProxyAPI/.git
│   └── scripts/                               # build automation
│       ├── build.bat                          # full build (Windows)
│       ├── build.sh                           # full build (Linux cross-compile)
│       └── build-dev.bat                      # fast Go-only iteration build
├── examples/
│   ├── config.example.yaml                    # template CPA config
│   └── extended.html                          # legacy standalone HTML UI
├── README.md
├── LICENSE
└── .gitignore
```

## What it adds on top of upstream CPA

A 12-module operations layer over the management panel:

| # | Module | Endpoints |
|---|--------|-----------|
| §3 | Account Health Diagnostic Center | `GET /v0/management/account-health[/:name]`, `POST .../recompute` |
| §4 | Maintenance Rules dry-run | `GET/PUT/DELETE /maintenance-rules[/:id]`, `POST .../{dry-run, apply}` |
| §5 | Token Reports Center | `GET /token-reports/{summary, by-{model, provider, api-key, account}, export.csv}` |
| §6 | API Key Insights | `GET /api-key-insights` |
| §7 | Routing Lab simulate | `POST /routing/simulate` (preserves existing `/routing/explain`) |
| §8 | Capacity Forecast | `GET /capacity-forecast` |
| §9 | Audit Log | `GET /audit-log[?filters]`, `GET /audit-log/export.csv` |
| §10 | Backup & Restore | `GET/POST /backups`, `POST /backups/:id/{preview-restore, restore}`, etc. |
| §11 | System Diagnostics | `GET /system/diagnostics`, `GET /system/diagnostics/export.zip` |
| §13 | Account detail route | `/cpa-management/accounts/:encodedName` |
| §14 | SQLite analytics scaffold | `GET /analytics/storage-summary` (driver TBD) |
| extras | Upstream check + pricing view | `GET /system/check-upstream`, `GET /pricing` |

Plus:
- All 12 modules ship with React pages (sidebar + command-palette entries)
- `Manager.TriggerRefreshAllThrottled(ctx, concurrency)` SDK extension to fix bulk-refresh thundering herd at 280+ account scale
- `auditingHandler(...)` wrapper applied to ~10 destructive endpoints (auth status/delete-batch, OAuth repair, token reset, API key limit CRUD, webhook CRUD, etc.)
- Defensive UI fixes: `AuthStatusBadge` trusts current `status` over stale `statusMessage`; account-health page defends against null arrays in JSON responses

## How to build

You need:
- Go 1.24+
- Node 20+ / pnpm
- Upstream CPA source at `./CLIProxyAPI/` (not included in this repo)

```bat
:: 1. Get upstream CPA source (one-shot)
::    Either clone (gives you git history but you must remove .git/ if you want to
::    stay in pure-overlay mode), or download a release tarball:
::
::      curl -L https://github.com/router-for-me/CLIProxyAPI/archive/refs/tags/v6.10.8.tar.gz -o cpa.tar.gz
::      tar -xzf cpa.tar.gz
::      move CLIProxyAPI-6.10.8 CLIProxyAPI
::
::    (replace v6.10.8 with whatever tag you target)

:: 2. Apply our overlay onto it
overlay\apply-overlay.bat

:: 3. Build frontend + Go binary in one shot
overlay\scripts\build.bat
```

Output: `cli-proxy-api-new.exe` at the repo root. Linux build: `overlay/scripts/build.sh` produces `cli-proxy-api-linux`.

## How to upgrade upstream CPA

See [`docs/MAINTAINING.md`](docs/MAINTAINING.md) §6 — short version:

1. Download the new release tarball, extract over `CLIProxyAPI/`
2. Run `overlay\apply-overlay.bat`
3. `cd CLIProxyAPI && go test ./...`
4. `overlay\scripts\build.bat`

The bulk of overlay scripts (`refresh-overlay.bat` / `verify-overlay.bat` / `selftest.bat` / `update-cpa.bat` / `detect-removed.bat`) require `CLIProxyAPI/.git` and are not used by default. To re-enable them, see `MAINTAINING.md` §6.4.

## Cross-compile for Linux + version injection

```bash
VERSION=v6.10.8-overlay
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cd CLIProxyAPI
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags embed_frontend \
  -ldflags="-s -w -X main.Version=$VERSION -X main.Commit=$COMMIT -X main.BuildDate=$BUILD_DATE" \
  -o ../cli-proxy-api-linux ./cmd/server/
```

The `-X main.Version=...` (not `internal/buildinfo.Version`) is the upstream-specific convention — see DEVELOPMENT_LOG §30.5.

## License

MIT (consistent with upstream CPA).

## Credits

Built on top of [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — all credit for the upstream proxy goes to its authors.
