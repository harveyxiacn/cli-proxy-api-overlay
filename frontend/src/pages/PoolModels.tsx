import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchPoolModels, qkeys } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import type { PoolModelEntry } from "@/api/types"

type SortCol = "id" | "owned_by" | "available_clients"
type SortDir = "asc" | "desc"

function sortValue(m: PoolModelEntry, col: SortCol): string | number {
  switch (col) {
    case "id":                return (m.id ?? "").toLowerCase()
    case "owned_by":          return (m.owned_by ?? "").toLowerCase()
    case "available_clients": return m.available_clients ?? 0
  }
}

function fmtK(n?: number): string {
  if (!n || n <= 0) return "-"
  if (n < 1000) return String(n)
  return `${Math.round(n / 1000)}k`
}

export function PoolModels() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()

  const [q, setQ] = useState("")
  const [provider, setProvider] = useState("")
  const [status, setStatus] = useState("")
  const [sortCol, setSortCol] = useState<SortCol>("available_clients")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const poolQ = useQuery({
    queryKey: qkeys.poolModels(config),
    queryFn: () => fetchPoolModels(config),
    enabled: connected,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const models = poolQ.data?.models ?? []

  const providerOptions = useMemo(() => {
    const set = new Set<string>()
    models.forEach(m => m.providers?.forEach(p => p?.name && set.add(p.name)))
    return [...set].sort()
  }, [models])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    let rows = models.filter(m => {
      if (ql && !((m.id ?? "").toLowerCase().includes(ql) || (m.display_name ?? "").toLowerCase().includes(ql))) return false
      if (provider && !(m.providers ?? []).some(p => p?.name === provider)) return false
      if (status === "available"      && (m.available_clients ?? 0) <= 0) return false
      if (status === "exhausted"      && (m.available_clients ?? 0) > 0) return false
      if (status === "degraded"       && (m.quota_exceeded ?? 0) === 0 && (m.suspended ?? 0) === 0) return false
      return true
    })
    rows = [...rows].sort((a, b) => {
      const va = sortValue(a, sortCol), vb = sortValue(b, sortCol)
      const cmp = (typeof va === "number" && typeof vb === "number")
        ? va - vb
        : String(va).localeCompare(String(vb))
      return sortDir === "asc" ? cmp : -cmp
    })
    return rows
  }, [models, q, provider, status, sortCol, sortDir])

  const totals = useMemo(() => {
    let totalClients = 0, available = 0, quota = 0, suspended = 0
    models.forEach(m => {
      totalClients += m.total_clients ?? 0
      available    += m.available_clients ?? 0
      quota        += m.quota_exceeded ?? 0
      suspended    += m.suspended ?? 0
    })
    return { totalClients, available, quota, suspended }
  }, [models])

  const onSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir(col === "available_clients" ? "desc" : "asc") }
  }
  const sortIndicator = (col: SortCol) => sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : ""

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          <span>🧩 当前账号池支持的模型</span>
          <div className="flex gap-1.5 items-center">
            <span className="text-[0.72rem] text-[#64748b]">
              {poolQ.dataUpdatedAt ? new Date(poolQ.dataUpdatedAt).toLocaleTimeString("zh-CN") : ""}
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: qkeys.poolModels(config) })}
            >
              🔄 刷新
            </Button>
          </div>
        </CardTitle>

        <Alert type="info" className="text-[0.78rem]">
          汇总自全局 Model Registry：列出所有当前至少有一个 client 注册的模型（codex / anthropic / gemini / kimi / antigravity 等）。
          可用客户端 = 注册 client 数 - 配额耗尽 - 主动挂起。每 60 秒自动刷新。
        </Alert>

        <StatsGrid className="mb-4">
          <StatCard label="模型总数"      value={models.length}        color="text-blue-400" />
          <StatCard label="累计 Client"   value={totals.totalClients}  color="text-violet-400" />
          <StatCard label="可用 Client"   value={totals.available}     color="text-green-400" />
          <StatCard label="配额耗尽"      value={totals.quota}         color="text-yellow-400" />
          <StatCard label="主动挂起"      value={totals.suspended}     color="text-orange-400" />
        </StatsGrid>

        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <Input
            placeholder="按模型 id / display_name 过滤"
            value={q}
            onChange={e => setQ(e.target.value)}
            className="w-[260px]"
          />
          <Select
            value={provider}
            onChange={setProvider}
            className="w-[200px]"
            placeholder="全部 Provider"
            options={providerOptions.map(p => ({ value: p, label: p }))}
          />
          <Select
            value={status}
            onChange={setStatus}
            className="w-[220px]"
            placeholder="全部状态"
            options={[
              { value: "available", label: "可用 (available_clients > 0)" },
              { value: "degraded",  label: "降级 (有配额耗尽或挂起)" },
              { value: "exhausted", label: "不可用 (available_clients = 0)" },
            ]}
          />
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setProvider(""); setStatus("") }}>清除</Button>
          <span className="text-sm text-[#94a3b8]">共 {filtered.length} 条</span>
        </div>

        {poolQ.isLoading && (
          <div className="flex gap-2 items-center text-sm text-[#94a3b8]">
            <Spinner /> 加载中…
          </div>
        )}
        {poolQ.isError && (
          <Alert type="error">加载失败: {(poolQ.error as Error)?.message ?? "未知错误"}</Alert>
        )}

        {!poolQ.isLoading && !poolQ.isError && (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  <th
                    className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap cursor-pointer select-none"
                    onClick={() => onSort("id")}
                  >模型 ID{sortIndicator("id")}</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">名称 / 描述</th>
                  <th
                    className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap cursor-pointer select-none"
                    onClick={() => onSort("owned_by")}
                  >Owner{sortIndicator("owned_by")}</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">Provider 分布</th>
                  <th
                    className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap cursor-pointer select-none"
                    onClick={() => onSort("available_clients")}
                    title="排除配额耗尽与挂起后的可用 client 数"
                  >可用 / 总数{sortIndicator("available_clients")}</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium" title="近 5 分钟内 quota_exceeded">配额耗尽</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium" title="主动挂起的 client 数">挂起</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">能力</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-[#64748b] py-6">暂无数据（无 client 注册或尚未连接成功）</td></tr>
                )}
                {filtered.map(m => {
                  const total = m.total_clients ?? 0
                  const avail = m.available_clients ?? 0
                  const availColor = avail === 0 ? "text-red-400" : (avail < total ? "text-yellow-400" : "text-green-400")
                  const qe = m.quota_exceeded ?? 0
                  const sus = m.suspended ?? 0
                  return (
                    <tr key={m.id} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5 align-top">
                      <td className="px-2 py-2 text-[#e2e8f0] whitespace-nowrap">
                        <code className="text-[0.78rem]">{m.id}</code>
                      </td>
                      <td className="px-2 py-2 text-xs text-[#94a3b8] max-w-[420px]">
                        {m.display_name && <div className="text-[#e2e8f0]">{m.display_name}</div>}
                        {m.description && (
                          <div className="text-[0.72rem] text-[#64748b] truncate" title={m.description}>{m.description}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {m.owned_by
                          ? <Badge variant="default" className="text-[0.72rem]">{m.owned_by}</Badge>
                          : <span className="text-[#64748b] text-xs">-</span>}
                      </td>
                      <td className="px-2 py-2">
                        {(m.providers && m.providers.length)
                          ? m.providers.map(p => (
                              <Badge key={p.name} variant="blue" className="text-[0.7rem] mr-1" title="该 provider 当前注册的 client 数">
                                {p.name} × {p.count}
                              </Badge>
                            ))
                          : <span className="text-[#64748b] text-xs">-</span>}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <b className={availColor}>{avail}</b>
                        <span className="text-[#64748b] text-xs"> / {total}</span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {qe > 0
                          ? <Badge variant="yellow" className="text-[0.72rem]">{qe}</Badge>
                          : <span className="text-[#64748b] text-xs">-</span>}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {sus > 0
                          ? <Badge variant="yellow" className="text-[0.72rem]">{sus}</Badge>
                          : <span className="text-[#64748b] text-xs">-</span>}
                      </td>
                      <td className="px-2 py-2 text-[0.72rem] text-[#94a3b8] whitespace-nowrap">
                        {m.context_length            && <span title="context_length" className="mr-2">📏 {fmtK(m.context_length)}</span>}
                        {m.max_completion_tokens     && <span title="max_completion_tokens" className="mr-2">📝 {fmtK(m.max_completion_tokens)}</span>}
                        {m.thinking_levels?.length   ? <span title={`thinking levels: ${m.thinking_levels.join(", ")}`}>🧠 {m.thinking_levels.join("/")}</span> : null}
                        {!m.context_length && !m.max_completion_tokens && !m.thinking_levels?.length && (
                          <span className="text-[#64748b] text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
