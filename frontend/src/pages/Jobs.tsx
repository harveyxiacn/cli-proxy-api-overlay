import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { fetchManagementJobs, startRefreshTokensJob } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { useToast } from "@/components/ui/Toast"
import { fmtRelative } from "@/lib/utils"
import type { ManagementJob } from "@/api/types"

const statusVariant: Record<string, "blue" | "green" | "yellow" | "red" | "default"> = {
  running:   "blue",
  completed: "green",
  timeout:   "yellow",
  not_found: "red",
}

function jobLabel(t: string): string {
  switch (t) {
    case "refresh_tokens": return "刷新全部 Token"
    default: return t
  }
}

function progressPct(j: ManagementJob): number {
  if (j.total <= 0) return j.status === "completed" ? 100 : 0
  return Math.min(100, Math.round((j.done / j.total) * 100))
}

export function Jobs() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()

  const jobsQ = useQuery({
    queryKey: ["jobs-list", config.url, config.key],
    queryFn: () => fetchManagementJobs(config),
    enabled: connected,
    refetchInterval: 5_000,
  })

  const refreshMut = useMutation({
    mutationFn: () => startRefreshTokensJob(config),
    onSuccess: (j) => {
      toast.success(`刷新任务已创建 (${j.id.slice(0, 8)}…)`)
      qc.invalidateQueries({ queryKey: ["jobs-list", config.url, config.key] })
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : String(e)),
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  const jobs = jobsQ.data?.jobs ?? []
  const running = jobs.filter(j => j.status === "running").length
  const completed = jobs.filter(j => j.status === "completed").length
  const timedOut = jobs.filter(j => j.status === "timeout").length

  return (
    <div>
      <Card>
        <CardTitle>
          任务中心
          <div className="flex gap-1.5 items-center">
            <span className="text-[0.78rem] text-[#64748b]">
              {jobs.length} 条 · 运行中 {running} · 已完成 {completed}{timedOut > 0 ? ` · 超时 ${timedOut}` : ""}
            </span>
            <Button variant="primary" size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["jobs-list", config.url, config.key] })}>
              🔄 刷新
            </Button>
            <Button variant="success" size="sm"
              onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
              {refreshMut.isPending ? <><Spinner size={12} /> 创建中…</> : "⚡ 创建刷新任务"}
            </Button>
          </div>
        </CardTitle>

        <Alert type="info" className="text-[0.78rem]">
          管理任务列表（最近 1 小时）。每 5 秒自动刷新进度。
          点击任务可查看进度详情；任务由 Dashboard、Quota 页面或上方按钮创建。
        </Alert>

        {jobsQ.isLoading && (
          <div className="flex gap-2 items-center text-sm text-[#94a3b8] py-4">
            <Spinner /> 加载中…
          </div>
        )}

        {jobs.length === 0 && !jobsQ.isLoading && (
          <p className="text-center text-[#64748b] py-6">
            暂无任务。点击「⚡ 创建刷新任务」启动一次刷新所有凭证。
          </p>
        )}

        {jobs.length > 0 && (
          <div className="space-y-2">
            {jobs.map(j => {
              const pct = progressPct(j)
              const barColor = j.status === "completed"
                ? "bg-green-400"
                : j.status === "timeout"
                  ? "bg-yellow-400"
                  : "bg-[#6c63ff]"
              return (
                <div key={j.id} className="border border-[#2d3148] rounded-lg p-3 bg-[#11131a]">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge variant={statusVariant[j.status] ?? "default"}>{j.status}</Badge>
                    <span className="font-semibold text-sm">{jobLabel(j.type)}</span>
                    <span className="text-xs text-[#64748b] font-mono" title={j.id}>
                      {j.id.slice(0, 8)}…
                    </span>
                    <span className="ml-auto text-xs text-[#64748b]" title={new Date(j.started_at * 1000).toLocaleString("zh-CN")}>
                      启动于 {fmtRelative(j.started_at)}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 rounded bg-[#0f1117] overflow-hidden mb-2">
                    <div className={`h-full rounded transition-all ${barColor}`}
                         style={{ width: `${pct}%` }} />
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    <span className="text-[#94a3b8]">
                      进度: <b className="text-[#e2e8f0]">{j.done}</b> / {j.total}
                      {j.total > 0 && ` (${pct}%)`}
                    </span>
                    {j.queued > 0 && <span className="text-blue-400">已排队 {j.queued}</span>}
                    {j.success > 0 && <span className="text-green-400">✓ 成功 {j.success}</span>}
                    {j.failed > 0 && <span className="text-red-400">✗ 失败 {j.failed}</span>}
                    {j.pending > 0 && <span className="text-yellow-400">⏳ 等待 {j.pending}</span>}
                    {j.skipped > 0 && <span className="text-[#64748b]">→ 跳过 {j.skipped}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
