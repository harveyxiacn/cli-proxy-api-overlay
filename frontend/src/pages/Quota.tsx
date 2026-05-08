import { useState, useCallback, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchCodexQuota, startRefreshTokensJob, waitForManagementJob, qkeys } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { Modal, useProgressModal } from "@/components/ui/Modal"
import { useToast } from "@/components/ui/Toast"
import { QuotaWindowCells } from "@/components/ui/Progress"
import { windowLabel } from "@/lib/utils"
import type { CodexQuotaEntry, QuotaWindow } from "@/api/types"

function findExtraWindow(entry: CodexQuotaEntry, namePart: string): QuotaWindow | null {
  if (!entry.extra_windows?.length) return null
  const lp = namePart.toLowerCase()
  return entry.extra_windows.find(w => w.name.toLowerCase().includes(lp))?.primary ?? null
}

type SortCol = "id" | "status" | "remaining" | "reset"
type SortDir = "asc" | "desc"

// Composite key so even when disabled/error agree, the actual status string
// differentiates entries (e.g. "active" vs "ready"). String prefixes keep the
// healthy bucket on top by default.
function statusRank(e: CodexQuotaEntry): string {
  if (e.disabled) return "9_disabled"
  if (e.error)    return "5_error_" + (e.refresh_status || "unknown")
  return "1_" + (e.status || "active")
}

function sortKey(e: CodexQuotaEntry, col: SortCol): number | string {
  switch (col) {
    case "id":        return (e.email || e.id).toLowerCase()
    case "status":    return statusRank(e)
    case "remaining": return e.primary_window?.remaining_percent ?? (e.error ? -1 : 0)
    case "reset":     return e.primary_window?.reset_at ?? Number.MAX_SAFE_INTEGER
  }
}

