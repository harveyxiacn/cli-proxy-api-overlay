# CPA React Frontend + Backend Full Optimization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 85KB single-file extended.html with a full React + Vite + TypeScript + shadcn/ui SPA, embedded inside the CPA binary via `go:embed`, absorbing the best features of both CPA and Codex-Manager.

**Architecture:** React SPA served from Go binary via `go:embed`. All management API calls go to `/v0/management/*`. Frontend lives in `frontend/` directory; `go build` bundles it automatically after `vite build`. State: Zustand for connection config, React Query for all server data.

**Tech Stack:** React 18, Vite 5, TypeScript 5 (strict), Tailwind CSS, shadcn/ui (Radix), React Router v6, TanStack Query v5, Zustand 4, Recharts 2, Lucide React, Go 1.21+ embed.

---

## Color Palette (match existing dark theme)
```
bg:      #0f1117   card:    #1a1d27   card2:   #22263a
border:  #2d3148   accent:  #6c63ff   green:   #4ade80
warn:    #f59e0b   danger:  #ef4444   purple:  #a78bfa
```

---

## Phase 1 — Project Infrastructure

### Task 1: Initialize Vite + React + TypeScript project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/index.html`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/components.json` (shadcn config)

**Step 1: Create `frontend/package.json`**
```json
{
  "name": "cpa-management-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.2",
    "@radix-ui/react-dropdown-menu": "^2.1.2",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-progress": "^1.1.0",
    "@radix-ui/react-scroll-area": "^1.2.0",
    "@radix-ui/react-select": "^2.1.2",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-switch": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.1",
    "@radix-ui/react-toast": "^1.2.2",
    "@radix-ui/react-tooltip": "^1.1.3",
    "@tanstack/react-query": "^5.59.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "lucide-react": "^0.454.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0",
    "recharts": "^2.13.0",
    "tailwind-merge": "^2.5.4",
    "tailwindcss-animate": "^1.0.7",
    "zustand": "^5.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

**Step 2: Create `frontend/vite.config.ts`**
```typescript
import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/v0": "http://127.0.0.1:8317",
      "/extended.html": "http://127.0.0.1:8317",
    },
  },
})
```

**Step 3: Create `frontend/tsconfig.json`**
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**Step 4: Create `frontend/tsconfig.app.json`**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

**Step 5: Create `frontend/tsconfig.node.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

**Step 6: Create `frontend/tailwind.config.js`**
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:      "#0f1117",
        card:    "#1a1d27",
        card2:   "#22263a",
        border:  "#2d3148",
        accent:  "#6c63ff",
        success: "#4ade80",
        warn:    "#f59e0b",
        danger:  "#ef4444",
        text:    "#e2e8f0",
        text2:   "#94a3b8",
        text3:   "#64748b",
      },
      borderRadius: { DEFAULT: "10px" },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

**Step 7: Create `frontend/postcss.config.js`**
```javascript
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
```

**Step 8: Create `frontend/index.html`**
```html
<!doctype html>
<html lang="zh-CN" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CLIProxyAPI 管理面板</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 9: Create `frontend/components.json`** (shadcn config)
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": false
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

---

### Task 2: Global CSS + utility functions

**Files:**
- Create: `frontend/src/index.css`
- Create: `frontend/src/lib/utils.ts`

**Step 1: Create `frontend/src/index.css`**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background-color: #0f1117;
  color: #e2e8f0;
  font-family: 'Segoe UI', system-ui, sans-serif;
  min-height: 100vh;
}

::-webkit-scrollbar        { width: 6px; height: 6px; }
::-webkit-scrollbar-track  { background: #0f1117; }
::-webkit-scrollbar-thumb  { background: #2d3148; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #3d4168; }

.spin {
  display: inline-block;
  width: 14px; height: 14px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

**Step 2: Create `frontend/src/lib/utils.ts`**
```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null || n === 0) return "0"
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return String(n)
}

