import { useParams, Link } from "react-router-dom"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import {
  fetchAccountHealthOne, qkeys,
  warmupAccounts, patchAuthFileStatusBatch,
} from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { Button } from "@/components/ui/Button"
import { useToast } from "@/components/ui/Toast"
import { fmtRelative, fmtDate } from "@/lib/utils"
import { ArrowLeft, Activity, RefreshCw, Power, PowerOff, ExternalLink } from "lucide-react"

const levelVariant = { healthy: "green", warning: "yellow", critical: "red" } as const
const severityBadge = { info: "blue", warning: "yellow", critical: "red" } as const
const riskVariant = { none: "default", low: "blue", medium: "yellow", high: "red" } as const

export function AccountDetail() {
  const { encodedName } = useParams<{ encodedName: string }>()
  const name = decodeURIComponent(encodedName ?? "")
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()

  const detail = useQuery({
    queryKey: ["account-detail", config.url, config.key, name],
    queryFn: () => fetchAccountHealthOne(config, name),
    enabled: connected && name !== "",
    refetchInterval: 30_000,
  })

  const warmup = useMutation({
    mutationFn: () => warmupAccounts(config, [name]),
    onSuccess: r => {
      const result = r.results[0]
      if (result?.ok) toast.success(`Warmup OK (${result.latency_ms}ms)`)
      else toast.error(result?.message ?? "Warmup failed")
      qc.invalidateQueries({ queryKey: ["account-detail", config.url, config.key, name] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setStatus = useMutation({
    mutationFn: (disabled: boolean) => patchAuthFileStatusBatch(config, [name], disabled),
    onSuccess: () => {
      toast.success("已更新状态")
      qc.invalidateQueries({ queryKey: ["account-detail", config.url, config.key, name] })
      qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>
  if (!name) return <Alert type="error">缺少账号名称。</Alert>
  if (detail.isLoading) return <div className="text-sm text-[#94a3b8]">加载中…</div>
  if (detail.error) return <Alert type="error">未找到账号 {name}。</Alert>
  const item = detail.data?.item
  if (!item) return <Alert type="error">未找到账号 {name}。</Alert>

  const requestHistoryURL = `/history?q=${encodeURIComponent(name)}`

  return (
    <div>
      <Card>
        <div className="flex items-center justify-between mb-2">
          <Link to="/account-health" className="text-xs text-[#6c63ff] hover:underline flex items-center gap-1">
            <ArrowLeft size={12} /> 返回账号健康
          </Link>
          <span className="text-xs text-[#64748b]">
            {detail.data?.computed_at && `更新于 ${fmtRelative(detail.data.computed_at)}`}
          </span>
        </div>
        <CardTitle>
          <span className="flex items-center gap-2">
            <Activity size={16} />
            <span className="font-mono">{item.name}</span>
            <Badge variant={levelVariant[item.level]}>{item.level}</Badge>
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => warmup.mutate()} disabled={warmup.isPending}>
              <RefreshCw size={12} /> Warmup
            </Button>
            {(item.reasons ?? []).some(r => r.code === "disabled") ? (
              <Button size="sm" variant="primary" onClick={() => setStatus.mutate(false)}>
                <Power size={12} /> 启用
              </Button>
            ) : (
              <Button size="sm" variant="warn" onClick={() => {
                if (confirm(`禁用 ${name}？`)) setStatus.mutate(true)
              }}>
                <PowerOff size={12} /> 禁用
              </Button>
            )}
          </div>
        </CardTitle>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
          <Metric label="Score" value={item.score.toString()} />
          <Metric label="Provider" value={item.provider} />
          <Metric label="Group" value={item.group ?? "—"} />
          <Metric label="Email" value={item.email ?? "—"} />
          <Metric label="24h 请求" value={item.request_window.requests_24h.toString()} />
          <Metric label="24h 失败" value={item.request_window.failed_24h.toString()}
                  color={item.request_window.failed_24h > 0 ? "text-red-400" : undefined} />
          <Metric label="Quota P / S"
                  value={item.quota
                    ? `${item.quota.primary_remaining?.toFixed(1) ?? "—"}% / ${item.quota.secondary_remaining?.toFixed(1) ?? "—"}%`
                    : "—"} />
          <Metric label="最近请求"
                  value={item.last_request_at ? fmtRelative(item.last_request_at) : "从未"}
                  title={item.last_request_at ? fmtDate(item.last_request_at) : undefined} />
        </div>

        {item.tags && item.tags.length > 0 && (
          <div className="flex gap-1 mb-2">
            {item.tags.map(t => <Badge key={t} variant="default">{t}</Badge>)}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>诊断原因</CardTitle>
        {(item.reasons?.length ?? 0) === 0 ? (
          <Alert type="success">暂无异常原因。</Alert>
        ) : (
          <div className="space-y-1">
            {(item.reasons ?? []).map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge variant={severityBadge[r.severity]}>{r.severity}</Badge>
                <code className="text-xs text-[#e2e8f0]">{r.code}</code>
                {r.message && <span className="text-xs text-[#94a3b8]">— {r.message}</span>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>建议动作</CardTitle>
        <div className="flex flex-wrap gap-2">
          {(item.suggested_actions ?? []).map((s, i) => (
            <Badge key={i} variant={riskVariant[s.risk]}>{s.label}（{s.type}）</Badge>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>外部链接</CardTitle>
        <div className="space-y-2 text-xs">
          <Link to={requestHistoryURL} className="text-[#6c63ff] hover:underline flex items-center gap-1">
            <ExternalLink size={12} /> 请求历史 (按账号过滤)
          </Link>
          <Link to="/quota" className="text-[#6c63ff] hover:underline flex items-center gap-1">
            <ExternalLink size={12} /> Codex 配额
          </Link>
          <Link to="/audit-log" className="text-[#6c63ff] hover:underline flex items-center gap-1">
            <ExternalLink size={12} /> 审计日志
          </Link>
        </div>
      </Card>
    </div>
  )
}

function Metric({ label, value, color, title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <div className="bg-[#22263a] rounded p-2" title={title}>
      <div className="text-[0.7rem] text-[#94a3b8]">{label}</div>
      <div className={`text-sm font-mono ${color ?? "text-[#e2e8f0]"}`}>{value}</div>
    </div>
  )
}
