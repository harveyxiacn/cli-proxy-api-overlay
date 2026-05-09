import { useState, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchStartupSnapshot, startRefreshTokensJob, fetchManagementJob, fetchAuthFiles, fetchHealthSummary, fetchIssues, fetchCodexQuota, qkeys } from "@/api/queries"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { Card, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"
import { Badge } from "@/components/ui/Badge"
import { Modal, useProgressModal } from "@/components/ui/Modal"
import { Spinner } from "@/components/ui/Spinner"
import { useToast } from "@/components/ui/Toast"
import { fmtTokens, fmtUSD, needsRelogin, cn } from "@/lib/utils"
import type { AuthFile } from "@/api/types"
import type { ConnectConfig, ManagementJob } from "@/api/types"

interface RefreshResults {
  success: AuthFile[]
  relogin: AuthFile[]
  failed: AuthFile[]
  skipped: AuthFile[]
}

export function Dashboard() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const modal = useProgressModal()
  const toast = useToast()
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshResults, setRefreshResults] = useState<RefreshResults | null>(null)
  const [quotaEnabled, setQuotaEnabled] = useState(false)
  const arRef = useRef<ReturnType<typeof setInterval>>()

  const snap = useQuery({
    queryKey: qkeys.snapshot(config),
    queryFn: () => fetchStartupSnapshot(config),
    enabled: connected,
  })
  const health = useQuery({
    queryKey: qkeys.health(config),
    queryFn: () => fetchHealthSummary(config),
    enabled: connected,
  })
  const issues = useQuery({
    queryKey: qkeys.issues(config),
    queryFn: () => fetchIssues(config),
    enabled: connected,
  })
  // Codex pool quota — manual-trigger to avoid blowing 10-30s on every dashboard load.
  // Once enabled, results stay fresh for 5 minutes to avoid re-hammering OpenAI's wham API.
  const quota = useQuery({
    queryKey: qkeys.quota(config),
    queryFn: () => fetchCodexQuota(config),
    enabled: connected && quotaEnabled,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    clearInterval(arRef.current)
    if (autoRefresh && connected) {
      arRef.current = setInterval(() => qc.invalidateQueries({ queryKey: qkeys.snapshot(config) }), 30_000)
    }
    return () => clearInterval(arRef.current)
  }, [autoRefresh, connected, config, qc])

  const files = snap.data?.files.files ?? []
  const stats = snap.data?.stats
  const today = snap.data?.token_today

  const healthy  = files.filter(f => ["active", "ready"].includes(f.status) && !f.disabled).length
  const disabled = files.filter(f => f.disabled).length
  const errored  = files.filter(f => !["active", "ready"].includes(f.status) && !f.disabled && !!f.status).length
  const relogin  = files.filter(f => needsRelogin(f.status_message ?? "")).length
  const codex    = files.filter(f => f.provider?.toLowerCase() === "codex").length

  // AT expiry distribution from expiry_time field (read from "expired" metadata key)
  const now = Date.now()
  const codexWithExpiry = files.filter(f => f.provider?.toLowerCase() === "codex" && f.expiry_time)
  const atExpired = codexWithExpiry.filter(f => new Date(f.expiry_time!).getTime() < now).length
  const atLt24h   = codexWithExpiry.filter(f => { const t = new Date(f.expiry_time!).getTime(); return t >= now && t < now + 86400_000 }).length
  const atLt7d    = codexWithExpiry.filter(f => { const t = new Date(f.expiry_time!).getTime(); return t >= now + 86400_000 && t < now + 7 * 86400_000 }).length
  const atGt7d    = codexWithExpiry.filter(f => new Date(f.expiry_time!).getTime() >= now + 7 * 86400_000).length

  const refreshMut = useMutation({
    mutationFn: async () => {
      const before = new Map(files.map(f => [f.name, { status: f.status, msg: f.status_message ?? "" }]))
      modal.show("刷新全部 Token", "正在快照当前状态…")
      await new Promise(r => setTimeout(r, 300))
      modal.update(10, "触发令牌刷新任务…")
      const job = await startRefreshTokensJob(config)
      modal.update(20, `⚡ 已触发 ${job.queued} 个凭证，等待任务进度…`)
      await waitForRefreshJob(config, job, (j) => {
        const pct = j.total > 0 ? 20 + Math.round((j.done / j.total) * 65) : 85
        modal.update(pct, `刷新进度：${j.done}/${j.total}`, `成功 ${j.success} · 失败 ${j.failed} · 待处理 ${j.pending}`)
      })
      modal.update(88, "重新加载授权文件状态…")
      const fr = await fetchAuthFiles(config)
      const after = fr.files
      const result: RefreshResults = { success: [], relogin: [], failed: [], skipped: [] }
      for (const f of after) {
        if (f.disabled) { result.skipped.push(f); continue }
        if (needsRelogin(f.status_message ?? "")) { result.relogin.push(f); continue }
        const hasErr = !!f.status_message || (!!f.status && !["active", "ready"].includes(f.status))
        if (hasErr) { result.failed.push(f); continue }
        const prev = before.get(f.name)
        const wasErr = !!prev?.msg || (!!prev?.status && !["active", "ready"].includes(prev.status))
        if (wasErr) result.success.push(f)
      }
      qc.setQueryData(qkeys.snapshot(config), (old: typeof snap.data) => old
        ? { ...old, files: { files: after } }
        : old
      )
      return result
    },
    onSuccess: (result) => {
      const bad = result.relogin.length + result.failed.length
      modal.finish(
        `✓ ${result.success.length} 个恢复  ⚠ ${result.relogin.length} 个需重登  ✗ ${result.failed.length} 个失败  → ${result.skipped.length} 个跳过`,
        bad > 0 ? "展开下方各分组查看详情" : "全部账号均正常"
      )
      setRefreshResults(result)
      if (bad === 0) toast.success(`刷新完成，${result.success.length} 个账号已恢复正常`)
    },
    onError: (e: unknown) => {
      modal.stopAnimation()
      modal.finish("✗ 失败: " + (e instanceof Error ? e.message : String(e)))
      toast.error("刷新令牌失败")
    },
  })

  if (!connected) return (
    <Alert type="info">请在顶部填写 CPA 地址和管理密钥后点击「连接」。</Alert>
  )

  return (
    <div>
      {snap.isLoading && (
        <div className="flex items-center gap-2 text-sm text-[#94a3b8] mb-4">
          <Spinner size={14} /> 加载中…
        </div>
      )}
      {snap.isError && (
        <Alert type="error">加载失败：{snap.error instanceof Error ? snap.error.message : "未知错误"}</Alert>
      )}

      {/* Account health */}
      <StatsGrid>
        <StatCard label="授权文件总数"        value={files.length}              color="text-blue-400" />
        <StatCard label="正常 (active/ready)" value={healthy}                   color="text-green-400" />
        <StatCard label="错误/不可用"          value={errored}                   color="text-red-400" />
        <StatCard label="需要重新登录"         value={relogin}                   color="text-orange-400" />
        <StatCard label="已禁用"              value={disabled}                  color="text-yellow-400" />
        <StatCard label="Codex Token"         value={codex}                     color="text-purple-400" />
        <StatCard label="累计成功请求"         value={stats?.total_success ?? 0} color="text-green-400" />
        <StatCard label="累计失败请求"         value={stats?.total_failed  ?? 0} color="text-red-400" />
      </StatsGrid>

      {/* AT expiry distribution — only shown when expiry data is available */}
      {codexWithExpiry.length > 0 && (
        <Card>
          <CardTitle>
            <span>⏱ Codex AT 到期分布</span>
            <span className="text-[0.72rem] text-[#64748b]">{codexWithExpiry.length} 个账号有到期信息</span>
          </CardTitle>
          <div className="grid grid-cols-4 gap-2">
            <div className={cn("rounded-lg border p-3 text-center", atExpired > 0 ? "border-red-500/40 bg-red-500/8" : "border-[#2d3148] bg-[#0f1117]")}>
              <div className={cn("text-2xl font-bold", atExpired > 0 ? "text-red-400" : "text-[#64748b]")}>{atExpired}</div>
              <div className="text-[0.72rem] text-[#64748b] mt-0.5">已过期</div>
              {atExpired > 0 && <div className="text-[0.68rem] text-red-400 mt-1">⚠ 需立即刷新</div>}
            </div>
            <div className={cn("rounded-lg border p-3 text-center", atLt24h > 0 ? "border-orange-500/40 bg-orange-500/8" : "border-[#2d3148] bg-[#0f1117]")}>
              <div className={cn("text-2xl font-bold", atLt24h > 0 ? "text-orange-400" : "text-[#64748b]")}>{atLt24h}</div>
              <div className="text-[0.72rem] text-[#64748b] mt-0.5">&lt;24h 到期</div>
            </div>
            <div className="rounded-lg border border-[#2d3148] bg-[#0f1117] p-3 text-center">
              <div className="text-2xl font-bold text-yellow-400">{atLt7d}</div>
              <div className="text-[0.72rem] text-[#64748b] mt-0.5">1-7天到期</div>
            </div>
            <div className="rounded-lg border border-[#2d3148] bg-[#0f1117] p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{atGt7d}</div>
              <div className="text-[0.72rem] text-[#64748b] mt-0.5">&gt;7天</div>
            </div>
          </div>
          {(atExpired > 0 || atLt24h > 0) && (
            <div className="mt-3 flex gap-2">
              <a
                href="/cpa-management/accounts?filter=at_expiring"
                className="text-[0.78rem] text-[#6c63ff] hover:underline"
              >
                → 前往授权文件页查看即将到期账号
              </a>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardTitle>
          <span>🧭 运维健康</span>
          <Badge variant={health.data?.status === "critical" ? "red" : health.data?.status === "degraded" ? "yellow" : "green"}>
            {health.data?.status ?? "loading"}
          </Badge>
        </CardTitle>
        <StatsGrid>
          <StatCard label="健康分" value={health.data?.score ?? "-"} color={health.data?.status === "critical" ? "text-red-400" : "text-green-400"} />
          <StatCard label="活动账号" value={health.data?.metrics.active_accounts ?? 0} color="text-blue-400" />
          <StatCard label="健康账号" value={health.data?.metrics.healthy_accounts ?? 0} color="text-green-400" />
          <StatCard label="问题总数" value={health.data?.metrics.issues ?? 0} color="text-yellow-400" />
        </StatsGrid>
        {(issues.data?.items ?? []).slice(0, 5).map(item => (
          <div key={item.id} className="mt-2 flex items-center gap-2 text-xs border border-[#2d3148] rounded p-2 bg-[#11131a]">
            <Badge variant={item.severity === "critical" ? "red" : item.severity === "warning" ? "yellow" : "blue"}>{item.severity}</Badge>
            <span className="font-semibold">{item.title}</span>
            {item.auth_name && <span className="text-[#64748b]">{item.auth_name}</span>}
          </div>
        ))}
      </Card>

      {/* Codex pool quota aggregate — total capacity remaining across all accounts */}
      <Card>
        <CardTitle>
          <span>⚡ Codex 池总额度</span>
          <div className="flex gap-1.5 items-center">
            {quota.data?.summary && (
              <span className="text-[0.72rem] text-[#64748b]">
                {quota.dataUpdatedAt ? new Date(quota.dataUpdatedAt).toLocaleTimeString("zh-CN") : ""}
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (!quotaEnabled) setQuotaEnabled(true)
                else qc.invalidateQueries({ queryKey: qkeys.quota(config) })
              }}
              disabled={quota.isFetching}
            >
              {quota.isFetching ? "查询中…" : (quotaEnabled ? "🔄 重新查询" : "🔍 查询账号池总额度")}
            </Button>
          </div>
        </CardTitle>
        {!quotaEnabled && !quota.data && (
          <Alert type="info" className="text-[0.78rem]">
            这条数据需要并发调用 OpenAI 的 wham 配额接口（~10-30 秒），所以仪表盘默认不自动加载。点上面按钮查询。
          </Alert>
        )}
        {quota.isError && <Alert type="error">查询失败：{(quota.error as Error)?.message}</Alert>}
        {quota.data?.summary && (() => {
          const s = quota.data.summary
          const pTotal = s.primary_capacity_total ?? 0
          const pUsed = s.primary_capacity_used ?? 0
          const pRem = s.primary_capacity_remaining ?? 0
          const sTotal = s.secondary_capacity_total ?? 0
          const sUsed = s.secondary_capacity_used ?? 0
          const sRem = s.secondary_capacity_remaining ?? 0
          return (
            <>
              <Alert type="info" className="text-[0.78rem]">
                <b>账号当量</b>（account-equivalent，简称 AE）= 1 AE 表示一个账号在该窗口内 100% 可用。
                "已用 X AE" 表示池子整体已经消耗了相当于 X 个完整账号的额度，"剩余" 同理。
              </Alert>
              <StatsGrid>
                <StatCard
                  label="🟢 可用账号"
                  value={s.success}
                  color="text-green-400"
                  sub={`${s.disabled} 禁用 · ${s.failed} 拉取失败 · ${s.needs_relogin ?? 0} 需重登录（均不计入额度）`}
                />
                <StatCard
                  label="📊 5h 主窗口 - 池子剩余"
                  value={`${pRem.toFixed(1)} AE`}
                  color="text-emerald-400"
                  sub={`已用 ${pUsed.toFixed(1)} / ${pTotal} AE · 平均剩余 ${s.avg_primary_remaining ?? "-"}%`}
                />
                <StatCard
                  label="📅 7d 长窗口 - 池子剩余"
                  value={`${sRem.toFixed(1)} AE`}
                  color="text-blue-400"
                  sub={`已用 ${sUsed.toFixed(1)} / ${sTotal} AE · 平均剩余 ${s.avg_secondary_remaining ?? "-"}%`}
                />
                <StatCard
                  label="🆗 闲置 / >50% / <20%"
                  value={`${s.idle_count} / ${s.above_50pct_count} / ${s.below_20pct_count}`}
                  color="text-purple-400"
                  sub="账号数（按各账号有效窗口）"
                />
              </StatsGrid>

              {/* Alternative framing: per-account 100% summed → "pool of N×100%". */}
              {/* Mathematically equivalent to AE × 100, but reads as a single shared bar. */}
              <div className="mt-4">
                <div className="text-[0.78rem] text-[#94a3b8] mb-2">
                  📐 配额百分比汇总（"每账号 100% × N = 总池"框架）
                  <span className="text-[0.72rem] text-[#64748b] ml-2">
                    与上面 AE 框架等价，公式：<code>Σ(剩余%) / (N × 100%)</code>
                  </span>
                </div>
                {(() => {
                  // Build a "pool denominator" framing.
                  // Numerator and denominator are in percent-units (Σ percentages).
                  // Result equals avg_*_remaining; we render the raw numerator/denominator
                  // so users who think in "10 accounts = 1000% pool" can verify the math.
                  const pDenom = pTotal * 100              // e.g., 251 × 100 = 25100
                  const pRemSum = pRem * 100               // e.g., 243.61 × 100 = 24361
                  const pUsedSum = pUsed * 100             // e.g., 7.39 × 100 = 739
                  const pPct = s.avg_primary_remaining ?? 0
                  const sDenom = sTotal * 100
                  const sRemSum = sRem * 100
                  const sUsedSum = sUsed * 100
                  const sPct = s.avg_secondary_remaining ?? 0
                  const fmtPct = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%"
                  return (
                    <StatsGrid>
                      <StatCard
                        label="🧮 5h 主窗口 - 总剩余比例"
                        value={pTotal > 0 ? fmtPct(pPct) : "—"}
                        color="text-emerald-400"
                        sub={
                          pTotal > 0
                            ? `${fmtPct(pRemSum)} / ${fmtPct(pDenom)} = ${fmtPct(pPct)} 剩`
                            : "5h 主窗口当前无账号"
                        }
                      />
                      <StatCard
                        label="🧮 5h 主窗口 - 已消耗"
                        value={pTotal > 0 ? fmtPct(100 - pPct) : "—"}
                        color="text-yellow-400"
                        sub={pTotal > 0 ? `${fmtPct(pUsedSum)} / ${fmtPct(pDenom)} 已用` : "—"}
                      />
                      <StatCard
                        label="🧮 7d 长窗口 - 总剩余比例"
                        value={sTotal > 0 ? fmtPct(sPct) : "—"}
                        color="text-blue-400"
                        sub={
                          sTotal > 0
                            ? `${fmtPct(sRemSum)} / ${fmtPct(sDenom)} = ${fmtPct(sPct)} 剩`
                            : "7d 窗口当前无账号"
                        }
                      />
                      <StatCard
                        label="🧮 7d 长窗口 - 已消耗"
                        value={sTotal > 0 ? fmtPct(100 - sPct) : "—"}
                        color="text-orange-400"
                        sub={sTotal > 0 ? `${fmtPct(sUsedSum)} / ${fmtPct(sDenom)} 已用` : "—"}
                      />
                    </StatsGrid>
                  )
                })()}
              </div>
            </>
          )
        })()}
      </Card>

      {/* Today's token stats */}
      {today && (today.total_tokens > 0 || today.requests > 0) && (
        <Card>
          <CardTitle>
            <span>📊 今日 Token 统计</span>
            <span className="text-[0.72rem] text-[#64748b] font-normal">{today.date}</span>
          </CardTitle>
          <StatsGrid>
            <StatCard label="今日 Tokens"   value={fmtTokens(today.total_tokens)}     color="text-blue-400"    sub="输入+输出合计" />
            <StatCard label="输入 Tokens"   value={fmtTokens(today.input_tokens)}     color="text-green-400" />
            <StatCard label="输出 Tokens"   value={fmtTokens(today.output_tokens)}    color="text-purple-400" />
            <StatCard label="缓存命中"      value={fmtTokens(today.cached_tokens)}    color="text-yellow-400"  sub="上下文缓存" />
            <StatCard label="推理 Tokens"   value={fmtTokens(today.reasoning_tokens)} color="text-violet-400"  sub="思考过程" />
            <StatCard label="预估费用"      value={fmtUSD(today.estimated_usd)}       color="text-emerald-400" sub="OpenAI 官价" />
            <StatCard label="今日请求"      value={today.requests}                    color="text-green-400" />
            <StatCard label="今日失败"      value={today.failed_requests}             color="text-red-400" />
          </StatsGrid>
          <p className="text-[0.73rem] text-[#64748b]">
            Codex OAuth 账号消耗的是免费配额，费用仅为参考（按 OpenAI 官方 API 定价换算）
          </p>
        </Card>
      )}

      {/* Quick actions */}
      <Card>
        <CardTitle>快速操作</CardTitle>
        <div className="flex gap-2 flex-wrap items-center">
          <Button variant="primary" onClick={() => qc.invalidateQueries({ queryKey: qkeys.snapshot(config) })}>
            🔄 刷新仪表盘
          </Button>
          <Button variant="success" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
            {refreshMut.isPending ? <><Spinner size={12} /> 刷新中…</> : "⚡ 刷新全部 Token"}
          </Button>
          <label className="flex items-center gap-1.5 text-[0.83rem] text-[#94a3b8] cursor-pointer">
            <input
              type="checkbox" checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-[#6c63ff]"
            />
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

async function waitForRefreshJob(
  config: ConnectConfig,
  initial: ManagementJob,
  onUpdate: (job: ManagementJob) => void,
): Promise<ManagementJob> {
  let current = initial
  onUpdate(current)
  for (let i = 0; i < 30; i++) {
    if (current.status !== "running") return current
    await new Promise(resolve => setTimeout(resolve, 1000))
    current = await fetchManagementJob(config, initial.id)
    onUpdate(current)
  }
  return current
}

function RefreshResultsPanel({ results, onClose }: { results: RefreshResults; onClose: () => void }) {
  return (
    <Card>
      <CardTitle>
        刷新结果详情
        <Button variant="ghost" size="sm" onClick={onClose}>✕ 关闭</Button>
      </CardTitle>
      <ResultGroup title="需要重新登录"       count={results.relogin.length}  items={results.relogin}  color="text-orange-400" hint="refresh_token 已失效，需重新 OAuth" defaultOpen />
      <ResultGroup title="刷新失败（其他错误）" count={results.failed.length}   items={results.failed}   color="text-red-400"    hint="查看错误信息列" defaultOpen />
      <ResultGroup title="刷新成功，已恢复"    count={results.success.length}  items={results.success}  color="text-green-400" />
      <ResultGroup title="已跳过（禁用账号）"  count={results.skipped.length}  items={results.skipped}  color="text-[#64748b]" />
    </Card>
  )
}

function ResultGroup({ title, count, items, color, hint, defaultOpen = false }: {
  title: string; count: number; items: AuthFile[]
  color: string; hint?: string; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!count) return null
  return (
    <div className="border border-[#2d3148] rounded-lg mb-2 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#22263a] text-left hover:brightness-110 transition-all"
        onClick={() => setOpen(o => !o)}
      >
        <span className={`text-sm font-semibold ${color}`}>{title}</span>
        <Badge variant="default" className="text-[0.72rem]">{count}</Badge>
        {hint && <span className="text-[0.74rem] text-[#64748b] hidden sm:inline">{hint}</span>}
        <span className="ml-auto text-[#64748b] text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#22263a]">
                <th className="text-left px-2 py-1.5 text-[#64748b] font-medium">邮箱 / 文件名</th>
                <th className="text-left px-2 py-1.5 text-[#64748b] font-medium">状态</th>
                <th className="text-left px-2 py-1.5 text-[#64748b] font-medium">错误信息</th>
              </tr>
            </thead>
            <tbody>
              {items.map(f => (
                <tr key={f.name} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
                  <td className="px-2 py-1.5 text-[#94a3b8] max-w-[240px] truncate" title={f.name}>
                    {f.email || f.name}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant={f.status === "active" ? "green" : f.status === "ready" ? "blue" : "red"}>
                      {f.status ?? "?"}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5 text-yellow-400 max-w-[300px] truncate" title={f.status_message}>
                    {f.status_message ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
