import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchSystemStatus, triggerSystemUpdate, fetchSystemUpdateLog, checkUpstream, qkeys } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { Badge } from "@/components/ui/Badge"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { useToast } from "@/components/ui/Toast"
import { fmtRelative, fmtDate } from "@/lib/utils"

function formatBytes(n?: number): string {
  if (!n || n <= 0) return "-"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function formatUptime(sec?: number): string {
  if (!sec || sec <= 0) return "-"
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
function shortSha(s?: string): string {
  if (!s) return "-"
  // sha256:xxxxxxxx... -> xxxxxxxx
  const stripped = s.replace(/^sha256:/, "")
  return stripped.slice(0, 12)
}

export function System() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const [showLog, setShowLog] = useState(false)

  const statusQ = useQuery({
    queryKey: qkeys.system(config),
    queryFn: () => fetchSystemStatus(config),
    enabled: connected,
    refetchInterval: (q) => (q.state.data?.update_pending ? 5_000 : 30_000),
  })

  const logQ = useQuery({
    queryKey: qkeys.systemLog(config),
    queryFn: () => fetchSystemUpdateLog(config),
    enabled: connected && showLog,
    refetchInterval: () => (statusQ.data?.update_pending ? 5_000 : 60_000),
  })

  const updateMut = useMutation({
    mutationFn: () => triggerSystemUpdate(config),
    onSuccess: (data) => {
      toast.success(data.message || "更新已排队")
      qc.invalidateQueries({ queryKey: qkeys.system(config) })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const upstreamMut = useMutation({
    mutationFn: () => checkUpstream(config),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })
  const upstream = upstreamMut.data

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  const s = statusQ.data
  const last = s?.last_update
  const lastSuccessLabel = last
    ? (last.success ? "✓ 成功" : `✗ 失败 (exit=${last.exit_code})`)
    : "尚无更新记录"
  const lastSuccessColor = last ? (last.success ? "text-green-400" : "text-red-400") : "text-[#64748b]"

  return (
    <div>
      <Card>
        <CardTitle>
          <span>🛠 系统信息</span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: qkeys.system(config) })}
          >🔄 刷新</Button>
        </CardTitle>

        {statusQ.isLoading && <div className="flex gap-2 items-center text-sm text-[#94a3b8]"><Spinner /> 加载中…</div>}
        {statusQ.isError && <Alert type="error">加载失败: {(statusQ.error as Error)?.message}</Alert>}

        {s && (
          <StatsGrid>
            <StatCard label="版本"           value={s.version || "dev"}                       color="text-blue-400" sub={s.commit ? `commit ${s.commit.slice(0,7)}` : ""} />
            <StatCard label="编译时间"       value={s.build_date && s.build_date !== "unknown" ? s.build_date : "-"} color="text-purple-400" />
            <StatCard label="Go 运行时"      value={s.go_version || "-"}                      color="text-violet-400" />
            <StatCard label="启动时间"       value={fmtRelative(s.started_at) || "-"}         color="text-yellow-400" sub={s.started_at ? fmtDate(s.started_at) : ""} />
            <StatCard label="运行时长"       value={formatUptime(s.uptime_sec)}               color="text-green-400" />
            <StatCard label="二进制大小"     value={formatBytes(s.binary_size)}               color="text-emerald-400" sub={s.binary_mtime ? fmtRelative(s.binary_mtime) : ""} />
          </StatsGrid>
        )}
      </Card>

      <Card>
        <CardTitle>
          <span>🔍 上游版本</span>
          <Button variant="ghost" size="sm" onClick={() => upstreamMut.mutate()} disabled={upstreamMut.isPending}>
            {upstreamMut.isPending ? "查询中..." : "🔎 检查仓库更新"}
          </Button>
        </CardTitle>
        <Alert type="info" className="text-[0.78rem]">
          点击"检查仓库更新"会查询 GitHub <code>{upstream?.upstream_repo ?? "router-for-me/CLIProxyAPI"}</code> 的最新 release，对照本地构建版本。本地为 <code>dev</code>/未注入版本时无法可靠判断（标记 <i>version_uncertain</i>）。
        </Alert>
        {upstream && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[0.85rem]">
            <div className="p-3 rounded bg-[#0f1117] border border-[#2d3148]">
              <div className="text-[#64748b] text-xs mb-1">本地构建</div>
              <div className="font-mono">{upstream.current_version || "dev"}</div>
              {upstream.current_commit && upstream.current_commit !== "none" && (
                <div className="text-xs text-[#94a3b8] mt-1">commit {upstream.current_commit.slice(0, 7)}</div>
              )}
              {upstream.current_build_date && upstream.current_build_date !== "unknown" && (
                <div className="text-xs text-[#94a3b8]">build {upstream.current_build_date}</div>
              )}
              {upstream.version_uncertain && (
                <Badge variant="yellow" className="mt-2">版本未注入，无法对比</Badge>
              )}
            </div>
            <div className="p-3 rounded bg-[#0f1117] border border-[#2d3148]">
              <div className="text-[#64748b] text-xs mb-1">上游 latest release</div>
              <div className="font-mono flex items-center gap-2">
                {upstream.latest_tag || "(none)"}
                {upstream.update_available && <Badge variant="orange">有更新</Badge>}
                {!upstream.update_available && !upstream.version_uncertain && <Badge variant="green">已是最新</Badge>}
              </div>
              {upstream.latest_name && upstream.latest_name !== upstream.latest_tag && (
                <div className="text-xs text-[#94a3b8] mt-1">{upstream.latest_name}</div>
              )}
              {upstream.published_at && (
                <div className="text-xs text-[#94a3b8]">发布于 {upstream.published_at}</div>
              )}
              {upstream.latest_url && (
                <a className="text-xs text-[#6c63ff] hover:underline mt-1 inline-block"
                   href={upstream.latest_url} target="_blank" rel="noreferrer">
                  在 GitHub 打开 ↗
                </a>
              )}
            </div>
            {upstream.body && (
              <div className="md:col-span-2 p-3 rounded bg-[#0f1117] border border-[#2d3148]">
                <div className="text-[#64748b] text-xs mb-1">Release Notes</div>
                <pre className="text-[0.72rem] text-[#cbd5e1] overflow-auto max-h-60 whitespace-pre-wrap">
                  {upstream.body}
                </pre>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>
          <span>🔄 一键更新 CPA</span>
          {s?.update_pending && <Badge variant="yellow">更新中</Badge>}
        </CardTitle>

        <Alert type="info" className="text-[0.78rem]">
          点击按钮后，host 端的 systemd watcher 会在 30 秒内执行 <code>update-cpa.sh</code>：拉取最新上游镜像 + 重启容器。
          自定义二进制和 extended.html 通过 bind-mount 注入，<b>不会被覆盖</b>；如需推新自定义二进制，仍需 SSH 上 host 跑 <code>./update-cpa.sh --binary &lt;path&gt;</code>。
          更新过程中容器会重启，浏览器约 5-10 秒内会短暂掉线，刷新即可恢复。
        </Alert>

        <div className="flex gap-2 items-center mb-3 flex-wrap">
          <Button
            variant="primary"
            onClick={() => {
              if (!confirm("确认触发一键更新？将拉取上游 eceasy/cli-proxy-api:latest 并重启容器（约 10 秒不可用）")) return
              updateMut.mutate()
            }}
            disabled={updateMut.isPending || s?.update_pending}
          >
            {updateMut.isPending ? "排队中..." : s?.update_pending ? "等待 host watcher 接手..." : "🚀 立即更新"}
          </Button>
          {s?.pending_since && (
            <span className="text-xs text-[#94a3b8]">
              已排队 {fmtRelative(s.pending_since)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[0.85rem]">
          <div className="p-3 rounded bg-[#0f1117] border border-[#2d3148]">
            <div className="text-[#64748b] text-xs mb-1">最近一次更新结果</div>
            <div className={`${lastSuccessColor} font-semibold`}>{lastSuccessLabel}</div>
            {last && (
              <>
                <div className="text-xs text-[#94a3b8] mt-2">
                  {fmtDate(last.started_at)} · 用时 {last.duration_sec}s
                </div>
                <div className="text-xs text-[#94a3b8]">
                  镜像{last.image_changed ? "已更新" : "未变化"}：{shortSha(last.image_before)} → {shortSha(last.image_after)}
                </div>
              </>
            )}
          </div>
          <div className="p-3 rounded bg-[#0f1117] border border-[#2d3148]">
            <div className="text-[#64748b] text-xs mb-1">更新日志</div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLog(v => !v)}
            >{showLog ? "▲ 隐藏" : "▼ 查看 host watcher 日志"}</Button>
          </div>
        </div>

        {showLog && (
          <div className="mt-3">
            {logQ.isLoading && <div className="flex gap-2 items-center text-sm text-[#94a3b8]"><Spinner /> 加载中…</div>}
            {logQ.data && !logQ.data.exists && (
              <Alert type="info" className="text-[0.78rem]">
                日志文件还不存在 — host 上还没跑过任何更新。{logQ.data.hint && <> ({logQ.data.hint})</>}
              </Alert>
            )}
            {logQ.data && logQ.data.exists && (
              <pre className="bg-[#0a0c14] border border-[#2d3148] rounded p-3 text-[0.72rem] text-[#cbd5e1] overflow-auto max-h-96 whitespace-pre-wrap break-all">
{logQ.data.log || "(空日志)"}
              </pre>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