export function fmtUSD(v: number | null | undefined): string {
  if (v == null || v === 0) return "$0.00"
  if (v < 0.001) return `$${(v * 1000).toFixed(3)}m`
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

export function fmtDate(unix: number | null | undefined): string {
  if (!unix) return "-"
  return new Date(unix * 1000).toLocaleString("zh-CN")
}

export function fmtRelative(unix: number | null | undefined): string {
  if (!unix) return "-"
  const diff = Date.now() / 1000 - unix
  if (diff < 60)    return `${Math.floor(diff)}秒前`
  if (diff < 3600)  return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return `${Math.floor(diff / 86400)}天前`
}

export function windowLabel(minutes: number | null | undefined): string {
  if (!minutes) return ""
  if (minutes >= 7 * 24 * 60 - 10) return "7天"
  if (minutes >= 24 * 60 - 10)     return "1天"
  if (minutes >= 60 - 1)           return `${Math.round(minutes / 60)}h`
  return `${minutes}min`
}

const RELOGIN_MSGS = ["unauthorized", "refresh_token_reused", "invalid_grant", "session expired", "sign in again"]
export function needsRelogin(statusMessage: string | null | undefined): boolean {
  if (!statusMessage) return false
  const lower = statusMessage.toLowerCase()
  return RELOGIN_MSGS.some(k => lower.includes(k))
}
```

---

## Phase 2 — TypeScript API Types + Client

### Task 3: Complete API type definitions

**Files:**
- Create: `frontend/src/api/types.ts`

```typescript
// ── Connection ─────────────────────────────────────────────────────────────
export interface ConnectConfig {
  url: string
  key: string
}

// ── Auth Files ────────────────────────────────────────────────────────────
export interface AuthFile {
  id: string
  name: string
  provider: string
  email?: string
  label?: string
  status: string
  status_message?: string
  disabled: boolean
  unavailable: boolean
  success: number
  failed: number
  last_refresh?: string
  next_retry_after?: string
  priority?: number
  note?: string
  source: string
  size: number
}

export interface AuthFilesResponse {
  files: AuthFile[]
}

// ── Auth Stats ────────────────────────────────────────────────────────────
export interface RecentRequestBucket {
  time: string
  success: number
  failed: number
}

export interface AuthStatEntry {
  id: string
  provider: string
  label?: string
  email?: string
  status: string
  disabled: boolean
  unavailable: boolean
  success: number
  failed: number
  recent_requests: RecentRequestBucket[]
}

export interface AuthStatsResponse {
  auths: AuthStatEntry[]
  total_success: number
  total_failed: number
  count: number
}

// ── Quota ─────────────────────────────────────────────────────────────────
export interface QuotaWindow {
  used_percent: number
  remaining_percent: number
  window_minutes?: number
  reset_at?: number
  reset_in?: string
}

export interface ExtraQuotaWindow {
  name: string
  primary?: QuotaWindow
}

export interface RawResponseMeta {
  has_additional_rate_limits: boolean
  extra_rate_limit_keys?: string[]
}

export interface CodexQuotaEntry {
  id: string
  email?: string
  status: string
  disabled: boolean
  refresh_status: string
  primary_window?: QuotaWindow
  secondary_window?: QuotaWindow
  extra_windows?: ExtraQuotaWindow[]
  raw_meta?: RawResponseMeta
  error?: string
}

export interface QuotaSummary {
  total: number
  success: number
  failed: number
  disabled: number
  avg_primary_used: number
  avg_primary_remaining: number
  idle_count: number
  above_50pct_count: number
  below_20pct_count: number
}

export interface QuotaResponse {
  entries: CodexQuotaEntry[]
  summary: QuotaSummary
}

// ── Token Stats ───────────────────────────────────────────────────────────
export interface TokenStatEntry {
  auth_id: string
  provider?: string
  email?: string
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated_usd: number
  requests: number
  failed_requests: number
  last_used_at?: number
}

export interface TokenTotals {
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated_usd: number
  requests: number
  failed_requests: number
}

export interface TokenToday extends TokenTotals {
  date: string
}

export interface TokenStatsResponse {
  entries: TokenStatEntry[]
  totals: TokenTotals
  today: TokenToday
  started_at: number
  pricing_note: string
}

// ── Startup Snapshot ──────────────────────────────────────────────────────
export interface StartupSnapshotResponse {
  files: AuthFilesResponse
  stats: AuthStatsResponse
  token_today: TokenToday
  fetched_at: number
}

// ── Warmup ────────────────────────────────────────────────────────────────
export interface WarmupResult {
  name: string
  id: string
  email?: string
  provider: string
  ok: boolean
  message: string
  latency_ms: number
}

export interface WarmupResponse {
  results: WarmupResult[]
  total: number
  succeeded: number
  failed: number
}

// ── Refresh ───────────────────────────────────────────────────────────────
export interface RefreshAllTokensResponse {
  status: string
  queued: number
  message: string
}

// ── Logs ──────────────────────────────────────────────────────────────────
export interface LogsResponse {
  lines: string[]
  "line-count": number
  "latest-timestamp": number
}

// ── OAuth ─────────────────────────────────────────────────────────────────
export interface OAuthUrlResponse {
  url: string
  state: string
}

export interface OAuthStatusResponse {
  status: "pending" | "ok" | "error"
  error?: string
}

// ── Version ───────────────────────────────────────────────────────────────
export interface VersionHeaders {
  version: string
  commit: string
  buildDate: string
}
```

---

### Task 4: API client with React Query integration

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/queries.ts`

**Step 1: Create `frontend/src/api/client.ts`**
```typescript
import type { VersionHeaders } from "./types"

export interface ApiError extends Error {
  status: number
}

// Shared version state (written on first successful response)
export const serverVersion: VersionHeaders = { version: "", commit: "", buildDate: "" }

export async function apiFetch<T>(
  method: string,
  path: string,
  config: ConnectConfig,
  body?: unknown
): Promise<T> {
  const url = config.url.replace(/\/$/, "") + "/v0/management" + path
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: "Bearer " + config.key,
      "Content-Type": "application/json",
    },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)

  const res = await fetch(url, opts)

  // Capture version info from response headers
  const ver = res.headers.get("X-CPA-VERSION")
  if (ver) {
    serverVersion.version = ver
    serverVersion.commit = res.headers.get("X-CPA-COMMIT") ?? ""
    serverVersion.buildDate = res.headers.get("X-CPA-BUILD-DATE") ?? ""
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json() as { error: string }).error ?? msg } catch {}
    const err = new Error(msg) as ApiError
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export async function apiUpload<T>(
  path: string,
  config: ConnectConfig,
  blob: ArrayBuffer,
  filename: string
): Promise<T> {
  const url = config.url.replace(/\/$/, "") + "/v0/management" + path + "?name=" + encodeURIComponent(filename)
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + config.key, "Content-Type": "application/json" },
    body: blob,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json() as { error: string }).error ?? msg } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// Re-export ConnectConfig so client.ts is self-contained
export interface ConnectConfig { url: string; key: string }
```

**Step 2: Create `frontend/src/api/queries.ts`**
```typescript
import type { ConnectConfig } from "./client"
import { apiFetch } from "./client"
import type {
  AuthFilesResponse, AuthStatsResponse, QuotaResponse, TokenStatsResponse,
  StartupSnapshotResponse, WarmupResponse, RefreshAllTokensResponse,
  LogsResponse, OAuthUrlResponse, OAuthStatusResponse,
} from "./types"

// ── Auth Files ──────────────────────────────────────────────────────────
export const authFileKeys = {
  all: (cfg: ConnectConfig) => ["auth-files", cfg.url, cfg.key] as const,
}
export const fetchAuthFiles = (cfg: ConnectConfig) =>
  apiFetch<AuthFilesResponse>("GET", "/auth-files", cfg)

export const fetchAuthStats = (cfg: ConnectConfig) =>
  apiFetch<AuthStatsResponse>("GET", "/auth-stats", cfg)

export const fetchStartupSnapshot = (cfg: ConnectConfig) =>
  apiFetch<StartupSnapshotResponse>("GET", "/startup-snapshot", cfg)

export const refreshAllTokens = (cfg: ConnectConfig) =>
  apiFetch<RefreshAllTokensResponse>("POST", "/auth-files/refresh-all-tokens", cfg)

export const patchAuthFileStatus = (cfg: ConnectConfig, name: string, disabled: boolean) =>
  apiFetch("PATCH", "/auth-files/status", cfg, { name, disabled })

export const patchAuthFileFields = (
  cfg: ConnectConfig,
  name: string,
  fields: { label?: string; note?: string; priority?: number; proxy_url?: string; prefix?: string }
) => apiFetch("PATCH", "/auth-files/fields", cfg, { name, ...fields })

export const deleteAuthFile = (cfg: ConnectConfig, name: string) =>
  apiFetch("DELETE", `/auth-files?name=${encodeURIComponent(name)}`, cfg)

export const warmupAccounts = (cfg: ConnectConfig, names: string[]) =>
  apiFetch<WarmupResponse>("POST", "/auth-files/warmup", cfg, { names })

// ── Quota ────────────────────────────────────────────────────────────────
export const fetchCodexQuota = (cfg: ConnectConfig) =>
  apiFetch<QuotaResponse>("GET", "/codex-quota", cfg)

// ── Token Stats ──────────────────────────────────────────────────────────
export const fetchTokenStats = (cfg: ConnectConfig) =>
  apiFetch<TokenStatsResponse>("GET", "/token-stats", cfg)

export const resetTokenStats = (cfg: ConnectConfig) =>
  apiFetch("POST", "/token-stats/reset", cfg)

// ── Logs ─────────────────────────────────────────────────────────────────
export const fetchLogs = (cfg: ConnectConfig, limit = 500, after = 0) =>
  apiFetch<LogsResponse>("GET", `/logs?limit=${limit}${after ? `&after=${after}` : ""}`, cfg)

export const clearLogs = (cfg: ConnectConfig) =>
  apiFetch("DELETE", "/logs", cfg)

// ── OAuth ─────────────────────────────────────────────────────────────────
export const fetchCodexAuthUrl = (cfg: ConnectConfig) =>
  apiFetch<OAuthUrlResponse>("GET", "/codex-auth-url?is_webui=1", cfg)

export const fetchAuthStatus = (cfg: ConnectConfig, state: string) =>
  apiFetch<OAuthStatusResponse>("GET", `/get-auth-status?state=${encodeURIComponent(state)}`, cfg)
```

---

## Phase 3 — Core Layout + State + Components

### Task 5: Zustand store for connection state

**Files:**
- Create: `frontend/src/stores/connection.ts`

```typescript
import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface ConnectConfig {
  url: string
  key: string
}

interface ConnectionState {
  config: ConnectConfig
  connected: boolean
  setConfig: (config: ConnectConfig) => void
  setConnected: (v: boolean) => void
  disconnect: () => void
}

export const useConnection = create<ConnectionState>()(
  persist(
    (set) => ({
      config: { url: "http://127.0.0.1:8317", key: "" },
      connected: false,
      setConfig: (config) => set({ config }),
      setConnected: (connected) => set({ connected }),
      disconnect: () => set({ connected: false }),
    }),
    {
      name: "cpa-connection",
      partialize: (s) => ({ config: s.config }),
    }
  )
)
```

---

### Task 6: Base UI primitives (badges, cards, progress bars, modals)

**Files:**
- Create: `frontend/src/components/ui/Badge.tsx`
- Create: `frontend/src/components/ui/Card.tsx`
- Create: `frontend/src/components/ui/Progress.tsx`
- Create: `frontend/src/components/ui/Modal.tsx`
- Create: `frontend/src/components/ui/DataTable.tsx`
- Create: `frontend/src/components/ui/StatCard.tsx`
- Create: `frontend/src/components/ui/Spinner.tsx`
- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/src/components/ui/Input.tsx`
- Create: `frontend/src/components/ui/Select.tsx`
- Create: `frontend/src/components/ui/Alert.tsx`
- Create: `frontend/src/components/ui/Toast.tsx`

**`Badge.tsx`:**
```tsx
import { cn } from "@/lib/utils"

const variants = {
  default:   "bg-white/10 text-text2",
  green:     "bg-green-500/15 text-green-400",
  red:       "bg-red-500/15 text-red-400",
  yellow:    "bg-yellow-500/15 text-yellow-400",
  blue:      "bg-blue-500/15 text-blue-400",
  purple:    "bg-purple-500/15 text-purple-400",
  orange:    "bg-orange-500/15 text-orange-400",
  disabled:  "bg-slate-500/20 text-slate-400",
} as const

type Variant = keyof typeof variants

export function Badge({ variant = "default", className, children }: {
  variant?: Variant; className?: string; children: React.ReactNode
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap",
      variants[variant], className
    )}>
      {children}
    </span>
  )
}

