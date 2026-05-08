import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchRequestHistory, clearRequestHistory, qkeys } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { Input } from "@/components/ui/Input"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { useToast } from "@/components/ui/Toast"
import { fmtTokens, fmtUSD, fmtRelative } from "@/lib/utils"

export function RequestHistory() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()

  const [limit, setLimit]         = useState(200)
  const [page, setPage]           = useState(1)
  const [query, setQuery]         = useState("")
  const [status, setStatus]       = useState("all")
  const [model, setModel]         = useState("")
  const [provider, setProvider]   = useState("")
  const [afterLocal, setAfterLocal] = useState("")
  const [beforeLocal, setBeforeLocal] = useState("")

  const afterTs = toUnixSeconds(afterLocal)
  const beforeTs = toUnixSeconds(beforeLocal)
  const offset = Math.max(0, (page - 1) * limit)

  const histQ = useQuery({
    queryKey: [...qkeys.history(config), limit, offset, query, status, model, provider, afterTs, beforeTs],
    queryFn: () => fetchRequestHistory(config, {
      limit,
      offset,
      q: query || undefined,
      status,
      model: model || undefined,
      provider: provider || undefined,
      afterTs,
      beforeTs,
    }),
    enabled: connected,
    refetchInterval: 15_000,
  })

  const clearMut = useMutation({
    mutationFn: () => clearRequestHistory(config),
    onSuccess: () => {
      toast.success("请求历史已清空")
      qc.invalidateQueries({ queryKey: qkeys.history(config) })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  const records = histQ.data?.records ?? []
  const summary = histQ.data?.summary
  const total = histQ.data?.total ?? histQ.data?.count ?? records.length
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.min(page, totalPages)

  return (
    <div>
      <Card>
        <CardTitle>
          请求历史
          <div className="flex gap-1.5 items-center">
            <span className="text-[0.78rem] text-[#64748b]">当前 {records.length} / {total} 条</span>
            <Button variant="primary" size="sm" onClick={() => qc.invalidateQueries({ queryKey: qkeys.history(config) })}>
              🔄 刷新
            </Button>
            <Button variant="danger" size="sm"
              onClick={() => confirm("确认清空所有请求历史？") && clearMut.mutate()}
              disabled={clearMut.isPending}>
              🗑 清空
            </Button>
          </div>
        </CardTitle>

        <Alert type="info" className="text-[0.78rem]">
          本地持久化保留最近 5000 条请求，每 15 秒自动刷新；清空请求历史会同时清空持久化文件。
          展示从 <code>usage.Manager</code> 接收的 Token 计数（按 OpenAI 官价估算费用）。
        </Alert>

        {/* Filter bar */}
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <Input
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(1) }}
            placeholder="搜索路径 / 账号 / Key hash"
            className="w-[210px]"
          />
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); setPage(1) }}
            className="bg-[#0f1117] border border-[#2d3148] rounded-md text-[#e2e8f0] px-2.5 py-1.5 text-[0.83rem] cursor-pointer focus:outline-none focus:border-[#6c63ff]"
          >
            <option value="all">全部结果</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
            <option value="2xx">2xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
          </select>
          <Input
            value={model} onChange={e => { setModel(e.target.value); setPage(1) }}
            placeholder="模型过滤 (gpt-4o)" className="w-[140px]"
          />
          <Input
            value={provider} onChange={e => { setProvider(e.target.value); setPage(1) }}
            placeholder="Provider 过滤" className="w-[140px]"
          />
          <select
            value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1) }}
            className="bg-[#0f1117] border border-[#2d3148] rounded-md text-[#e2e8f0] px-2.5 py-1.5 text-[0.83rem] cursor-pointer focus:outline-none focus:border-[#6c63ff]"
          >
            {[100, 200, 500, 1000, 5000].map(n => <option key={n} value={n}>显示 {n} 条</option>)}
          </select>
          <Input
            type="datetime-local"
            value={afterLocal}
            onChange={e => { setAfterLocal(e.target.value); setPage(1) }}
            className="w-[190px]"
            title="开始时间"
          />
          <Input
            type="datetime-local"
            value={beforeLocal}
            onChange={e => { setBeforeLocal(e.target.value); setPage(1) }}
            className="w-[190px]"
            title="结束时间"
          />
          {(afterLocal || beforeLocal) && (
            <Button variant="ghost" size="sm" onClick={() => { setAfterLocal(""); setBeforeLocal(""); setPage(1) }}>
              清除时间
            </Button>
          )}
        </div>

        {/* Summary stats */}
        {summary && (
          <StatsGrid>
            <StatCard label="成功请求" value={summary.requests}                   color="text-green-400" />
            <StatCard label="失败请求" value={summary.failed_requests}            color="text-red-400" />
            <StatCard label="合计 Tokens" value={fmtTokens(summary.total_tokens)}  color="text-blue-400" />
            <StatCard label="输入 Tokens" value={fmtTokens(summary.input_tokens)}  color="text-green-400" />
            <StatCard label="输出 Tokens" value={fmtTokens(summary.output_tokens)} color="text-purple-400" />
            <StatCard label="缓存命中"   value={fmtTokens(summary.cached_tokens)}  color="text-yellow-400" />
            <StatCard label="预估费用"   value={fmtUSD(summary.estimated_usd)}     color="text-emerald-400" />
          </StatsGrid>
        )}

        {histQ.isLoading && (
          <div className="flex gap-2 items-center text-sm text-[#94a3b8] py-4">
            <Spinner /> 加载中…
          </div>
        )}

        {histQ.isError && (
          <Alert type="error">
            加载失败：{histQ.error instanceof Error ? histQ.error.message : "未知错误"}
          </Alert>
        )}

        {/* Table */}
        {records.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  {["时间","HTTP","路径","结果","模型","Provider","账号/Email","输入","输出","缓存","推理","合计","费用","延迟"].map(h => (
                    <th key={h} className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
                    <td className="px-2 py-1.5 text-[#64748b] text-xs whitespace-nowrap" title={new Date(r.ts * 1000).toLocaleString("zh-CN")}>
                      {fmtRelative(r.ts)}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <HttpStatusBadge code={r.status_code} failed={r.failed} />
                    </td>
                    <td className="px-2 py-1.5 text-[#94a3b8] text-xs max-w-[180px]" title={`${r.method || ""} ${r.path || ""}`.trim()}>
                      <div className="truncate">
                        {r.method && <span className="font-mono text-[#64748b] mr-1">{r.method}</span>}
                        {r.path || "-"}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.failed
                        ? <Badge variant="red"   className="text-[0.7rem]">✗ 失败</Badge>
                        : <Badge variant="green" className="text-[0.7rem]">✓ 成功</Badge>
                      }
                    </td>
                    <td className="px-2 py-1.5 text-[#94a3b8] text-xs" title={r.alias && r.alias !== r.model ? `请求别名: ${r.alias}` : undefined}>
                      {r.model || "-"}
                      {r.alias && r.alias !== r.model && <span className="ml-1 text-[#64748b]">({r.alias})</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge variant="default" className="text-[0.7rem]">{r.provider || "-"}</Badge>
                    </td>
                    <td className="px-2 py-1.5 text-[#94a3b8] text-xs max-w-[190px] truncate" title={[r.email, r.auth_id, r.auth_index, r.api_key_hash].filter(Boolean).join("\n")}>
                      {r.email || r.source || r.auth_id || r.api_key_hash || "-"}
                    </td>
                    <td className="px-2 py-1.5 text-green-400 text-xs">{fmtTokens(r.input_tokens)}</td>
                    <td className="px-2 py-1.5 text-purple-400 text-xs">{fmtTokens(r.output_tokens)}</td>
                    <td className="px-2 py-1.5 text-yellow-400 text-xs">{fmtTokens(r.cached_tokens)}</td>
                    <td className="px-2 py-1.5 text-violet-400 text-xs">{fmtTokens(r.reasoning_tokens)}</td>
                    <td className="px-2 py-1.5 text-blue-400 text-xs font-semibold">{fmtTokens(r.total_tokens)}</td>
                    <td className="px-2 py-1.5 text-emerald-400 text-xs">{fmtUSD(r.estimated_usd)}</td>
                    <td className="px-2 py-1.5 text-[#64748b] text-xs">{r.latency_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > limit && (
          <div className="flex items-center justify-between gap-3 mt-3 text-xs text-[#64748b]">
            <span>第 {currentPage} / {totalPages} 页</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                上一页
              </Button>
              <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                下一页
              </Button>
            </div>
          </div>
        )}

        {records.length === 0 && !histQ.isLoading && !histQ.isError && (
          <p className="text-center text-[#64748b] py-6">
            暂无请求记录{query || status !== "all" || model || provider ? "（在过滤条件下）" : "（等待首次代理请求）"}
          </p>
        )}
      </Card>
    </div>
  )
}

function HttpStatusBadge({ code, failed }: { code?: number; failed?: boolean }) {
  if (!code) {
    return failed
      ? <Badge variant="red" className="text-[0.7rem]">ERR</Badge>
      : <Badge variant="default" className="text-[0.7rem]">-</Badge>
  }
  const variant = code >= 500 ? "red" : code >= 400 ? "yellow" : code >= 300 ? "blue" : "green"
  return <Badge variant={variant} className="text-[0.7rem]">{code}</Badge>
}

function toUnixSeconds(value: string): number | undefined {
  if (!value) return undefined
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return undefined
  return Math.floor(ms / 1000)
}
