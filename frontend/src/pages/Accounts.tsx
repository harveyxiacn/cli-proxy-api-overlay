import { useState, useRef, useEffect, useCallback } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import {
  fetchAuthFiles, fetchAuthStats, patchAuthFileStatus, patchAuthFileFields,
  patchAuthFileStatusBatch, deleteAuthFile, deleteAuthFilesBatch, downloadAuthFilesBatch,
  uploadAuthFile, warmupAccounts, startRefreshTokensJob, fetchManagementJob,
  startOAuthRepairFlow, fetchAuthMaintenanceSummary, qkeys
} from "@/api/queries"
import type { ManagementJob } from "@/api/types"
import { Button } from "@/components/ui/Button"
import { Badge, AuthStatusBadge } from "@/components/ui/Badge"
import { Card, CardTitle } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { Modal, useProgressModal } from "@/components/ui/Modal"
import { BatchReloginDialog } from "@/components/BatchReloginDialog"
import { useToast } from "@/components/ui/Toast"
import { Sparkline } from "@/components/ui/Sparkline"
import { Drawer } from "@/components/ui/Drawer"
import { cn, fmtRelative, fmtDate, needsRelogin } from "@/lib/utils"
import type { AuthFile, WarmupResult, RecentRequestBucket } from "@/api/types"
import { Upload, CheckCircle2, XCircle, RefreshCw } from "lucide-react"

type SortCol = "name" | "provider" | "email" | "label" | "status" | "success" | "failed" | "last_refresh"
type SortDir = "asc" | "desc"

interface Filter { provider: string; email: string; status: string; group: string; tag: string }

// Filename penalty patterns (same logic as extended.html)
const FN_PATTERNS: { re: RegExp; label: string; penalty: number }[] = [
  { re: /\s*\(\d+\)\s*\.json$/i,              label: "OS复制 (N)",  penalty: 8 },
  { re: /-run\d+[-_]\d{8}[-_]\d{6}/i,         label: "运行时间戳",  penalty: 5 },
  { re: /-\d{4}-?\d{2}-?\d{2}[-_]\d{6}/,      label: "日期时间戳",  penalty: 5 },
  { re: /[_-]\d{14}(?=\.json$)/i,              label: "紧凑时间戳",  penalty: 5 },
  { re: /[-_](bak|backup|old|tmp|temp)\b/i,    label: "备份标记",    penalty: 5 },
]

function filenameScore(name: string): number {
  let penalty = 0
  for (const p of FN_PATTERNS) if (p.re.test(name)) penalty += p.penalty
  return penalty > 0 ? -penalty : 3
}

// filenameScore is available for future use (e.g. smart sort)
void filenameScore

/** Truncate text to maxLen chars, adding ellipsis if needed. Whitespace collapsed. */
function briefText(s: string | undefined, maxLen: number): string {
  if (!s) return ""
  const collapsed = s.replace(/\s+/g, " ").trim()
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen) + "…" : collapsed
}

/** Brief representation of last_error for table cells: prefer the code, fallback to short message. */
function briefError(err: { code?: string; message?: string } | undefined): string {
  if (!err) return ""
  const code = (err.code ?? "").trim()
  if (code) return code
  return briefText(err.message, 28)
}

function sortValue(f: AuthFile, col: SortCol): string | number {
  switch (col) {
    case "name":         return (f.name ?? "").toLowerCase()
    case "provider":     return (f.provider ?? "").toLowerCase()
    case "email":        return (f.email ?? "").toLowerCase()
    case "label":        return (f.label ?? "").toLowerCase()
    case "status": {
      // Mirror AuthStatusBadge categories so the visible badge groups together.
      // Sort prefix ascends from healthy → degraded → disabled.
      if (f.disabled)                                     return "9_disabled"
      // Only treat as needs_relogin when status is NOT active/ready.
      // Active accounts are working; their status_message may have a stale
      // refresh error that should not affect sort priority.
      if (f.status !== "active" && f.status !== "ready" && needsRelogin(f.status_message ?? ""))
                                                           return "8_needs_relogin"
      if (f.status === "error")                            return "4_error"
      if (f.status === "unavailable")                      return "3_unavailable"
      return "1_" + (f.status ?? "")
    }
    case "success":      return -(f.success ?? 0)
    case "failed":       return -(f.failed ?? 0)
    case "last_refresh": return f.last_refresh ? -(new Date(f.last_refresh).getTime()) : Infinity
    default:             return ""
  }
}

const STATUS_OPTIONS = [
  { value: "",           label: "全部状态" },
  { value: "problem",    label: "有问题 (error/unavailable/disabled)" },
  { value: "relogin",    label: "需要重新登录" },
  { value: "active",     label: "active" },
  { value: "ready",      label: "ready" },
  { value: "disabled",   label: "disabled" },
  { value: "at_expired", label: "AT 已过期" },
  { value: "at_lt7d",    label: "AT 7天内到期" },
]

// Inline refresh job state — drives the progress bar and per-row indicators.
type RefreshJobState = {
  snapshot: ManagementJob
  /** ms timestamp of the job's started_at (for comparing last_refresh) */
  startedAt: number
  /** true once we've seen status !== "running" and should hide after a delay */
  finishing: boolean
}