export function AuthStatusBadge({ status, disabled, statusMessage }: {
  status?: string; disabled?: boolean; statusMessage?: string
}) {
  const { needsRelogin } = await import("@/lib/utils")
  if (disabled)                     return <Badge variant="disabled">禁用</Badge>
  if (needsRelogin(statusMessage))  return <Badge variant="orange">需重登录</Badge>
  if (status === "active")          return <Badge variant="green">active</Badge>
  if (status === "ready")           return <Badge variant="blue">ready</Badge>
  if (status === "error")           return <Badge variant="red">error</Badge>
  if (status === "unavailable")     return <Badge variant="yellow">不可用</Badge>
  return <Badge variant="yellow">{status ?? "?"}</Badge>
}
```

> **Note:** `AuthStatusBadge` uses synchronous `needsRelogin` — import directly, not dynamic.

**`Card.tsx`:**
```tsx
import { cn } from "@/lib/utils"

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("bg-card border border-border rounded-[10px] p-4 mb-3.5", className)}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between flex-wrap gap-2 mb-3 text-sm font-bold", className)}>
      {children}
    </div>
  )
}
```

**`StatCard.tsx`:**
```tsx
import { cn } from "@/lib/utils"

export function StatCard({ label, value, color, sub }: {
  label: string; value: React.ReactNode; color?: string; sub?: string
}) {
  return (
    <div className="bg-card2 border border-border rounded-[10px] p-3 text-center">
      <div className={cn("text-[1.7rem] font-extrabold leading-none", color ?? "text-text")}>
        {value}
      </div>
      <div className="text-[0.75rem] text-text2 mt-1 leading-tight">{label}</div>
      {sub && <div className="text-[0.7rem] text-text3 mt-0.5">{sub}</div>}
    </div>
  )
}

export function StatsGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-2.5 mb-4", className)}
         style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
      {children}
    </div>
  )
}
```

**`Progress.tsx`:**
```tsx
import { cn } from "@/lib/utils"
import { windowLabel } from "@/lib/utils"
import type { QuotaWindow } from "@/api/types"

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const color = value > 50 ? "bg-success" : value > 20 ? "bg-warn" : "bg-danger"
  return (
    <div className={cn("h-[7px] rounded bg-bg overflow-hidden", className)}>
      <div className={cn("h-full rounded transition-all", color)} style={{ width: `${value}%` }} />
    </div>
  )
}

export function QuotaWindowCell({ w }: { w?: QuotaWindow | null }) {
  if (!w) return <td className="text-text3 text-xs">-</td>
  const pct = w.remaining_percent
  const color = pct > 50 ? "text-green-400" : pct > 20 ? "text-yellow-400" : "text-red-400"
  const wl = windowLabel(w.window_minutes)
  const rst = w.reset_in ?? (w.reset_at ? new Date(w.reset_at * 1000).toLocaleString("zh-CN") : "-")
  return (
    <>
      <td>
        <div className="flex items-center gap-1.5 min-w-[100px]">
          <ProgressBar value={pct} className="flex-1" />
          <span className="text-[0.72rem] text-text3 whitespace-nowrap">
            {w.used_percent}%已用{wl ? ` · ${wl}` : ""}
          </span>
        </div>
      </td>
      <td><span className={cn("text-xs font-bold", color)}>{pct}%</span></td>
      <td className="text-[0.72rem] text-text3 whitespace-nowrap">{rst}</td>
    </>
  )
}
```

**`Modal.tsx`:**
```tsx
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

interface ModalProps {
  open: boolean
  title: string
  subtitle?: string
  progress?: number          // 0-100, undefined = no bar
  detail?: string
  closeable?: boolean
  onClose: () => void
  children?: React.ReactNode
}

export function Modal({ open, title, subtitle, progress, detail, closeable, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape" && closeable) onClose() }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [closeable, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/55 z-[1000] flex items-center justify-center backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget && closeable) onClose() }}>
      <div ref={ref} className="bg-card border border-border rounded-xl p-6 min-w-[360px] max-w-[560px] w-[92vw] shadow-2xl">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-bold text-base">{title}</h3>
          {closeable && (
            <button onClick={onClose} className="text-text3 hover:text-text ml-4">
              <X size={16} />
            </button>
          )}
        </div>
        {subtitle && <p className="text-sm text-text2 mb-3 min-h-[1.2em]">{subtitle}</p>}
        {progress !== undefined && (
          <div className="h-2 rounded bg-bg overflow-hidden mb-2.5">
            <div className="h-full rounded bg-accent transition-all duration-400"
                 style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        )}
        {detail && <p className="text-[0.78rem] text-text3 min-h-[1.1em] mb-1">{detail}</p>}
        {children}
      </div>
    </div>
  )
}