export function Quota() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const modal = useProgressModal()
  const toast = useToast()
  const [enabled, setEnabled] = useState(false)

  const quotaQ = useQuery({
    queryKey: qkeys.quota(config),
    queryFn: () => fetchCodexQuota(config),
    enabled: connected && enabled,
    staleTime: 60_000,
  })

  const loadQuota = useCallback(async () => {
    modal.show("查询 Codex 配额", "并发查询各账号额度，请稍候（10-30秒）…")
    modal.animateTo(90, 2000)
    setEnabled(true)
    try {
      const data = await fetchCodexQuota(config)
      qc.setQueryData(qkeys.quota(config), data)
      modal.stopAnimation()
      const s = data.summary
      modal.finish(
        `查询完成：${s.success} 个有额度  ${s.failed} 个失败  ${s.disabled} 个禁用`,
        s.failed > 0 ? "⚠ 有账号失败 — 点击「刷新Token后重查」可解决" : ""
      )
    } catch (e) {
      modal.stopAnimation()
      modal.finish("✗ 查询失败：" + (e instanceof Error ? e.message : String(e)))
    }
  }, [config, qc, modal])

  const refreshThenQuery = useCallback(async () => {
    modal.show("刷新Token后重查配额", "步骤 1/2 — 刷新全部 Token…")
    modal.animateTo(45, 1500)
    try {
      const job = await startRefreshTokensJob(config)
      modal.stopAnimation()
      modal.update(50, `步骤 2/2 — 令牌刷新任务已创建（${job.queued}个），等待进度…`)
      await waitForManagementJob(config, job, (j) => {
        const pct = j.total > 0 ? 50 + Math.round((j.done / j.total) * 35) : 85
        modal.update(pct, `刷新进度：${j.done}/${j.total}`, `成功 ${j.success} · 失败 ${j.failed} · 待处理 ${j.pending}`)
      })
      modal.animateTo(90, 1500)
      const data = await fetchCodexQuota(config)
      modal.stopAnimation()
      qc.setQueryData(qkeys.quota(config), data)
      const s = data.summary
      modal.finish(`完成：${s.success} 个有额度  ${s.failed} 个仍失败`)
      if (s.failed > 0) toast.warn(`${s.failed} 个账号仍失败（refresh_token 可能也已失效）`)
      else toast.success("所有账号配额查询成功")
    } catch (e) {
      modal.stopAnimation()
      modal.finish("✗ " + (e instanceof Error ? e.message : String(e)))
    }
  }, [config, qc, modal, toast])

  const entries = quotaQ.data?.entries ?? []
  const summary = quotaQ.data?.summary

  const [sortCol, setSortCol] = useState<SortCol>("remaining")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const toggleSort = (col: SortCol) => {
    if (col === sortCol) {
      setSortDir(d => d === "asc" ? "desc" : "asc")
    } else {
      setSortCol(col)
      // sensible default direction per column
      setSortDir(col === "remaining" ? "desc" : "asc")
    }
  }

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const ka = sortKey(a, sortCol)
      const kb = sortKey(b, sortCol)
      let cmp = 0
      if (typeof ka === "string" && typeof kb === "string") {
        cmp = ka.localeCompare(kb)
      } else {
        cmp = (ka as number) - (kb as number)
      }
      cmp = sortDir === "asc" ? cmp : -cmp
      if (cmp !== 0) return cmp
      // Tie-breakers so primary-key ties still produce a stable, visible order:
      // 1) by remaining percent (desc — healthier first)
      // 2) by email/id alphabetical
      const ra = a.primary_window?.remaining_percent ?? -1
      const rb = b.primary_window?.remaining_percent ?? -1
      if (ra !== rb) return rb - ra
      return (a.email || a.id).localeCompare(b.email || b.id)
    })
  }, [entries, sortCol, sortDir])

  // Aggregate quota in "account-units" (each account = 1 unit). Excludes disabled
  // and error states because they have no usable quota data.
  const usable = entries.filter(e => !e.disabled && !e.error && e.primary_window)
  const totalUnits     = usable.length
  const consumedUnits  = usable.reduce((sum, e) => sum + ((e.primary_window?.used_percent ?? 0) / 100), 0)
  const remainingUnits = usable.reduce((sum, e) => sum + ((e.primary_window?.remaining_percent ?? 0) / 100), 0)
  const consumedPct    = totalUnits > 0 ? (consumedUnits  / totalUnits) * 100 : 0
  const remainingPct   = totalUnits > 0 ? (remainingUnits / totalUnits) * 100 : 0

  const hasSecondary = entries.some(e => e.secondary_window != null)
  const hasCR        = entries.some(e => !!findExtraWindow(e, "code review"))
  const hasOther     = entries.some(e => (e.extra_windows ?? []).some(w =>
    !w.name.toLowerCase().includes("code review") && !w.name.includes("长周期")))
  const failedCount  = entries.filter(e => !e.disabled && !!e.error).length

  // Distribution bar
  const total     = entries.length
  const above50   = entries.filter(e => !e.disabled && !e.error && (e.primary_window?.remaining_percent ?? 0) > 50).length
  const mid       = entries.filter(e => !e.disabled && !e.error && (e.primary_window?.remaining_percent ?? 0) > 20 && (e.primary_window?.remaining_percent ?? 0) <= 50).length
  const low       = entries.filter(e => !e.disabled && !e.error && (e.primary_window?.remaining_percent ?? 0) > 0 && (e.primary_window?.remaining_percent ?? 0) <= 20).length
  const exhausted = entries.filter(e => !e.disabled && !e.error && (e.primary_window?.remaining_percent ?? -1) === 0).length
  const failed    = entries.filter(e => !e.disabled && !!e.error).length
  const disabled  = entries.filter(e => e.disabled).length
  const w = (n: number) => total > 0 ? `${(n / total * 100).toFixed(1)}%` : "0%"

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          Codex 配额详情
          <div className="flex gap-1.5 flex-wrap">
            <Button variant="primary" size="sm" onClick={loadQuota}>🔄 刷新配额</Button>
            <Button variant="warn"    size="sm" onClick={refreshThenQuery}>🔁 刷新Token后重查</Button>
          </div>
        </CardTitle>

        <Alert type="info" className="text-[0.8rem]">
          进度条内标签自动显示窗口时长（<b>7天</b> = free 账号；<b>5h</b> = 付费账号主窗口）。
          Code Review 额度仅在 API 返回 additional_rate_limits 时显示。
        </Alert>

        {/* Distribution bar */}
        {total > 0 && (
          <div className="mt-3 mb-3">
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <span className="text-[0.84rem] font-semibold">配额分布</span>
              <span className="text-xs text-[#64748b]">
                {total} 个账号 · 平均剩余{" "}
                <b className="text-green-400">{summary?.avg_primary_remaining ?? 0}%</b>
              </span>
            </div>
            <div className="flex h-2.5 rounded-md overflow-hidden gap-px">
              {above50   > 0 && <div style={{ width: w(above50)   }} className="bg-green-400"       title={`>50%: ${above50}个`}   />}
              {mid       > 0 && <div style={{ width: w(mid)       }} className="bg-yellow-400"      title={`20-50%: ${mid}个`}     />}
              {low       > 0 && <div style={{ width: w(low)       }} className="bg-red-400"         title={`<20%: ${low}个`}       />}
              {exhausted > 0 && <div style={{ width: w(exhausted) }} className="bg-slate-600"       title={`耗尽: ${exhausted}个`} />}
              {failed    > 0 && <div style={{ width: w(failed)    }} className="bg-orange-500/70"   title={`失败: ${failed}个`}    />}
              {disabled  > 0 && <div style={{ width: w(disabled)  }} className="bg-slate-800"       title={`禁用: ${disabled}个`}  />}
            </div>
            <div className="flex gap-3 flex-wrap mt-1.5 text-[0.73rem]">
              <span><span className="text-green-400">■</span> &gt;50% <b>{above50}</b></span>
              <span><span className="text-yellow-400">■</span> 20-50% <b>{mid}</b></span>
              <span><span className="text-red-400">■</span> &lt;20% <b>{low}</b></span>
              <span><span className="text-slate-500">■</span> 耗尽 <b>{exhausted}</b></span>
              <span><span className="text-orange-400">■</span> 失败/需刷新 <b>{failed}</b></span>
              <span><span className="text-slate-700">■</span> 禁用 <b>{disabled}</b></span>
            </div>
          </div>
        )}

        {/* Failure explanation */}
        {failedCount > 0 && (
          <Alert type="warn" className="text-[0.8rem]">
            ⚠ <b>{failedCount}</b> 个账号显示「需刷新/错误」—— 查询时 access_token 已过期（401）。
            点击「<b>🔁 刷新Token后重查</b>」自动解决。若仍失败 → refresh_token 也已失效 → 需重新 OAuth 登录。
          </Alert>
        )}

        {/* Quota totals (account-unit aggregation) */}
        {totalUnits > 0 && (
          <StatsGrid>
            <StatCard
              label="配额总计"
              value={totalUnits}
              color="text-blue-400"
              sub="可用账号数"
            />
            <StatCard
              label="消耗总计"
              value={consumedUnits.toFixed(1)}
              color="text-yellow-400"
              sub={`${consumedPct.toFixed(1)}% · ${totalUnits} 账号`}
            />
            <StatCard
              label="剩余配额总计"
              value={remainingUnits.toFixed(1)}
              color="text-green-400"
              sub={`${remainingPct.toFixed(1)}% · ${totalUnits} 账号`}
            />
          </StatsGrid>
        )}

        {quotaQ.isLoading && (
          <div className="flex gap-2 items-center text-sm text-[#94a3b8] py-4">
            <Spinner /> 加载中…
          </div>
        )}

        {!quotaQ.data && !quotaQ.isLoading && (
          <div className="text-center py-8 text-[#64748b]">
            <p className="mb-3">点击「🔄 刷新配额」开始查询</p>
            <Button variant="primary" onClick={loadQuota}>🔄 刷新配额</Button>
          </div>
        )}

        {/* Quota table */}
        {sorted.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-[0.82rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  <SortableTH col="id"        label="邮箱 / ID" align="left" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTH col="status"    label="状态"      align="center" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort} />
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">主配额</th>
                  <SortableTH col="remaining" label="剩余%"     align="center" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTH col="reset"     label="重置时间"  align="center" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort} />
                  {hasSecondary && (
                    <>
                      <th className="text-left px-2 py-2 text-[#64748b] font-medium">7天窗口</th>
                      <th className="px-2 py-2 text-[#64748b] font-medium">7天剩余</th>
                      <th className="px-2 py-2 text-[#64748b] font-medium">7天重置</th>
                    </>
                  )}
                  {hasCR && (
                    <>
                      <th className="text-left px-2 py-2 text-[#64748b] font-medium">Code Review</th>
                      <th className="px-2 py-2 text-[#64748b] font-medium">CR剩余</th>
                      <th className="px-2 py-2 text-[#64748b] font-medium">CR重置</th>
                    </>
                  )}
                  {hasOther && (
                    <th className="text-left px-2 py-2 text-[#64748b] font-medium">其他额度</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map(e => {
                  const label = e.email || e.id
                  const errNote = e.error ? (
                    <span
                      className="text-yellow-400 text-[0.72rem] ml-1"
                      title={e.error}
                    >
                      ⚠{e.refresh_status === "needs_refresh" ? " 需刷新" : ""}
                    </span>
                  ) : null
                  const statusBadge = e.disabled
                    ? <Badge variant="disabled">已禁用</Badge>
                    : e.error
                      ? <Badge variant="orange">错误</Badge>
                      : <Badge variant="green">正常</Badge>

                  const crWindow = findExtraWindow(e, "code review")
                  const others = (e.extra_windows ?? []).filter(w =>
                    !w.name.toLowerCase().includes("code review") && !w.name.includes("长周期"))

                  const rawMetaHint = !e.disabled && !e.error && !e.raw_meta?.has_additional_rate_limits
                    ? (
                      <span
                        className="text-[0.68rem] text-[#64748b] ml-1"
                        title="API 未返回 additional_rate_limits"
                      >
                        (无CR数据)
                      </span>
                    )
                    : null

                  return (
                    <tr key={e.id} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
                      <td
                        className="px-2 py-2 text-[#94a3b8] text-xs max-w-[200px] truncate"
                        title={label}
                      >
                        {label}{errNote}{rawMetaHint}
                      </td>
                      <td className="px-2 py-2">{statusBadge}</td>
                      <QuotaWindowCells w={e.primary_window} />
                      {hasSecondary && <QuotaWindowCells w={e.secondary_window} />}
                      {hasCR && <QuotaWindowCells w={crWindow} />}
                      {hasOther && (
                        <td className="px-2 py-2">
                          {others.map(w => {
                            const p = w.primary
                            if (!p) return null
                            const color =
                              p.remaining_percent > 50
                                ? "text-green-400"
                                : p.remaining_percent > 20
                                  ? "text-yellow-400"
                                  : "text-red-400"
                            const wl = windowLabel(p.window_minutes)
                            return (
                              <span
                                key={w.name}
                                className={`text-xs block ${color}`}
                                title={w.name}
                              >
                                {w.name}: {p.remaining_percent}%{wl ? ` (${wl})` : ""}
                              </span>
                            )
                          })}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal {...modal.state} onClose={modal.close} />
    </div>
  )
}

function SortableTH({ col, label, align, sortCol, sortDir, onClick }: {
  col: SortCol
  label: string
  align: "left" | "center"
  sortCol: SortCol
  sortDir: SortDir
  onClick: (col: SortCol) => void
}) {
  const isActive = sortCol === col
  const arrow = isActive ? (sortDir === "asc" ? " ↑" : " ↓") : ""
  return (
    <th
      onClick={() => onClick(col)}
      className={`px-2 py-2 text-[#64748b] font-medium cursor-pointer select-none whitespace-nowrap hover:text-[#e2e8f0] ${align === "left" ? "text-left" : ""}`}
      title="点击排序"
    >
      {label}
      <span className={isActive ? "text-[#6c63ff]" : "text-[#3d4168]"}>{arrow || " ⇅"}</span>
    </th>
  )
}