export function Accounts() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const modal = useProgressModal()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [filter, setFilter] = useState<Filter>({ provider: "", email: "", status: "", group: "", tag: "" })
  const [sortCol, setSortCol] = useState<SortCol>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [labelEdit, setLabelEdit] = useState<{ name: string; value: string } | null>(null)
  const [warmupResults, setWarmupResults] = useState<WarmupResult[] | null>(null)
  const [drawerFile, setDrawerFile] = useState<AuthFile | null>(null)
  const [reloginBatchOpen, setReloginBatchOpen] = useState(false)
  const [refreshJob, setRefreshJob] = useState<RefreshJobState | null>(null)
  const refreshPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)

  // While a refresh job is running, poll the job + auth list at 1.5s intervals.
  const isRefreshing = refreshJob?.snapshot.status === "running"
  const filesQ = useQuery({
    queryKey: qkeys.authFiles(config),
    queryFn: () => fetchAuthFiles(config),
    enabled: connected,
    refetchInterval: isRefreshing ? 1500 : false,
  })

  // Poll job status separately so the progress bar updates even if authFiles is slow.
  // Also handles the edge case where a job is already "completed" on first response
  // (e.g. no OAuth accounts exist).
  useEffect(() => {
    if (refreshPollRef.current) clearInterval(refreshPollRef.current)
    if (!refreshJob) return

    const showJobToast = (j: ManagementJob) => {
      const skipped = j.skipped ?? 0
      const allSkipped = j.success === 0 && j.failed === 0 && skipped > 0
      if (j.status === "completed") {
        if (allSkipped) {
          toast.info(`Token 均在有效期内，已跳过 ${skipped} 个账号（无需刷新）`)
        } else if (j.failed === 0) {
          const skipNote = skipped > 0 ? ` · 跳过有效 ${skipped}` : ""
          toast.success(`✓ Token 刷新完成 — 成功 ${j.success}${skipNote}`)
        } else {
          const skipNote = skipped > 0 ? ` · 跳过 ${skipped}` : ""
          toast.warn(`Token 刷新 — 成功 ${j.success} · 失败 ${j.failed}${skipNote}`)
        }
      } else {
        toast.warn("Token 刷新超时，部分账号可能未完成")
      }
    }

    // If the job is already done on arrival (e.g. immediately completed), handle inline.
    if (refreshJob.snapshot.status !== "running") {
      invalidateAccountViews()
      showJobToast(refreshJob.snapshot)
      setRefreshJob(prev => prev ? { ...prev, finishing: true } : null)
      const t = setTimeout(() => setRefreshJob(null), 5000)
      return () => clearTimeout(t)
    }

    refreshPollRef.current = setInterval(async () => {
      try {
        const updated = await fetchManagementJob(config, refreshJob.snapshot.id)
        setRefreshJob(prev => prev ? { ...prev, snapshot: updated } : null)
        if (updated.status !== "running") {
          clearInterval(refreshPollRef.current!)
          invalidateAccountViews()
          qc.invalidateQueries({ queryKey: ["auth-stats-trends", config.url, config.key] })
          showJobToast(updated)
          setRefreshJob(prev => prev ? { ...prev, finishing: true } : null)
          setTimeout(() => setRefreshJob(null), 5000)
        }
      } catch { /* ignore transient poll errors */ }
    }, 1500)

    return () => { if (refreshPollRef.current) clearInterval(refreshPollRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshJob?.snapshot.id, refreshJob?.snapshot.status])

  // Recent activity buckets (for sparkline column)
  const statsQ = useQuery({
    queryKey: ["auth-stats-trends", config.url, config.key],
    queryFn: () => fetchAuthStats(config),
    enabled: connected,
    staleTime: 15_000,
  })
  const maintQ = useQuery({
    queryKey: qkeys.maintenance(config),
    queryFn: () => fetchAuthMaintenanceSummary(config),
    enabled: connected,
    staleTime: 15_000,
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invalidateAccountViews = () => {
    qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
    qc.invalidateQueries({ queryKey: qkeys.maintenance(config) })
  }

  const bucketsByID = new Map<string, RecentRequestBucket[]>()
  for (const a of statsQ.data?.auths ?? []) {
    if (a.recent_requests) bucketsByID.set(a.id, a.recent_requests)
  }

  const allFiles = filesQ.data?.files ?? []
  const maintenance = maintQ.data
  const groupOptions = Object.keys(maintenance?.counts.groups ?? {})
    .filter(g => g !== "ungrouped")
    .sort()
  const tagOptions = Object.keys(maintenance?.counts.tags ?? {}).sort()

  // Filter
  const filtered = allFiles
    .filter(f => !filter.provider || f.provider?.toLowerCase().includes(filter.provider.toLowerCase()))
    .filter(f => !filter.email    || f.email?.toLowerCase().includes(filter.email.toLowerCase()))
    .filter(f => !filter.group    || (f.group || "").toLowerCase() === filter.group.toLowerCase())
    .filter(f => !filter.tag      || (f.tags ?? []).some(t => t.toLowerCase() === filter.tag.toLowerCase()))
    .filter(f => {
      if (!filter.status) return true
      if (filter.status === "problem")  return f.disabled || f.unavailable || (!!f.status && !["active", "ready"].includes(f.status))
      if (filter.status === "relogin")    return f.status !== "active" && f.status !== "ready" && needsRelogin(f.status_message ?? "")
      if (filter.status === "disabled")   return f.disabled
      if (filter.status === "active")     return f.status === "active" && !f.disabled
      if (filter.status === "ready")      return f.status === "ready" && !f.disabled
      if (filter.status === "at_expired") return !!f.expiry_time && new Date(f.expiry_time).getTime() < Date.now()
      if (filter.status === "at_lt7d")    return !!f.expiry_time && new Date(f.expiry_time).getTime() < Date.now() + 7 * 86400_000
      return true
    })
    .sort((a, b) => {
      const va = sortValue(a, sortCol), vb = sortValue(b, sortCol)
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb))
      return sortDir === "asc" ? cmp : -cmp
    })

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback(() => 44, []),
    overscan: 8,
  })

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }

  const sortIcon = (col: SortCol) => sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : " ⇅"

  const quickSelect = (type: "relogin" | "problem" | "unavailable_free") => {
    const fromServer = type === "relogin"
      ? maintQ.data?.candidates.needs_relogin
      : type === "unavailable_free"
        ? maintQ.data?.candidates.unavailable_free
        : maintQ.data?.candidates.problem
    const names = fromServer ?? allFiles
      .filter(f => type === "relogin"
        ? f.status !== "active" && f.status !== "ready" && needsRelogin(f.status_message ?? "")
        : type === "problem"
          ? f.disabled || f.unavailable || (!!f.status && !["active", "ready"].includes(f.status))
          : f.provider === "codex" && f.unavailable && !needsRelogin(f.status_message ?? ""))
      .map(f => f.name)
    setSelected(new Set(names))
  }

  // Mutations
  const statusMut = useMutation({
    mutationFn: ({ name, disabled }: { name: string; disabled: boolean }) =>
      patchAuthFileStatus(config, name, disabled),
    onSuccess: (_, { name, disabled }) => {
      // Show toast with undo button — clicking undo flips the state back
      toast.success(`${name} 已${disabled ? "禁用" : "启用"}`, {
        action: {
          label: "撤销",
          onClick: () => statusMut.mutate({ name, disabled: !disabled }),
        },
      })
      invalidateAccountViews()
    },
    onError: (e: unknown) => toast.error((e instanceof Error ? e.message : String(e))),
  })

  const deleteMut = useMutation({
    mutationFn: (name: string) => deleteAuthFile(config, name),
    onSuccess: (_, name) => {
      toast.success(`已删除 ${name}`)
      invalidateAccountViews()
    },
    onError: (e: unknown) => toast.error((e instanceof Error ? e.message : String(e))),
  })

  const labelMut = useMutation({
    mutationFn: ({ name, label }: { name: string; label: string }) =>
      patchAuthFileFields(config, name, { label }),
    onSuccess: () => {
      setLabelEdit(null)
      invalidateAccountViews()
    },
    onError: (e: unknown) => toast.error((e instanceof Error ? e.message : String(e))),
  })

  const batchStatus = async (disabled: boolean) => {
    const names = [...selected]
    if (!names.length) return
    try {
      const r = await patchAuthFileStatusBatch(config, names, disabled)
      const ok = r.updated ?? r.files.length
      const fail = r.failed ?? 0
      toast[fail ? "warn" : "success"](`${disabled ? "禁用" : "启用"}完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ""}`)
      setSelected(new Set())
      invalidateAccountViews()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const batchDelete = async () => {
    const names = [...selected]
    if (!names.length || !confirm(`确认删除 ${names.length} 个授权文件？`)) return
    try {
      const r = await deleteAuthFilesBatch(config, names)
      const ok = r.deleted ?? r.files.length
      const fail = r.failed ?? 0
      toast[fail ? "warn" : "success"](`删除完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ""}`)
      setSelected(new Set())
      invalidateAccountViews()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const batchDownload = async () => {
    const names = [...selected]
    if (!names.length) return
    try {
      const { blob, filename } = await downloadAuthFilesBatch(config, names)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`已打包下载 ${names.length} 个授权文件`)
    } catch (e) {
      toast.error("下载失败：" + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleRelogin = async (f: AuthFile) => {
    try {
      const { providerOAuthUrl } = await startOAuthRepairFlow(config, f.provider, f.name)
      window.open(providerOAuthUrl, "_blank")
      toast.success("已打开 OAuth 授权页面，完成后回到此处刷新", {
        action: { label: "前往修复", onClick: () => window.location.assign("/management/oauth") },
      })
    } catch (e) {
      toast.error("启动重登录失败：" + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleRefreshAllTokens = async (force = false) => {
    if (refreshJob?.snapshot.status === "running") return
    try {
      const job = await startRefreshTokensJob(config, { force })
      if (job.queued === 0) {
        toast.info("没有可刷新的 OAuth 账号（API key 账号无需刷新）")
        return
      }
      setRefreshJob({ snapshot: job, startedAt: job.started_at * 1000, finishing: false })
    } catch (e) {
      toast.error("创建刷新任务失败：" + (e instanceof Error ? e.message : String(e)))
    }
  }

  const warmupMut = useMutation({
    mutationFn: (names: string[]) => warmupAccounts(config, names),
    onSuccess: r => {
      setWarmupResults(r.results)
      modal.finish(`完成：✓ ${r.succeeded} 个正常  ✗ ${r.failed} 个失败`)
    },
    onError: (e: unknown) => {
      modal.stopAnimation()
      modal.finish("✗ " + (e instanceof Error ? e.message : String(e)))
    },
  })

  const handleWarmup = (names: string[]) => {
    modal.show("账号连通性测试", `测试 ${names.length} 个账号…`)
    modal.animateTo(90, 1000)
    warmupMut.mutate(names)
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    let ok = 0, fail = 0
    const failNames: string[] = []
    for (const f of Array.from(files)) {
      if (!f.name.endsWith(".json")) continue
      try { await uploadAuthFile(config, await f.arrayBuffer(), f.name); ok++ }
      catch { fail++; failNames.push(f.name) }
    }
    if (ok > 0) {
      toast.success(`上传成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ""}`)
      invalidateAccountViews()
    } else if (fail > 0) {
      toast.error(`上传失败：${failNames.slice(0, 3).join(", ")}`)
    }
  }

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          授权文件管理
          <div className="flex gap-1.5 flex-wrap items-center">
            <Button variant="primary" size="sm" onClick={invalidateAccountViews}>
              🔄 刷新
            </Button>
            <Button
              variant="success" size="sm"
              onClick={() => handleRefreshAllTokens(false)}
              disabled={isRefreshing}
              title="智能刷新：跳过 token 仍有效的账号，仅刷新过期或有错误的账号"
            >
              {isRefreshing ? <><Spinner size={12} /> 刷新中…</> : "⚡ 智能刷新Token"}
            </Button>
            <Button
              variant="ghost" size="sm"
              onClick={() => handleRefreshAllTokens(true)}
              disabled={isRefreshing}
              title="强制刷新全部 OAuth 账号（无论 token 是否有效）"
            >
              🔁 强制刷新全部
            </Button>
            <Button
              variant="ghost" size="sm"
              onClick={() =>
                handleWarmup(
                  selected.size > 0
                    ? [...selected]
                    : allFiles.filter(f => !f.disabled).map(f => f.name)
                )
              }
            >
              🔌 {selected.size > 0 ? `测试所选(${selected.size})` : "测试全部"}
            </Button>
          </div>
        </CardTitle>

        {/* Inline refresh progress bar */}
        {refreshJob && (() => {
          const { snapshot: j, finishing } = refreshJob
          const pct = j.total > 0 ? Math.round(j.done / j.total * 100) : 0
          const isRunning = j.status === "running"
          return (
            <div className={cn(
              "mb-3 rounded-lg border border-[#2d3148] bg-[#12152a] p-3 text-sm transition-opacity duration-1000",
              finishing ? "opacity-40" : "opacity-100"
            )}>
              <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                <span className="text-[#94a3b8] font-medium">
                  {isRunning
                    ? `⚡ Token 刷新中… ${j.done}/${j.total}`
                    : j.status === "completed" && j.success === 0 && j.failed === 0
                      ? `— Token 均有效，已跳过 ${j.done}/${j.total}`
                      : j.status === "completed"
                        ? `✓ 刷新完成 ${j.done}/${j.total}`
                        : `⏱ 刷新超时 ${j.done}/${j.total}`
                  }
                </span>
                <span className="text-[0.78rem] text-[#64748b] space-x-2">
                  {j.success > 0 && <span className="text-green-400">✓ {j.success}</span>}
                  {j.failed > 0 && <span className="text-red-400">✗ {j.failed}</span>}
                  {(j.skipped ?? 0) > 0 && <span className="text-[#94a3b8]">跳过 {j.skipped}</span>}
                  {j.pending > 0 && <span className="text-yellow-400">待处理 {j.pending}</span>}
                  {!j.force && <span className="text-[#4a5568] text-[0.72rem]">智能模式</span>}
                </span>
              </div>
              <div className="h-1.5 bg-[#2d3148] rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    j.status === "completed" && j.failed === 0 && j.success > 0
                      ? "bg-green-500"
                      : j.status === "completed" && j.failed > 0
                        ? "bg-yellow-500"
                        : j.status === "completed" && j.success === 0
                          ? "bg-[#4a5568]"  // all skipped — neutral grey
                          : "bg-gradient-to-r from-[#6c63ff] to-[#4ecdc4]"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })()}

        {/* Upload area */}
        <div
          className="border-2 border-dashed border-[#2d3148] rounded-[10px] p-4 text-center cursor-pointer hover:border-[#6c63ff] hover:bg-[#6c63ff]/5 transition-all mb-3"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("border-[#6c63ff]") }}
          onDragLeave={e => e.currentTarget.classList.remove("border-[#6c63ff]")}
          onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files) }}
        >
          <Upload size={18} className="mx-auto mb-1 text-[#64748b]" />
          <p className="text-[0.84rem] text-[#94a3b8]">点击或拖拽 JSON 授权文件上传（支持多文件）</p>
        </div>
        <input
          ref={fileInputRef} type="file" accept=".json" multiple className="hidden"
          onChange={e => handleUpload(e.target.files)}
        />

        {maintenance && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            <MaintenanceTile label="总账号" value={maintenance.summary.total} />
            <MaintenanceTile label="需重登录" value={maintenance.summary.needs_relogin} tone="orange" onClick={() => quickSelect("relogin")} />
            <MaintenanceTile label="不可用 Free" value={maintenance.summary.unavailable_free} tone="yellow" onClick={() => quickSelect("unavailable_free")} />
            <MaintenanceTile label="问题账号" value={maintenance.summary.problem} tone="red" onClick={() => quickSelect("problem")} />
            <MaintenanceTile label="分组/标签" value={`${Object.keys(maintenance.counts.groups).length}/${Object.keys(maintenance.counts.tags).length}`} />
          </div>
        )}

        {/* Filter bar */}
        <div className="flex gap-2 flex-wrap items-center mb-2.5">
          <Input
            value={filter.provider}
            onChange={e => setFilter(f => ({ ...f, provider: e.target.value }))}
            placeholder="Provider"
            className="w-[130px]"
          />
          <Input
            value={filter.email}
            onChange={e => setFilter(f => ({ ...f, email: e.target.value }))}
            placeholder="邮箱关键词"
            className="w-[160px]"
          />
          <Select
            value={filter.status}
            onChange={v => setFilter(f => ({ ...f, status: v }))}
            options={STATUS_OPTIONS}
            className="w-[180px]"
          />
          {groupOptions.length > 0 && (
            <Select
              value={filter.group}
              onChange={v => setFilter(f => ({ ...f, group: v }))}
              options={[{ value: "", label: "全部分组" }, ...groupOptions.map(g => ({ value: g, label: `${g} (${maintenance?.counts.groups[g] ?? 0})` }))]}
              className="w-[160px]"
            />
          )}
          {tagOptions.length > 0 && (
            <Select
              value={filter.tag}
              onChange={v => setFilter(f => ({ ...f, tag: v }))}
              options={[{ value: "", label: "全部标签" }, ...tagOptions.map(t => ({ value: t, label: `${t} (${maintenance?.counts.tags[t] ?? 0})` }))]}
              className="w-[160px]"
            />
          )}
          <Button variant="ghost" size="sm" onClick={() => setFilter({ provider: "", email: "", status: "", group: "", tag: "" })}>
            清除
          </Button>
          <Button variant="ghost" size="sm" onClick={() => quickSelect("relogin")}>⚡选需重登录</Button>
          <Button variant="ghost" size="sm" onClick={() => quickSelect("unavailable_free")}>选不可用Free</Button>
          <Button variant="ghost" size="sm" onClick={() => quickSelect("problem")}>⚠选问题账号</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!maintenance || maintenance.summary.needs_relogin === 0}
            onClick={() => setReloginBatchOpen(true)}
            title="按需重登候选清单依次发起 OAuth 流程"
          >
            🔁 批量重登 ({maintenance?.summary.needs_relogin ?? 0})
          </Button>
          <span className="text-[0.8rem] text-[#64748b]">共 {filtered.length} 条</span>
        </div>

        {/* Batch bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap bg-[#6c63ff]/10 border border-[#6c63ff]/30 rounded-lg px-3 py-2 mb-2.5">
            <span className="text-[0.85rem] font-semibold text-[#6c63ff]">{selected.size} 项已选</span>
            <Button variant="success" size="sm" onClick={() => batchStatus(false)}>✅ 启用所选</Button>
            <Button variant="warn"    size="sm" onClick={() => batchStatus(true)}>🚫 禁用所选</Button>
            <Button variant="primary" size="sm" onClick={batchDownload}>📦 下载所选</Button>
            <Button variant="danger"  size="sm" onClick={batchDelete}>🗑 删除所选</Button>
            <Button variant="ghost"   size="sm" onClick={() => setSelected(new Set())}>取消选择</Button>
          </div>
        )}

        {filesQ.isLoading && (
          <div className="flex gap-2 items-center text-sm text-[#94a3b8] py-4">
            <Spinner /> 加载中…
          </div>
        )}
        {filesQ.isError && (
          <Alert type="error">
            加载失败：{filesQ.error instanceof Error ? filesQ.error.message : "未知错误"}
          </Alert>
        )}

        {/* Table — virtualized for performance with large account pools */}
        <div className="overflow-x-auto">
        <div
          ref={tableContainerRef}
          className="overflow-y-auto"
          style={{ maxHeight: "calc(100vh - 380px)", minHeight: 200 }}
        >
          <table className="w-full text-[0.82rem] border-collapse">
            <thead>
              <tr className="bg-[#22263a]">
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox" className="accent-[#6c63ff]"
                    checked={filtered.length > 0 && filtered.every(f => selected.has(f.name))}
                    onChange={e => {
                      if (e.target.checked) setSelected(new Set([...selected, ...filtered.map(f => f.name)]))
                      else setSelected(prev => {
                        const n = new Set(prev)
                        filtered.forEach(f => n.delete(f.name))
                        return n
                      })
                    }}
                  />
                </th>
                {(
                  [
                    ["name", "文件名"],
                    ["provider", "Provider"],
                    ["email", "邮箱"],
                    ["label", "标签"],
                    ["status", "状态"],
                  ] as [SortCol, string][]
                ).map(([col, lbl]) => (
                  <th
                    key={col}
                    className="text-left px-2 py-2 text-[#64748b] font-medium cursor-pointer select-none hover:text-[#e2e8f0] whitespace-nowrap"
                    onClick={() => handleSort(col)}
                  >
                    {lbl}{sortIcon(col)}
                  </th>
                ))}
                <th className="text-left px-2 py-2 text-[#64748b] font-medium">错误信息</th>
                {(
                  [
                    ["success", "成功"],
                    ["failed", "失败"],
                    ["last_refresh", "最后刷新"],
                  ] as [SortCol, string][]
                ).map(([col, lbl]) => (
                  <th
                    key={col}
                    className="text-left px-2 py-2 text-[#64748b] font-medium cursor-pointer select-none hover:text-[#e2e8f0] whitespace-nowrap"
                    onClick={() => handleSort(col)}
                  >
                    {lbl}{sortIcon(col)}
                  </th>
                ))}
                <th
                  className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap"
                  title="近 24 小时请求活跃度（蓝=成功为主，黄=有失败，红=多数失败）"
                >
                  24h 趋势
                </th>
                <th
                  className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap"
                  title="AT 到期时间（绿=7天以上，黄=3天内，橙=24小时内，红=已过期）。如无 JWT 则显示刷新失败后的重试时间"
                >
                  AT 到期
                </th>
                <th className="text-left px-2 py-2 text-[#64748b] font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !filesQ.isLoading && (
                <tr>
                  <td colSpan={13} className="text-center py-6 text-[#64748b]">
                    {allFiles.length === 0
                      ? "暂无授权文件 — 上方拖拽 JSON 或前往 OAuth 登录页面创建"
                      : "无符合筛选条件的记录 — 试试清除筛选"
                    }
                  </td>
                </tr>
              )}
              {/* Virtual spacer: top padding */}
              {rowVirtualizer.getVirtualItems().length > 0 && (
                <tr><td style={{ height: rowVirtualizer.getVirtualItems()[0].start }} colSpan={13} /></tr>
              )}
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const f = filtered[virtualRow.index]
                const isWorking = f.status === "active" || f.status === "ready"
                // Only flag as relogin when account is NOT working (non-active status with relogin keyword).
                // Active accounts are serving requests fine; their background refresh errors should not
                // cause alarming row highlights or count as "needs_relogin".
                const isRelogin = !isWorking && needsRelogin(f.status_message ?? "")
                const isProblem = f.disabled || f.unavailable || (!!f.status && !["active", "ready", "disabled"].includes(f.status))
                const rowBg = isRelogin ? "bg-orange-500/4" : isProblem ? "bg-red-500/4" : ""
                const isSelected = selected.has(f.name)
                const isLabelEditing = labelEdit?.name === f.name

                return (
                  <tr
                    key={f.name}
                    className={cn(
                      "border-t border-[#2d3148] hover:bg-[#6c63ff]/5 transition-colors",
                      rowBg,
                      isSelected && "bg-[#6c63ff]/8"
                    )}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox" className="accent-[#6c63ff]" checked={isSelected}
                        onChange={e => {
                          const n = new Set(selected)
                          e.target.checked ? n.add(f.name) : n.delete(f.name)
                          setSelected(n)
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-[#94a3b8] max-w-[180px]">
                      <span className="truncate block text-xs" title={f.name}>{f.name}</span>
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant="default" className="text-[0.72rem]">{f.provider ?? "-"}</Badge>
                    </td>
                    <td className="px-2 py-2 text-xs text-[#94a3b8]">{f.email ?? "-"}</td>
                    <td className="px-2 py-2 text-xs max-w-[120px]">
                      {isLabelEditing ? (
                        <form
                          onSubmit={e => {
                            e.preventDefault()
                            labelMut.mutate({ name: f.name, label: labelEdit.value })
                          }}
                          className="flex gap-1"
                        >
                          <Input
                            value={labelEdit.value}
                            onChange={e => setLabelEdit(v => v ? { ...v, value: e.target.value } : null)}
                            className="w-24 py-0.5 text-xs"
                            autoFocus
                          />
                          <Button type="submit" variant="success" size="sm">✓</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setLabelEdit(null)}>✕</Button>
                        </form>
                      ) : (
                        <button
                          className="text-[#94a3b8] hover:text-[#e2e8f0] cursor-pointer truncate max-w-[100px] block text-left"
                          title="点击编辑标签"
                          onClick={() => setLabelEdit({ name: f.name, value: f.label ?? "" })}
                        >
                          {f.label || <span className="text-[#64748b] italic">点击添加标签</span>}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <AuthStatusBadge
                          status={f.status} disabled={f.disabled}
                          statusMessage={f.status_message}
                          lastRefresh={f.last_refresh} failed={f.failed}
                          lastError={f.last_error}
                        />
                        {refreshJob && (() => {
                          const jobStart = refreshJob.startedAt
                          const refreshedAt = f.last_refresh ? new Date(f.last_refresh).getTime() : 0
                          if (refreshedAt > jobStart) {
                            // Token was refreshed during this job
                            return <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                          }
                          if (refreshJob.snapshot.status === "running" && !f.disabled) {
                            // Still in progress for this account
                            return <RefreshCw size={11} className="text-[#6c63ff] shrink-0 animate-spin" />
                          }
                          return null
                        })()}
                      </div>
                    </td>
                    <td className="px-2 py-2 w-[160px] max-w-[160px]">
                      {/* For working accounts (active/ready), CPA considers them healthy.
                          Don't show last_error from background refresh failures — the account
                          IS serving requests. Only show errors for genuinely broken accounts. */}
                      {!isWorking && f.last_error?.message
                        ? <button
                            type="button"
                            className="text-red-400 text-[0.76rem] block max-w-full text-left hover:underline cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap"
                            title={`${f.last_error.code ? f.last_error.code + ": " : ""}${f.last_error.message}\n点击查看完整账号详情`}
                            onClick={() => setDrawerFile(f)}
                          >{briefError(f.last_error)}</button>
                        : !isWorking && f.status_message
                          ? <button
                              type="button"
                              className="text-yellow-400 text-[0.76rem] block max-w-full text-left hover:underline cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap"
                              title={`${f.status_message}\n点击查看完整账号详情`}
                              onClick={() => setDrawerFile(f)}
                            >{briefText(f.status_message, 28)}</button>
                          : <span className="text-[#64748b] text-xs">-</span>
                      }
                    </td>
                    <td className="px-2 py-2 text-green-400 text-xs">{f.success ?? 0}</td>
                    <td className="px-2 py-2 text-red-400 text-xs">{f.failed ?? 0}</td>
                    <td
                      className="px-2 py-2 text-[#64748b] text-xs whitespace-nowrap"
                      title={f.last_refresh ? new Date(f.last_refresh).toLocaleString("zh-CN") : "从未成功刷新"}
                    >
                      {f.last_refresh
                        ? fmtRelative(new Date(f.last_refresh).getTime() / 1000)
                        : <span className="text-[#3d4168]" title="从未成功刷新（可能每次刷新都失败）">—</span>
                      }
                    </td>
                    <td className="px-2 py-2">
                      <Sparkline buckets={bucketsByID.get(f.id)} max={12} />
                    </td>
                    <td className="px-2 py-2 text-[#64748b] text-xs whitespace-nowrap">
                      {f.expiry_time ? (() => {
                        const rem = new Date(f.expiry_time!).getTime() - Date.now()
                        const h = Math.round(rem / 3600000)
                        const cls = h < 0 ? "text-red-400" : h < 24 ? "text-orange-400" : h < 72 ? "text-yellow-400" : "text-green-400"
                        const label = h < 0 ? "已过期" : h < 24 ? `${h}h` : `${Math.round(h/24)}d`
                        return <span className={cls} title={new Date(f.expiry_time!).toLocaleString("zh-CN")}>{label}</span>
                      })() : f.next_retry_after ? fmtDate(new Date(f.next_retry_after).getTime() / 1000) : "-"}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost" size="sm" title="查看详情"
                          onClick={() => setDrawerFile(f)}
                        >
                          详情
                        </Button>
                        <Button
                          variant={f.disabled ? "success" : "warn"} size="sm"
                          onClick={() => statusMut.mutate({ name: f.name, disabled: !f.disabled })}
                        >
                          {f.disabled ? "启" : "禁"}
                        </Button>
                        {!f.disabled && f.status !== "active" && f.status !== "ready" && (needsRelogin(f.status_message ?? "") || !!f.last_error || !f.last_refresh) && (
                          <Button
                            variant="primary" size="sm"
                            title={`重新 OAuth 登录${f.last_error?.message ? "\n上次错误：" + f.last_error.message : ""}`}
                            onClick={() => handleRelogin(f)}
                          >
                            🔑
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="sm" title="测试账号连通性"
                          onClick={() => handleWarmup([f.name])}
                        >
                          <RefreshCw size={11} />
                        </Button>
                        <Button
                          variant="danger" size="sm"
                          onClick={() => { if (confirm(`确认删除 ${f.name}？`)) deleteMut.mutate(f.name) }}
                        >
                          删
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {/* Virtual spacer: bottom padding */}
              {rowVirtualizer.getVirtualItems().length > 0 && (() => {
                const lastItem = rowVirtualizer.getVirtualItems().at(-1)!
                const bottomPad = rowVirtualizer.getTotalSize() - lastItem.end
                return bottomPad > 0 ? <tr><td style={{ height: bottomPad }} colSpan={13} /></tr> : null
              })()}
            </tbody>
          </table>
        </div>
        </div>
      </Card>

      {/* Warmup results modal */}
      <Modal {...modal.state} onClose={() => { modal.close(); setWarmupResults(null) }}>
        {warmupResults && (
          <div className="mt-3 overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#22263a]">
                  <th className="text-left px-2 py-1.5 text-[#64748b]">账号</th>
                  <th className="text-left px-2 py-1.5 text-[#64748b]">结果</th>
                  <th className="text-left px-2 py-1.5 text-[#64748b]">消息</th>
                  <th className="text-left px-2 py-1.5 text-[#64748b]">延迟</th>
                </tr>
              </thead>
              <tbody>
                {warmupResults.map(r => (
                  <tr key={r.id} className="border-t border-[#2d3148]">
                    <td className="px-2 py-1.5 text-[#94a3b8] max-w-[150px] truncate" title={r.name}>
                      {r.email || r.name}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.ok
                        ? <CheckCircle2 size={13} className="text-green-400" />
                        : <XCircle size={13} className="text-red-400" />
                      }
                    </td>
                    <td
                      className="px-2 py-1.5 max-w-[200px] truncate"
                      title={r.message}
                      style={{ color: r.ok ? "#94a3b8" : "#f59e0b" }}
                    >
                      {r.message}
                    </td>
                    <td className="px-2 py-1.5 text-[#64748b]">{r.latency_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Account detail drawer */}
      <Drawer
        open={!!drawerFile}
        onClose={() => setDrawerFile(null)}
        title={drawerFile ? (drawerFile.email || drawerFile.name) : ""}
        width={520}
      >
        {drawerFile && (() => {
          const f = drawerFile
          const fWorking = f.status === "active" || f.status === "ready"
          const buckets = bucketsByID.get(f.id) ?? []
          const stat = statsQ.data?.auths.find(a => a.id === f.id)
          return (
            <div className="space-y-4">
              <section>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <AuthStatusBadge
                    status={f.status} disabled={f.disabled}
                    statusMessage={f.status_message ?? ""}
                    lastRefresh={f.last_refresh} failed={f.failed}
                    lastError={f.last_error}
                  />
                  <Badge variant="default">{f.provider ?? "-"}</Badge>
                  {f.label && <Badge variant="purple">{f.label}</Badge>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#22263a] rounded p-2">
                    <div className="text-green-400 text-lg font-bold">{f.success ?? 0}</div>
                    <div className="text-xs text-[#64748b]">成功</div>
                  </div>
                  <div className="bg-[#22263a] rounded p-2">
                    <div className="text-red-400 text-lg font-bold">{f.failed ?? 0}</div>
                    <div className="text-xs text-[#64748b]">失败</div>
                  </div>
                  <div className="bg-[#22263a] rounded p-2">
                    <div className="text-blue-400 text-lg font-bold">
                      {(() => {
                        const t = (f.success ?? 0) + (f.failed ?? 0)
                        return t > 0 ? Math.round((f.success ?? 0) / t * 100) + "%" : "-"
                      })()}
                    </div>
                    <div className="text-xs text-[#64748b]">成功率</div>
                  </div>
                </div>
              </section>

              {buckets.length > 0 && (
                <section>
                  <h4 className="text-xs font-bold text-[#94a3b8] mb-2">近 24 小时活跃度</h4>
                  <div className="bg-[#11131a] border border-[#2d3148] rounded p-3 flex justify-center items-end h-16">
                    <Sparkline buckets={buckets} max={24} className="h-full" />
                  </div>
                </section>
              )}

              {((!fWorking && f.last_error?.message) || f.status_message) && (
                <section>
                  <h4 className="text-xs font-bold text-[#94a3b8] mb-2">错误信息</h4>
                  {/* last_error only shown for non-working accounts; active accounts
                      serve requests fine so background refresh errors are not alarming. */}
                  {!fWorking && f.last_error?.message && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-2.5 text-xs text-red-300 break-all mb-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">最近一次刷新错误</span>
                        {f.last_error.code && (
                          <Badge variant="red" className="text-[0.68rem]">{f.last_error.code}</Badge>
                        )}
                      </div>
                      <div className="text-red-200/90 whitespace-pre-wrap">{f.last_error.message}</div>
                    </div>
                  )}
                  {f.status_message && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 text-xs text-yellow-300 break-all">
                      <div className="font-semibold mb-0.5">状态消息</div>
                      <div className="whitespace-pre-wrap">{f.status_message}</div>
                    </div>
                  )}
                </section>
              )}

              <section>
                <h4 className="text-xs font-bold text-[#94a3b8] mb-2">账号属性</h4>
                <table className="w-full text-xs">
                  <tbody>
                    <DetailRow k="文件名" v={f.name} mono />
                    <DetailRow k="ID" v={f.id} mono />
                    <DetailRow k="Provider" v={f.provider ?? "-"} />
                    {f.type && f.type !== f.provider && <DetailRow k="类型" v={f.type} />}
                    <DetailRow k="邮箱" v={f.email ?? "-"} />
                    {f.account_type && <DetailRow k="账号类型" v={f.account_type} />}
                    {f.account && <DetailRow k="账号" v={f.account} mono />}
                    <DetailRow k="标签" v={f.label || "-"} />
                    <DetailRow k="分组" v={f.group || "-"} />
                    <DetailRow
                      k="标签集"
                      v={f.tags && f.tags.length > 0
                        ? <span className="flex gap-1 flex-wrap">{f.tags.map(t => <Badge key={t} variant="purple" className="text-[0.68rem]">{t}</Badge>)}</span>
                        : "-"}
                    />
                    <DetailRow k="备注" v={f.note || "-"} />
                    <DetailRow k="优先级" v={f.priority ?? "-"} />
                    <DetailRow k="状态" v={f.status} />
                    <DetailRow k="禁用" v={f.disabled ? "是" : "否"} />
                    <DetailRow k="不可用" v={f.unavailable ? "是" : "否"} />
                    <DetailRow k="最后刷新" v={f.last_refresh ? new Date(f.last_refresh).toLocaleString("zh-CN") : "从未成功刷新"} />
                    {f.expiry_time && (() => {
                      const exp = new Date(f.expiry_time)
                      const remaining = exp.getTime() - Date.now()
                      const hours = Math.round(remaining / 3600000)
                      const color = hours < 24 ? "text-orange-400" : hours < 72 ? "text-yellow-400" : "text-green-400"
                      const label = hours < 0 ? "已过期" : hours < 24 ? `${hours}小时后到期` : `${Math.round(hours/24)}天后到期`
                      return (
                        <DetailRow
                          k="AT 到期时间"
                          v={<span className={color} title={exp.toLocaleString("zh-CN")}>{label}</span>}
                        />
                      )
                    })()}
                    <DetailRow k="下次重试" v={f.next_retry_after ? new Date(f.next_retry_after).toLocaleString("zh-CN") : "-"} />
                    {f.created_at && <DetailRow k="创建时间" v={new Date(f.created_at).toLocaleString("zh-CN")} />}
                    {f.updated_at && <DetailRow k="更新时间" v={new Date(f.updated_at).toLocaleString("zh-CN")} />}
                    <DetailRow k="成功次数" v={<span className="text-green-400">{f.success ?? 0}</span>} />
                    <DetailRow k="失败次数" v={<span className="text-red-400">{f.failed ?? 0}</span>} />
                    <DetailRow k="存储来源" v={f.source} />
                    {f.path && <DetailRow k="路径" v={f.path} mono />}
                    {f.size > 0 && <DetailRow k="文件大小" v={`${f.size} B`} />}
                    {f.runtime_only && <DetailRow k="仅运行时" v="是（未持久化）" />}
                    {typeof f.auth_index === "number" && <DetailRow k="授权索引" v={f.auth_index} />}
                  </tbody>
                </table>
              </section>

              {stat && (
                <section className="text-xs text-[#64748b]">
                  来自 <code>auth-stats</code> · 状态: {stat.status} · 不可用: {stat.unavailable ? "是" : "否"}
                </section>
              )}

              <section className="flex gap-2 flex-wrap pt-2 border-t border-[#2d3148]">
                <Button
                  variant={f.disabled ? "success" : "warn"} size="sm"
                  onClick={() => { statusMut.mutate({ name: f.name, disabled: !f.disabled }); setDrawerFile(null) }}
                >
                  {f.disabled ? "启用账号" : "禁用账号"}
                </Button>
                {!f.disabled && f.status !== "active" && f.status !== "ready" && (needsRelogin(f.status_message ?? "") || !!f.last_error || !f.last_refresh) && (
                  <Button
                    variant="primary" size="sm"
                    onClick={() => { handleRelogin(f); setDrawerFile(null) }}
                  >
                    🔑 重新 OAuth 登录
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm"
                  onClick={() => { handleWarmup([f.name]); setDrawerFile(null) }}
                >
                  <RefreshCw size={11} /> 测试连通性
                </Button>
                <Button
                  variant="danger" size="sm"
                  onClick={() => {
                    if (confirm(`确认删除 ${f.name}？`)) {
                      deleteMut.mutate(f.name)
                      setDrawerFile(null)
                    }
                  }}
                >
                  删除
                </Button>
              </section>
            </div>
          )
        })()}
      </Drawer>

      <BatchReloginDialog
        open={reloginBatchOpen}
        initialTargets={(maintenance?.candidates.needs_relogin ?? []).map(name => {
          const f = allFiles.find(x => x.name === name)
          return { name, provider: f?.provider || "codex" }
        })}
        onClose={() => setReloginBatchOpen(false)}
        onComplete={(stats) => {
          toast.success(`批量重登：✅${stats.success} ⏭${stats.skipped} ❌${stats.error}`)
        }}
      />
    </div>
  )
}

function DetailRow({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <tr className="border-t border-[#2d3148] first:border-t-0">
      <td className="py-1.5 pr-3 text-[#64748b] whitespace-nowrap">{k}</td>
      <td className={cn("py-1.5 text-[#94a3b8] break-all", mono && "font-mono text-[0.72rem]")}>
        {v}
      </td>
    </tr>
  )
}

function MaintenanceTile({ label, value, tone = "default", onClick, title }: {
  label: string
  value: React.ReactNode
  tone?: "default" | "orange" | "yellow" | "red"
  onClick?: () => void
  title?: string
}) {
  const toneClass = {
    default: "text-[#e2e8f0]",
    orange: "text-orange-400",
    yellow: "text-yellow-400",
    red: "text-red-400",
  }[tone]
  const content = (
    <>
      <div className="text-[0.68rem] text-[#64748b] truncate">{label}</div>
      <div className={cn("text-lg font-bold leading-tight truncate", toneClass)}>{value}</div>
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="min-w-0 rounded-lg border border-[#2d3148] bg-[#0f1117] px-3 py-2 text-left hover:border-[#6c63ff] hover:bg-[#6c63ff]/5 transition-colors"
      >
        {content}
      </button>
    )
  }
  return (
    <div title={title} className="min-w-0 rounded-lg border border-[#2d3148] bg-[#0f1117] px-3 py-2">
      {content}
    </div>
  )
}