// Hook to manage progress-modal state
export function useProgressModal() {
  const [state, setState] = React.useState({
    open: false, title: "", subtitle: "", progress: 0, detail: "", closeable: false
  })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const show   = (title: string, subtitle = "") =>
    setState({ open: true, title, subtitle, progress: 0, detail: "", closeable: false })
  const update = (progress: number, subtitle?: string, detail = "") =>
    setState(s => ({ ...s, progress, subtitle: subtitle ?? s.subtitle, detail }))
  const finish = (subtitle = "", detail = "") => {
    if (timerRef.current) clearInterval(timerRef.current)
    setState(s => ({ ...s, progress: 100, subtitle, detail, closeable: true }))
  }
  const close  = () => setState(s => ({ ...s, open: false }))
  const animateTo = (max: number, intervalMs = 1500) => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setState(s => {
        const next = Math.min(max, s.progress + (max - s.progress) * 0.12 + 1)
        return { ...s, progress: next }
      })
    }, intervalMs)
  }
  const stopAnimation = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }

  return { state, show, update, finish, close, animateTo, stopAnimation }
}
```
> Add `import React from "react"` to Modal.tsx

**`Button.tsx`:**
```tsx
import { cn } from "@/lib/utils"

const variants = {
  primary: "bg-accent text-white hover:bg-accent/80",
  success: "bg-green-700 text-white hover:bg-green-800",
  danger:  "bg-red-700 text-white hover:bg-red-800",
  warn:    "bg-amber-700 text-white hover:bg-amber-800",
  ghost:   "bg-card2 text-text border border-border hover:bg-border",
} as const

export function Button({ variant = "ghost", size = "md", disabled, onClick, className, children }: {
  variant?: keyof typeof variants
  size?: "sm" | "md"
  disabled?: boolean
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[7px] font-semibold whitespace-nowrap transition-all",
        "disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer",
        size === "sm" ? "px-2 py-1 text-[0.76rem]" : "px-3 py-1.5 text-[0.83rem]",
        variants[variant], className
      )}
    >
      {children}
    </button>
  )
}
```

**`Spinner.tsx`:**
```tsx
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span className="spin" style={{ width: size, height: size, borderWidth: Math.max(2, size / 7) }} />
  )
}
```

**`Input.tsx`:**
```tsx
import { cn } from "@/lib/utils"
import { forwardRef } from "react"

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "bg-bg border border-border rounded-md text-text px-2.5 py-1.5 text-[0.85rem]",
        "focus:outline-none focus:border-accent placeholder:text-text3",
        className
      )}
      {...props}
    />
  )
)
Input.displayName = "Input"
```

**`Alert.tsx`:**
```tsx
import { cn } from "@/lib/utils"

const styles = {
  info:    "bg-blue-500/10 border-blue-500/30 text-blue-300",
  success: "bg-green-500/10 border-green-500/30 text-green-400",
  warn:    "bg-yellow-500/10 border-yellow-500/30 text-yellow-300",
  error:   "bg-red-500/10 border-red-500/30 text-red-300",
} as const

export function Alert({ type = "info", children, className }: {
  type?: keyof typeof styles; children: React.ReactNode; className?: string
}) {
  return (
    <div className={cn("px-3 py-2 rounded-[7px] border text-[0.84rem] mb-2.5", styles[type], className)}>
      {children}
    </div>
  )
}
```

---

### Task 7: App shell — sidebar navigation + routing

**Files:**
- Create: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/layout/Header.tsx`
- Create: `frontend/src/components/layout/AppLayout.tsx`
- Create: `frontend/src/components/layout/ConnectBar.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/main.tsx`

**`ConnectBar.tsx`:**
```tsx
import { useState } from "react"
import { useConnection } from "@/stores/connection"
import { fetchStartupSnapshot } from "@/api/queries"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"

export function ConnectBar() {
  const { config, setConfig, connected, setConnected } = useConnection()
  const [url,  setUrl]  = useState(config.url)
  const [key,  setKey]  = useState(config.key)
  const [err,  setErr]  = useState("")
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const connect = async () => {
    if (!url || !key) { setErr("请填写地址和密钥"); return }
    setBusy(true); setErr("")
    const cfg = { url: url.replace(/\/$/, ""), key }
    try {
      await fetchStartupSnapshot(cfg)
      setConfig(cfg)
      setConnected(true)
      qc.invalidateQueries()
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="flex gap-2 flex-wrap items-center bg-card border border-border rounded-[10px] p-3 mb-4">
      <Input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="CPA 地址 http://127.0.0.1:8317"
        className="flex-1 min-w-[180px]"
      />
      <Input
        type="password"
        value={key}
        onChange={e => setKey(e.target.value)}
        onKeyDown={e => e.key === "Enter" && connect()}
        placeholder="管理密钥"
        className="flex-1 min-w-[150px]"
      />
      <Button variant="primary" onClick={connect} disabled={busy}>
        {busy ? "连接中…" : "连接"}
      </Button>
      {err && <span className="text-[0.83rem] text-danger">{err}</span>}
    </div>
  )
}
```

**`Sidebar.tsx`:**
```tsx
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard, FileKey2, Zap, BarChart3,
  MessageSquareCode, ScrollText, Settings, Copy
} from "lucide-react"

const nav = [
  { to: "/",          icon: LayoutDashboard,    label: "仪表盘"    },
  { to: "/accounts",  icon: FileKey2,            label: "授权文件"  },
  { to: "/quota",     icon: Zap,                 label: "Codex 配额" },
  { to: "/tokens",    icon: BarChart3,           label: "Token 统计" },
  { to: "/oauth",     icon: MessageSquareCode,   label: "OAuth 登录" },
  { to: "/logs",      icon: ScrollText,          label: "日志"       },
  { to: "/duplicates",icon: Copy,               label: "重复检测"   },
  { to: "/settings",  icon: Settings,            label: "设置"       },
]

export function Sidebar() {
  return (
    <nav className="w-52 shrink-0 bg-card border-r border-border flex flex-col py-4 gap-1">
      <div className="px-4 mb-4">
        <h1 className="font-bold text-sm">
          CLI<span className="text-accent">Proxy</span>API
        </h1>
        <p className="text-[0.7rem] text-text3 mt-0.5">管理面板</p>
      </div>
      {nav.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            cn("flex items-center gap-2.5 px-4 py-2 mx-2 rounded-[7px] text-[0.85rem] transition-all",
              isActive
                ? "bg-accent/20 text-accent font-semibold"
                : "text-text2 hover:bg-card2 hover:text-text"
            )
          }
        >
          <Icon size={15} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
```

**`Header.tsx`:**
```tsx
import { useConnection } from "@/stores/connection"
import { serverVersion } from "@/api/client"

export function Header() {
  const { connected } = useConnection()
  return (
    <header className="bg-card border-b border-border px-5 py-3 flex items-center justify-between sticky top-0 z-50">
      <span className="text-sm font-semibold text-text2">CLIProxyAPI 扩展管理面板</span>
      <div className="flex items-center gap-3">
        {serverVersion.version && (
          <span className="text-[0.7rem] text-text3">v{serverVersion.version}</span>
        )}
        <span className={cn(
          "text-xs px-2 py-0.5 rounded-full font-semibold",
          connected ? "bg-green-500/15 text-green-400" : "bg-slate-500/20 text-slate-400"
        )}>
          {connected ? "已连接" : "未连接"}
        </span>
      </div>
    </header>
  )
}

// need cn import
import { cn } from "@/lib/utils"
```

**`AppLayout.tsx`:**
```tsx
import { Sidebar } from "./Sidebar"
import { Header } from "./Header"
import { ConnectBar } from "./ConnectBar"
import { useConnection } from "@/stores/connection"

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { connected } = useConnection()
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-4 max-w-[1600px] w-full mx-auto">
          {!connected && <ConnectBar />}
          {children}
        </main>
      </div>
    </div>
  )
}
```

**`App.tsx`:**
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AppLayout } from "@/components/layout/AppLayout"
import { Dashboard }   from "@/pages/Dashboard"
import { Accounts }    from "@/pages/Accounts"
import { Quota }       from "@/pages/Quota"
import { TokenStats }  from "@/pages/TokenStats"
import { OAuth }       from "@/pages/OAuth"
import { Logs }        from "@/pages/Logs"
import { Duplicates }  from "@/pages/Duplicates"
import { Settings }    from "@/pages/Settings"

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/"           element={<Dashboard />} />
            <Route path="/accounts"   element={<Accounts />} />
            <Route path="/quota"      element={<Quota />} />
            <Route path="/tokens"     element={<TokenStats />} />
            <Route path="/oauth"      element={<OAuth />} />
            <Route path="/logs"       element={<Logs />} />
            <Route path="/duplicates" element={<Duplicates />} />
            <Route path="/settings"   element={<Settings />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

**`main.tsx`:**
```tsx
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

---

## Phase 4 — Pages

### Task 8: Dashboard page

**File:** `frontend/src/pages/Dashboard.tsx`

Features to implement:
- Uses `startup-snapshot` to load all data in one RTT on connect
- Today's token cards: total/input/output/cached/reasoning/cost/requests/failed
- Account health overview: total/healthy/error/needs-relogin/disabled
- Quick Actions: refresh all tokens (with progress modal), warmup all, refresh quota
- Refresh results breakdown (success/relogin/error/skipped groups)
- Auto-refresh checkbox (30s)

```tsx
import { useEffect, useState, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import {
  fetchStartupSnapshot, refreshAllTokens, fetchAuthFiles, warmupAccounts
} from "@/api/queries"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { Card, CardTitle }    from "@/components/ui/Card"
import { Button }             from "@/components/ui/Button"
import { Alert }              from "@/components/ui/Alert"
import { Modal, useProgressModal } from "@/components/ui/Modal"
import { Badge }              from "@/components/ui/Badge"
import { Spinner }            from "@/components/ui/Spinner"
import { fmtTokens, fmtUSD, needsRelogin, fmtRelative } from "@/lib/utils"
import type { AuthFile, WarmupResult } from "@/api/types"

export function Dashboard() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const modal = useProgressModal()
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshResults, setRefreshResults] = useState<null | {
    success: AuthFile[]; relogin: AuthFile[]; failed: AuthFile[]; skipped: AuthFile[]
  }>(null)

  // Startup snapshot (fast init)
  const snap = useQuery({
    queryKey: ["startup-snapshot", config.url, config.key],
    queryFn: () => fetchStartupSnapshot(config),
    enabled: connected,
    staleTime: 20_000,
  })

  // Auto-refresh interval
  const arTimer = useRef<ReturnType<typeof setInterval>>()
  useEffect(() => {
    if (autoRefresh && connected) {
      arTimer.current = setInterval(() => {
        qc.invalidateQueries({ queryKey: ["startup-snapshot"] })
      }, 30_000)
    }
    return () => clearInterval(arTimer.current)
  }, [autoRefresh, connected, qc])

  // Derived stats from snapshot
  const files = snap.data?.files.files ?? []
  const stats = snap.data?.stats
  const today = snap.data?.token_today

  const healthy  = files.filter(f => ["active","ready"].includes(f.status) && !f.disabled).length
  const disabled = files.filter(f => f.disabled).length
  const errored  = files.filter(f => !["active","ready"].includes(f.status) && !f.disabled && !!f.status).length
  const relogin  = files.filter(f => needsRelogin(f.status_message)).length
  const codex    = files.filter(f => f.provider?.toLowerCase() === "codex").length

  // Refresh all tokens mutation
  const refreshMut = useMutation({
    mutationFn: async () => {
      // Snapshot before
      const before = new Map(files.map(f => [f.name, { status: f.status, msg: f.status_message }]))

      modal.show("刷新全部 Token", "正在触发刷新…")
      modal.animateTo(85, 1500)

      const r = await refreshAllTokens(config)
      modal.update(50, `⚡ 已触发 ${r.queued} 个凭证，等待完成…`)

      // Wait 8s then reload
      await new Promise(res => setTimeout(res, 8000))
      modal.stopAnimation()

      const fr = await fetchAuthFiles(config)
      const after = fr.files

      // Diff
      const result = { success: [] as AuthFile[], relogin: [] as AuthFile[], failed: [] as AuthFile[], skipped: [] as AuthFile[] }
      for (const f of after) {
        if (f.disabled)              { result.skipped.push(f); continue }
        if (needsRelogin(f.status_message)) { result.relogin.push(f); continue }
        const hasErr = !!f.status_message || (!!f.status && !["active","ready"].includes(f.status))
        if (hasErr) { result.failed.push(f); continue }
        const prev = before.get(f.name)
        const wasErr = !!prev?.msg || (!!prev?.status && !["active","ready"].includes(prev.status))
        if (wasErr) result.success.push(f)
      }

      return result
    },
    onSuccess: (result) => {
      const bad = result.relogin.length + result.failed.length
      modal.finish(
        `完成：✓ ${result.success.length} 个恢复  ⚠ ${result.relogin.length} 个需重登  ✗ ${result.failed.length} 个失败`,
        bad > 0 ? "展开下方分组查看详情" : "所有账号均正常"
      )
      setRefreshResults(result)
      qc.invalidateQueries({ queryKey: ["startup-snapshot"] })
    },
    onError: (e: Error) => {
      modal.stopAnimation()
      modal.finish("✗ 失败: " + e.message)
    },
  })

  if (!connected) return (
    <Alert type="info">请在顶部填写 CPA 地址和管理密钥后点击「连接」。</Alert>
  )

  return (
    <div>
      {/* Account health summary */}
      <StatsGrid>
        <StatCard label="授权文件总数"         value={files.length}  color="text-blue-400" />
        <StatCard label="正常 (active/ready)"  value={healthy}       color="text-green-400" />
        <StatCard label="错误/不可用"           value={errored}       color="text-red-400" />
        <StatCard label="需要重新登录"          value={relogin}       color="text-orange-400" />
        <StatCard label="已禁用"               value={disabled}      color="text-yellow-400" />
        <StatCard label="Codex Token"          value={codex}         color="text-purple-400" />
        <StatCard label="累计成功请求"          value={stats?.total_success ?? 0} color="text-green-400" />
        <StatCard label="累计失败请求"          value={stats?.total_failed  ?? 0} color="text-red-400" />
      </StatsGrid>

      {/* Today's token stats */}
      {today && (today.total_tokens > 0 || today.requests > 0) && (
        <Card>
          <CardTitle>
            <span>📊 今日 Token 统计</span>
            <span className="text-[0.72rem] text-text3 font-normal">{today.date}</span>
          </CardTitle>
          <StatsGrid>
            <StatCard label="今日 Tokens" value={fmtTokens(today.total_tokens)} color="text-blue-400" sub="输入+输出" />
            <StatCard label="输入 Tokens" value={fmtTokens(today.input_tokens)} color="text-green-400" />
            <StatCard label="输出 Tokens" value={fmtTokens(today.output_tokens)} color="text-purple-400" />
            <StatCard label="缓存命中"   value={fmtTokens(today.cached_tokens)} color="text-yellow-400" sub="上下文缓存" />
            <StatCard label="推理 Tokens" value={fmtTokens(today.reasoning_tokens)} color="text-violet-400" sub="思考过程" />
            <StatCard label="预估费用"   value={fmtUSD(today.estimated_usd)} color="text-emerald-400" sub="官方定价" />
            <StatCard label="今日请求"   value={today.requests}       color="text-green-400" />
            <StatCard label="今日失败"   value={today.failed_requests} color="text-red-400" />
          </StatsGrid>
          <p className="text-[0.74rem] text-text3">
            Codex OAuth 账号消耗的是免费配额，费用仅为参考（按 OpenAI 官方 API 定价换算）
          </p>
        </Card>
      )}

      {/* Quick Actions */}
      <Card>
        <CardTitle>快速操作</CardTitle>
        <div className="flex gap-2 flex-wrap items-center">
          <Button variant="primary" onClick={() => qc.invalidateQueries({ queryKey: ["startup-snapshot"] })}>
            🔄 刷新仪表盘
          </Button>
          <Button variant="success" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
            {refreshMut.isPending ? <><Spinner /> 刷新中…</> : "⚡ 刷新全部 Token"}
          </Button>
          <label className="flex items-center gap-1.5 text-[0.83rem] text-text2 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-accent" />
            自动刷新 (30s)
          </label>
        </div>
      </Card>

      {/* Refresh results */}
      {refreshResults && (
        <RefreshResultsPanel results={refreshResults} onClose={() => setRefreshResults(null)} />
      )}

      <Modal {...modal.state} onClose={modal.close} />
    </div>
  )
}

function RefreshResultsPanel({ results, onClose }: {
  results: { success: AuthFile[]; relogin: AuthFile[]; failed: AuthFile[]; skipped: AuthFile[] }
  onClose: () => void
}) {
  return (
    <Card>
      <CardTitle>
        刷新结果详情
        <Button variant="ghost" size="sm" onClick={onClose}>✕ 关闭</Button>
      </CardTitle>
      <ResultGroup title={`⚠ 需要重新登录 (${results.relogin.length})`}  items={results.relogin}  color="text-orange-400" />
      <ResultGroup title={`✗ 刷新失败 (${results.failed.length})`}        items={results.failed}   color="text-red-400" />
      <ResultGroup title={`✓ 刷新成功，已恢复 (${results.success.length})`} items={results.success}  color="text-green-400" />
      <ResultGroup title={`→ 已跳过，禁用账号 (${results.skipped.length})`} items={results.skipped}  color="text-text3" />
    </Card>
  )
}

function ResultGroup({ title, items, color }: { title: string; items: AuthFile[]; color: string }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <div className="border border-border rounded-lg mb-2 overflow-hidden">
      <button className="w-full flex items-center gap-2 px-3 py-2 bg-card2 text-left hover:bg-card2/80"
              onClick={() => setOpen(o => !o)}>
        <span className={`text-sm font-semibold ${color}`}>{title}</span>
        <span className="ml-auto text-text3 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-card2">
              <th className="text-left px-2 py-1.5 text-text3">邮箱/文件</th>
              <th className="text-left px-2 py-1.5 text-text3">状态</th>
              <th className="text-left px-2 py-1.5 text-text3">错误信息</th>
            </tr>
          </thead>
          <tbody>
            {items.map(f => (
              <tr key={f.name} className="border-t border-border">
                <td className="px-2 py-1.5 text-text2">{f.email || f.name}</td>
                <td className="px-2 py-1.5">
                  <Badge variant={f.status === "active" ? "green" : f.status === "ready" ? "blue" : "red"}>
                    {f.status}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 text-yellow-400">{f.status_message || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

---

### Task 9: Accounts (Auth File Management) page

**File:** `frontend/src/pages/Accounts.tsx`

Features:
- Full table: name/provider/email/label/status/error/success/failed/last_refresh/next_retry/actions
- Column sort (click header)
- Filter bar: provider, email, status (all/problem/relogin/active/ready/disabled)
- Quick-select: "⚡选需重登录" / "⚠选问题账号"
- Batch bar: enable/disable/delete selected
- Per-row actions: enable/disable toggle, warmup, delete
- Inline label edit (click label cell → input)
- Upload area for JSON files (drag & drop)
- Warmup modal with per-account results
- Duplicate detection sub-panel (reuse from Duplicates page)
- "刷新全部Token后重查" combo button

```tsx
// [Full implementation ~400 lines - see detailed spec below]

// Key hooks needed:
// useAuthFiles() → useQuery for /auth-files
// usePatchStatus(name, disabled) → mutation
// useDeleteFile(name) → mutation
// useWarmup(names) → mutation with modal

// Key states:
// sortCol, sortDir
// filter: { provider, email, status }
// selectedNames: Set<string>
// showDupPanel: boolean
// labelEditId: string | null

// Warmup result display in a Modal with per-account table:
// OK rows: green check
// FAIL rows: red X + message
```

Full implementation for Accounts.tsx focuses on these components:
- `<AccountsTable files={filtered} sort={...} onSort={...} selected={...} ... />`
- `<AccountRow file={f} selected={...} onToggle={...} onWarmup={...} ... />`
- `<FilterBar filter={...} onChange={...} />`
- `<BatchBar count={N} onEnable onDisable onDelete onClear />`
- `<UploadArea onFiles={...} />`
- `<WarmupModal results={...} open={...} onClose={...} />`

---

### Task 10: Codex Quota page

**File:** `frontend/src/pages/Quota.tsx`

Features:
- Distribution bar (>50% green / 20-50% yellow / <20% red / expired orange / disabled gray)
- Summary stat cards
- Table with dynamic columns (primary, secondary if exists, Code Review if exists, others)
- Per-window type label (7天/5h/1天) from `window_minutes`
- "⚠ 需刷新" explanation alert with "🔁 刷新Token后重查" button
- Warmup + reload combo (refresh tokens → 8s wait → reload quota)
- Progress modal for quota loading

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchCodexQuota, refreshAllTokens } from "@/api/queries"
import { apiFetch } from "@/api/client"
import { Modal, useProgressModal } from "@/components/ui/Modal"
import { Card, CardTitle }  from "@/components/ui/Card"
import { Button }           from "@/components/ui/Button"
import { Badge }            from "@/components/ui/Badge"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { ProgressBar, QuotaWindowCell } from "@/components/ui/Progress"
import { Alert } from "@/components/ui/Alert"
import { windowLabel } from "@/lib/utils"
import type { CodexQuotaEntry, QuotaWindow } from "@/api/types"

export function Quota() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const modal = useProgressModal()

  const quotaQuery = useQuery({
    queryKey: ["codex-quota", config.url, config.key],
    queryFn: () => {
      modal.show("查询 Codex 配额", "并发查询各账号额度，请稍候…")
      modal.animateTo(90, 2000)
      return fetchCodexQuota(config).then(r => { modal.stopAnimation(); modal.finish("查询完成"); return r })
    },
    enabled: false, // manual trigger only
  })

  const refreshThenQuery = async () => {
    modal.show("刷新Token后重查配额", "步骤 1/2 — 刷新全部 Token…")
    modal.animateTo(45, 1500)
    await refreshAllTokens(config)
    modal.stopAnimation()
    modal.update(50, "步骤 2/2 — 等待令牌刷新完成…")
    await new Promise(res => setTimeout(res, 8000))
    modal.animateTo(90, 1500)
    const data = await fetchCodexQuota(config)
    modal.stopAnimation()
    modal.finish(`完成：${data.summary.success} 个有额度  ${data.summary.failed} 个失败`)
    qc.setQueryData(["codex-quota", config.url, config.key], data)
  }

  const entries = quotaQuery.data?.entries ?? []
  const summary = quotaQuery.data?.summary

  // Column visibility
  const hasSecondary = entries.some(e => e.secondary_window != null)
  const hasCR        = entries.some(e => e.extra_windows?.some(w => w.name.toLowerCase().includes("code review")))
  const hasOther     = entries.some(e => (e.extra_windows ?? []).some(w =>
    !w.name.toLowerCase().includes("code review") && !w.name.includes("长周期")))
  const failedCount  = entries.filter(e => !e.disabled && !!e.error).length

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          Codex 配额详情
          <div className="flex gap-2">
            <Button variant="primary"  onClick={() => quotaQuery.refetch()}>🔄 刷新配额</Button>
            <Button variant="warn" size="sm" onClick={refreshThenQuery}>🔁 刷新Token后重查</Button>
          </div>
        </CardTitle>

        <Alert type="info" className="text-[0.8rem]">
          进度条内标签自动显示窗口时长（<b>7天</b> = free；<b>5h</b> = 付费主窗口）。
          Code Review 仅在 API 返回 additional_rate_limits 时显示。
        </Alert>

        {/* Distribution bar */}
        {summary && <QuotaDistribution entries={entries} />}

        {/* Failure hint */}
        {failedCount > 0 && (
          <Alert type="warn" className="text-[0.8rem] mt-2">
            ⚠ <b>{failedCount}</b> 个账号显示「需刷新/错误」：查询时 access_token 已过期（401）。
            点击「<b>🔁 刷新Token后重查</b>」自动解决。若仍失败 → refresh_token 也已失效 → 需重新 OAuth 登录。
          </Alert>
        )}

        {summary && <StatsGrid className="mt-3">
          <StatCard label="Codex 账号"   value={summary.total}               color="text-blue-400" />
          <StatCard label="查询成功"      value={summary.success}             color="text-green-400" />
          <StatCard label="查询失败"      value={summary.failed}              color="text-red-400" />
          <StatCard label="已禁用"        value={summary.disabled}            color="text-yellow-400" />
          <StatCard label="剩余 >50%"    value={summary.above_50pct_count}   color="text-green-400" />
          <StatCard label="剩余 <20%"    value={summary.below_20pct_count}   color="text-red-400" />
          <StatCard label="平均剩余"     value={`${summary.avg_primary_remaining}%`} color="text-blue-400" />
        </StatsGrid>}

        <div className="overflow-x-auto mt-3">
          <table className="w-full text-[0.82rem] border-collapse">
            <thead>
              <tr className="bg-card2">
                <th className="text-left px-2 py-2 text-text3">邮箱 / ID</th>
                <th className="px-2 py-2 text-text3">状态</th>
                <th className="px-2 py-2 text-text3 text-left">主配额</th>
                <th className="px-2 py-2 text-text3">剩余%</th>
                <th className="px-2 py-2 text-text3">重置时间</th>
                {hasSecondary && <>
                  <th className="px-2 py-2 text-text3 text-left">次配额</th>
                  <th className="px-2 py-2 text-text3">次剩余%</th>
                  <th className="px-2 py-2 text-text3">次重置</th>
                </>}
                {hasCR && <>
                  <th className="px-2 py-2 text-text3 text-left">Code Review</th>
                  <th className="px-2 py-2 text-text3">CR剩余%</th>
                  <th className="px-2 py-2 text-text3">CR重置</th>
                </>}
                {hasOther && <th className="px-2 py-2 text-text3">其他额度</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <QuotaRow
                  key={e.id} entry={e}
                  hasSecondary={hasSecondary} hasCR={hasCR} hasOther={hasOther}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal {...modal.state} onClose={modal.close} />
    </div>
  )
}
```

---

### Task 11: Token Stats page

**File:** `frontend/src/pages/TokenStats.tsx`

Features:
- Today stats: big stat cards (matches Codex-Manager dashboard style)
- Lifetime stats table (per auth, sortable by tokens)
- Cost breakdown with model pricing note
- Recharts AreaChart for today's token accumulation (if we add hourly buckets — future)
- Reset button with confirmation
- Auto-refresh toggle

---

### Task 12: Server Logs page

**File:** `frontend/src/pages/Logs.tsx`

Features:
- Log viewer with color-coded lines (info=blue/warn=yellow/error=red/debug=gray)
- Incremental polling (`after=timestamp`)
- Local keyword + level filter
- Follow toggle (auto-scroll)
- Clear logs button
- Auto-poll toggle (10s interval)
- Max lines display cap (2000)

---

### Task 13: OAuth login page

**File:** `frontend/src/pages/OAuth.tsx`

Features:
- Codex OAuth flow (start → show URL → poll status → done)
- Upload JSON files drag-and-drop
- Status indicators (pending/success/error)
- Auto open URL in new tab

---

### Task 14: Duplicate Detection page

**File:** `frontend/src/pages/Duplicates.tsx`

Features:
- Group auth files by email
- Show groups with ≥2 files
- Per-group: filename cleanliness scoring (run002, (1) suffixes detected)
- Recommend which to keep (highest score)
- Per-group "保留最优删其余" button
- "一键清理全部" button
- Expandable detail rows with full scoring breakdown

---

### Task 15: Settings page

**File:** `frontend/src/pages/Settings.tsx`

Features:
- Connection config display
- Proxy URL configuration
- Routing strategy selector
- Auto-refresh interval config
- Debug mode toggle
- Log file config
- Server version info

---

## Phase 5 — New Go Backend APIs

### Task 16: Persistent request log middleware

**Files:**
- Create: `CLIProxyAPI/internal/api/handlers/management/request_log_store.go`
- Modify: `CLIProxyAPI/internal/api/server.go` (register middleware + routes)

This is the biggest missing feature vs Codex-Manager. Implementation:

```go
// In-memory ring buffer for request logs (no SQLite required)
// Stores last 10,000 requests with: timestamp, model, provider, auth_id,
// input_tokens, output_tokens, cached_tokens, latency_ms, status_code, error
// Exposed via GET /v0/management/request-history?limit=N&after=ts&model=xxx
// The usage.Plugin already gets called per request — just save to ring buffer

type RequestRecord struct {
    Timestamp    int64   `json:"ts"`
    Model        string  `json:"model"`
    Provider     string  `json:"provider"`
    AuthID       string  `json:"auth_id"`
    Email        string  `json:"email,omitempty"`
    InputTokens  int64   `json:"input_tokens"`
    OutputTokens int64   `json:"output_tokens"`
    CachedTokens int64   `json:"cached_tokens"`
    ReasoningTokens int64 `json:"reasoning_tokens"`
    TotalTokens  int64   `json:"total_tokens"`
    EstimatedUSD float64 `json:"estimated_usd"`
    LatencyMs    int64   `json:"latency_ms"`
    Failed       bool    `json:"failed"`
}
```

---

### Task 17: Batch delete + export endpoints

**Files:**
- Modify: `CLIProxyAPI/internal/api/handlers/management/auth_files.go`

```
POST /v0/management/auth-files/delete-batch  → {names: [string]}
GET  /v0/management/auth-files/export        → JSON array of all auth file summaries
```

---

## Phase 6 — Go Embed Integration

### Task 18: Embed frontend into Go binary

**Files:**
- Create: `CLIProxyAPI/internal/api/frontend_embed.go`
- Modify: `CLIProxyAPI/internal/api/server.go`

```go
//go:build embed_frontend

package api

import "embed"

//go:embed all:frontend_dist
var frontendFS embed.FS
```

- Copy `frontend/dist` → `CLIProxyAPI/internal/api/frontend_dist/` as part of build
- Serve from `http.FileServer(http.FS(frontendFS))`
- Route: `GET /management/*` serves the SPA
- Fallback: serve `index.html` for all `/management/*` routes (SPA routing)

**Build script** `build.sh`:
```bash
#!/bin/bash
set -e
echo "=== Building React frontend ==="
cd frontend
pnpm install
pnpm build
cd ..

echo "=== Copying dist to Go embed ==="
rm -rf CLIProxyAPI/internal/api/frontend_dist
cp -r frontend/dist CLIProxyAPI/internal/api/frontend_dist

echo "=== Building Go binary ==="
cd CLIProxyAPI
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
  go build -tags embed_frontend -o ../cli-proxy-api-new.exe ./cmd/server/
echo "Done: cli-proxy-api-new.exe"
```

---

## Phase 7 — Integration + Polish

### Task 19: Toast notification system

**File:** `frontend/src/components/ui/Toast.tsx` + `frontend/src/hooks/useToast.ts`

- Global toast provider at App root
- `useToast()` hook: `toast.success("msg")`, `toast.error("msg")`, `toast.info("msg")`
- Auto-dismiss after 4s
- Stack multiple toasts

### Task 20: Empty states + error boundaries

- Each page has `<EmptyState>` when no data
- Error boundary wrapping each page
- Retry button on query errors

### Task 21: Build script + README

**File:** `build.bat` (Windows batch) and `build.sh`

```batch
@echo off
echo Building React frontend...
cd frontend
call pnpm install
call pnpm build
cd ..

echo Copying dist...
rmdir /s /q CLIProxyAPI\internal\api\frontend_dist 2>nul
xcopy /e /i /q frontend\dist CLIProxyAPI\internal\api\frontend_dist

echo Building Go binary...
cd CLIProxyAPI
set CGO_ENABLED=0
set GOOS=windows
set GOARCH=amd64
go build -tags embed_frontend -o ..\cli-proxy-api-new.exe .\cmd\server\
echo Done!
```

---

## Summary: All Files to Create

### Frontend (`frontend/`)
```
package.json, vite.config.ts, tsconfig.json + node, index.html
tailwind.config.js, postcss.config.js, components.json

src/index.css
src/main.tsx
src/App.tsx
src/lib/utils.ts

src/api/types.ts
src/api/client.ts
src/api/queries.ts

src/stores/connection.ts

src/components/ui/Badge.tsx
src/components/ui/Button.tsx
src/components/ui/Card.tsx
src/components/ui/Input.tsx
src/components/ui/Modal.tsx
src/components/ui/Progress.tsx
src/components/ui/Select.tsx
src/components/ui/StatCard.tsx
src/components/ui/Spinner.tsx
src/components/ui/Alert.tsx
src/components/ui/Toast.tsx
src/components/ui/DataTable.tsx

src/components/layout/AppLayout.tsx
src/components/layout/ConnectBar.tsx
src/components/layout/Header.tsx
src/components/layout/Sidebar.tsx

src/pages/Dashboard.tsx
src/pages/Accounts.tsx
src/pages/Quota.tsx
src/pages/TokenStats.tsx
src/pages/OAuth.tsx
src/pages/Logs.tsx
src/pages/Duplicates.tsx
src/pages/Settings.tsx
```

### Backend (`CLIProxyAPI/`)
```
internal/api/handlers/management/startup_snapshot.go   ✅ DONE
internal/api/handlers/management/warmup.go             ✅ DONE
internal/api/handlers/management/request_log_store.go  NEW
internal/api/frontend_embed.go                         NEW
internal/api/server.go                                 MODIFY (routes + embed serve)
```

### Build
```
build.bat
build.sh
```

---

## Execution Checklist

- [ ] Task 1-2:  Project config files
- [ ] Task 3-4:  API types + client
- [ ] Task 5:    Connection store
- [ ] Task 6:    UI primitives
- [ ] Task 7:    App layout + routing
- [ ] Task 8:    Dashboard page
- [ ] Task 9:    Accounts page
- [ ] Task 10:   Quota page
- [ ] Task 11:   Token Stats page
- [ ] Task 12:   Logs page
- [ ] Task 13:   OAuth page
- [ ] Task 14:   Duplicates page
- [ ] Task 15:   Settings page
- [ ] Task 16:   Request log store (Go)
- [ ] Task 17:   Batch delete (Go)
- [ ] Task 18:   Go embed integration
- [ ] Task 19:   Toast system
- [ ] Task 20:   Empty states + errors
- [ ] Task 21:   Build scripts
