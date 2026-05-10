import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchTokenStats, resetTokenStats, fetchTokenStatsDailyHistory, qkeys } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"
import { Badge } from "@/components/ui/Badge"
import { Spinner } from "@/components/ui/Spinner"
import { useToast } from "@/components/ui/Toast"
import { fmtTokens, fmtUSD, fmtRelative } from "@/lib/utils"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { TokenStatEntry, TokenTotals } from "@/api/types"

type TokenStatsView = "overview" | "account" | "api_key"

interface APIKeyTokenEntry extends TokenTotals {
  api_key_hash: string
  providers: string[]
  auth_ids: string[]
  last_used_at?: number
}

export function TokenStats() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const [view, setView] = useState<TokenStatsView>("overview")

  const statsQ = useQuery({
    queryKey: qkeys.tokens(config),
    queryFn: () => fetchTokenStats(config),
    enabled: connected,
    refetchInterval: 30_000,
  })

  const historyQ = useQuery({
    queryKey: ["token-stats-daily-history", config.url, config.key],
    queryFn: () => fetchTokenStatsDailyHistory(config, 30),
    enabled: connected,
    staleTime: 5 * 60_000,
  })

  const resetMut = useMutation({
    mutationFn: () => resetTokenStats(config),
    onSuccess: () => {
      toast.success("Token 统计已重置")
      qc.invalidateQueries({ queryKey: qkeys.tokens(config) })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const today      = statsQ.data?.today
  const totals     = statsQ.data?.totals
  const entries    = [...(statsQ.data?.entries ?? [])].sort((a, b) => b.total_tokens - a.total_tokens)
  const apiKeyEntries = aggregateByAPIKey(entries)
  const startedAt  = statsQ.data?.started_at
  const chartData  = entries.slice(0, 10).map(e => ({
    name: shortAccountLabel(e.email || e.auth_id),
    tokens: e.total_tokens,
    cost: e.estimated_usd,
  }))
  const apiKeyChartData = apiKeyEntries.slice(0, 10).map(e => ({
    name: shortKeyHash(e.api_key_hash),
    tokens: e.total_tokens,
    cost: e.estimated_usd,
  }))

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          Token 使用统计
          <div className="flex gap-1.5 flex-wrap">
            <ViewButton active={view === "overview"} onClick={() => setView("overview")}>总览</ViewButton>
            <ViewButton active={view === "account"} onClick={() => setView("account")}>按账号</ViewButton>
            <ViewButton active={view === "api_key"} onClick={() => setView("api_key")}>按 API Key</ViewButton>
          </div>
        </CardTitle>
        <Alert type="info" className="text-[0.78rem]">
          Token 统计会持久化为本地快照，服务器重启后继续保留；点击重置会同时清空快照。
          {startedAt && ` 统计自 ${new Date(startedAt * 1000).toLocaleString("zh-CN")}。`}
          API Key 视图按服务端返回的 <code>api_key_hash</code> 聚合，不展示原始 key。
        </Alert>
      </Card>

      {/* 30-day historical usage chart */}
      {view === "overview" && historyQ.data && historyQ.data.records.length > 0 && (
        <Card>
          <CardTitle>
            <span>📈 近 30 天 Token 趋势</span>
            <span className="text-[0.72rem] text-[#64748b]">
              {historyQ.data.count} 天记录 · 每日 23:59 自动存档
            </span>
          </CardTitle>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={historyQ.data.records.map(r => ({
              date: r.date.slice(5),   // "MM-DD"
              tokens: r.total_tokens,
              usd: r.estimated_usd,
              requests: r.requests,
            }))} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={v => fmtTokens(v as number)} width={64} />
              <Tooltip
                contentStyle={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [
                  name === "tokens" ? fmtTokens(v) : name === "usd" ? fmtUSD(v) : String(v),
                  name === "tokens" ? "Tokens" : name === "usd" ? "花费" : "请求",
                ]}
              />
              <Bar dataKey="tokens" fill="#6c63ff" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Today */}
      {view === "overview" && <Card>
        <CardTitle>
          <span>📊 今日 Token 统计</span>
          {today?.date && (
            <span className="text-[0.72rem] text-[#64748b] font-normal">{today.date}</span>
          )}
        </CardTitle>

        {(!today || (today.total_tokens === 0 && today.requests === 0)) ? (
          <p className="text-[#64748b] text-sm py-2">今日暂无数据（等待首次请求）</p>
        ) : (
          <StatsGrid>
            <StatCard label="今日 Tokens"  value={fmtTokens(today.total_tokens)}     color="text-blue-400"    sub="输入+输出合计" />
            <StatCard label="输入 Tokens"  value={fmtTokens(today.input_tokens)}     color="text-green-400" />
            <StatCard label="输出 Tokens"  value={fmtTokens(today.output_tokens)}    color="text-purple-400" />
            <StatCard label="缓存命中"     value={fmtTokens(today.cached_tokens)}    color="text-yellow-400"  sub="上下文缓存" />
            <StatCard label="推理 Tokens"  value={fmtTokens(today.reasoning_tokens)} color="text-violet-400"  sub="思考过程" />
            <StatCard label="预估费用"     value={fmtUSD(today.estimated_usd)}       color="text-emerald-400" sub="OpenAI 官价" />
            <StatCard label="今日请求"     value={today.requests}                    color="text-green-400" />
            <StatCard label="今日失败"     value={today.failed_requests}             color="text-red-400" />
          </StatsGrid>
        )}
      </Card>}

      {/* Top accounts chart */}
      {view !== "api_key" && chartData.length > 0 && (
        <Card>
          <CardTitle>Top 账号 Token 消耗</CardTitle>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 18, bottom: 32, left: 12 }}>
                <CartesianGrid stroke="#2d3148" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  angle={-25}
                  textAnchor="end"
                  interval={0}
                  height={56}
                />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={fmtTokens} />
                <Tooltip
                  cursor={{ fill: "rgba(108,99,255,0.08)" }}
                  contentStyle={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 8, color: "#e2e8f0" }}
                  formatter={(value: number | string, name: string) => {
                    if (name === "tokens") return [fmtTokens(Number(value)), "Tokens"]
                    return [fmtUSD(Number(value)), "费用"]
                  }}
                />
                <Bar dataKey="tokens" fill="#6c63ff" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {view === "api_key" && apiKeyChartData.length > 0 && (
        <Card>
          <CardTitle>Top API Key Token 消耗</CardTitle>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={apiKeyChartData} margin={{ top: 8, right: 18, bottom: 32, left: 12 }}>
                <CartesianGrid stroke="#2d3148" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  angle={-25}
                  textAnchor="end"
                  interval={0}
                  height={56}
                />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={fmtTokens} />
                <Tooltip
                  cursor={{ fill: "rgba(108,99,255,0.08)" }}
                  contentStyle={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 8, color: "#e2e8f0" }}
                  formatter={(value: number | string, name: string) => {
                    if (name === "tokens") return [fmtTokens(Number(value)), "Tokens"]
                    return [fmtUSD(Number(value)), "费用"]
                  }}
                />
                <Bar dataKey="tokens" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Lifetime */}
      <Card>
        <CardTitle>
          {view === "overview" ? "累计总览" : view === "account" ? "按账号统计" : "按 API Key 统计"}
          <div className="flex gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: qkeys.tokens(config) })}
            >
              🔄 刷新
            </Button>
            <Button
              variant="warn"
              size="sm"
              onClick={() => confirm("确认重置 Token 统计计数？") && resetMut.mutate()}
              disabled={resetMut.isPending}
            >
              🔁 重置计数
            </Button>
          </div>
        </CardTitle>

        {totals && (
          <StatsGrid className="mb-4">
            <StatCard label="累计 Tokens"  value={fmtTokens(totals.total_tokens)}     color="text-blue-400" />
            <StatCard label="输入 Tokens"  value={fmtTokens(totals.input_tokens)}     color="text-green-400" />
            <StatCard label="输出 Tokens"  value={fmtTokens(totals.output_tokens)}    color="text-purple-400" />
            <StatCard label="缓存命中"     value={fmtTokens(totals.cached_tokens)}    color="text-yellow-400" />
            <StatCard label="推理 Tokens"  value={fmtTokens(totals.reasoning_tokens)} color="text-violet-400" />
            <StatCard label="预估费用"     value={fmtUSD(totals.estimated_usd)}       color="text-emerald-400" />
            <StatCard label="成功请求"     value={totals.requests}                    color="text-green-400" />
            <StatCard label="失败请求"     value={totals.failed_requests}             color="text-red-400" />
            <StatCard label="账号条目"     value={entries.length}                      color="text-sky-400" />
            <StatCard label="API Key 数"   value={apiKeyEntries.length}                color="text-emerald-400" sub="有 hash 的 key" />
          </StatsGrid>
        )}

        {statsQ.isLoading && (
          <div className="flex gap-2 items-center text-sm text-[#94a3b8]">
            <Spinner /> 加载中…
          </div>
        )}

        {view === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <OverviewTile title="Top 账号" value={entries[0]?.email || entries[0]?.auth_id || "-"} sub={entries[0] ? `${fmtTokens(entries[0].total_tokens)} · ${fmtUSD(entries[0].estimated_usd)}` : "暂无"} />
            <OverviewTile title="Top API Key" value={apiKeyEntries[0] ? shortKeyHash(apiKeyEntries[0].api_key_hash) : "-"} sub={apiKeyEntries[0] ? `${fmtTokens(apiKeyEntries[0].total_tokens)} · ${fmtUSD(apiKeyEntries[0].estimated_usd)}` : "暂无"} />
            <OverviewTile title="失败率" value={formatFailureRate(totals)} sub={`${totals?.failed_requests ?? 0} / ${(totals?.requests ?? 0) + (totals?.failed_requests ?? 0)} 请求`} />
          </div>
        )}

        {view === "account" && entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  {[
                    "邮箱 / ID",
                    "Provider",
                    "输入 Tokens",
                    "输出 Tokens",
                    "缓存命中",
                    "推理 Tokens",
                    "合计 Tokens",
                    "预估费用",
                    "成功请求",
                    "失败请求",
                    "最后使用",
                  ].map(h => (
                    <th
                      key={h}
                      className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const label = e.email || e.auth_id
                  const maxTotal = entries[0]?.total_tokens || 1
                  const barPct = Math.round((e.total_tokens / maxTotal) * 100)
                  return (
                    <tr
                      key={e.auth_id}
                      className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5"
                    >
                      <td
                        className="px-2 py-2 text-[#94a3b8] max-w-[180px] truncate text-xs"
                        title={[e.auth_id, e.api_key_hash ? `API Key hash: ${e.api_key_hash}` : ""].filter(Boolean).join("\n")}
                      >
                        {label}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant="default" className="text-[0.72rem]">
                          {e.provider ?? "-"}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-green-400 text-xs">
                        {fmtTokens(e.input_tokens)}
                      </td>
                      <td className="px-2 py-2 text-purple-400 text-xs">
                        {fmtTokens(e.output_tokens)}
                      </td>
                      <td className="px-2 py-2 text-yellow-400 text-xs">
                        {fmtTokens(e.cached_tokens)}
                      </td>
                      <td className="px-2 py-2 text-violet-400 text-xs">
                        {fmtTokens(e.reasoning_tokens)}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 rounded bg-[#0f1117] overflow-hidden">
                            <div
                              className="h-full bg-[#6c63ff] rounded"
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                          <b className="text-[#e2e8f0]">{fmtTokens(e.total_tokens)}</b>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-emerald-400 text-xs">
                        {fmtUSD(e.estimated_usd)}
                      </td>
                      <td className="px-2 py-2 text-green-400 text-xs">{e.requests}</td>
                      <td className="px-2 py-2 text-red-400 text-xs">{e.failed_requests}</td>
                      <td className="px-2 py-2 text-[#64748b] text-xs whitespace-nowrap">
                        {e.last_used_at ? fmtRelative(e.last_used_at) : "-"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {view === "api_key" && apiKeyEntries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  {[
                    "API Key Hash",
                    "Provider",
                    "账号数",
                    "输入 Tokens",
                    "输出 Tokens",
                    "缓存命中",
                    "推理 Tokens",
                    "合计 Tokens",
                    "预估费用",
                    "成功请求",
                    "失败请求",
                    "最后使用",
                  ].map(h => (
                    <th key={h} className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apiKeyEntries.map(e => {
                  const maxTotal = apiKeyEntries[0]?.total_tokens || 1
                  const barPct = Math.round((e.total_tokens / maxTotal) * 100)
                  return (
                    <tr key={e.api_key_hash} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
                      <td className="px-2 py-2 text-[#94a3b8] text-xs font-mono" title={e.api_key_hash}>
                        {shortKeyHash(e.api_key_hash)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1 flex-wrap">
                          {e.providers.length ? e.providers.map(p => (
                            <Badge key={p} variant="default" className="text-[0.72rem]">{p}</Badge>
                          )) : <Badge variant="default" className="text-[0.72rem]">-</Badge>}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-[#94a3b8] text-xs" title={e.auth_ids.join("\n")}>{e.auth_ids.length}</td>
                      <td className="px-2 py-2 text-green-400 text-xs">{fmtTokens(e.input_tokens)}</td>
                      <td className="px-2 py-2 text-purple-400 text-xs">{fmtTokens(e.output_tokens)}</td>
                      <td className="px-2 py-2 text-yellow-400 text-xs">{fmtTokens(e.cached_tokens)}</td>
                      <td className="px-2 py-2 text-violet-400 text-xs">{fmtTokens(e.reasoning_tokens)}</td>
                      <td className="px-2 py-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 rounded bg-[#0f1117] overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded" style={{ width: `${barPct}%` }} />
                          </div>
                          <b className="text-[#e2e8f0]">{fmtTokens(e.total_tokens)}</b>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-emerald-400 text-xs">{fmtUSD(e.estimated_usd)}</td>
                      <td className="px-2 py-2 text-green-400 text-xs">{e.requests}</td>
                      <td className="px-2 py-2 text-red-400 text-xs">{e.failed_requests}</td>
                      <td className="px-2 py-2 text-[#64748b] text-xs whitespace-nowrap">
                        {e.last_used_at ? fmtRelative(e.last_used_at) : "-"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {view === "api_key" && apiKeyEntries.length === 0 && !statsQ.isLoading && (
          <p className="text-center text-[#64748b] py-6">
            暂无可按 API Key 聚合的数据（等待带 API Key 的新请求，或旧快照缺少 api_key_hash）。
          </p>
        )}

        {view === "account" && entries.length === 0 && !statsQ.isLoading && (
          <p className="text-center text-[#64748b] py-6">暂无数据（等待首次请求）</p>
        )}
      </Card>
    </div>
  )
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={active ? "primary" : "ghost"} size="sm" onClick={onClick}>
      {children}
    </Button>
  )
}

function shortAccountLabel(value: string): string {
  if (value.length <= 24) return value
  return `${value.slice(0, 10)}…${value.slice(-10)}`
}

function shortKeyHash(value: string): string {
  if (value.length <= 16) return value
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function aggregateByAPIKey(entries: TokenStatEntry[]): APIKeyTokenEntry[] {
  const byHash = new Map<string, APIKeyTokenEntry>()
  for (const entry of entries) {
    const hash = entry.api_key_hash?.trim()
    if (!hash) continue
    let agg = byHash.get(hash)
    if (!agg) {
      agg = {
        api_key_hash: hash,
        providers: [],
        auth_ids: [],
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        estimated_usd: 0,
        requests: 0,
        failed_requests: 0,
      }
      byHash.set(hash, agg)
    }
    addUnique(agg.providers, entry.provider)
    addUnique(agg.auth_ids, entry.auth_id)
    agg.input_tokens += entry.input_tokens
    agg.output_tokens += entry.output_tokens
    agg.cached_tokens += entry.cached_tokens
    agg.reasoning_tokens += entry.reasoning_tokens
    agg.total_tokens += entry.total_tokens
    agg.estimated_usd += entry.estimated_usd
    agg.requests += entry.requests
    agg.failed_requests += entry.failed_requests
    if (entry.last_used_at && (!agg.last_used_at || entry.last_used_at > agg.last_used_at)) {
      agg.last_used_at = entry.last_used_at
    }
  }
  return [...byHash.values()]
    .map(e => ({ ...e, estimated_usd: Math.round(e.estimated_usd * 1e6) / 1e6 }))
    .sort((a, b) => b.total_tokens - a.total_tokens)
}

function addUnique(values: string[], value?: string) {
  const normalized = value?.trim()
  if (normalized && !values.includes(normalized)) values.push(normalized)
}

function formatFailureRate(totals?: TokenTotals): string {
  if (!totals) return "-"
  const all = totals.requests + totals.failed_requests
  if (!all) return "0%"
  return `${Math.round((totals.failed_requests / all) * 1000) / 10}%`
}

function OverviewTile({ title, value, sub }: { title: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-[10px] border border-[#2d3148] bg-[#11131a] p-3 min-w-0">
      <div className="text-xs text-[#64748b] mb-1">{title}</div>
      <div className="text-[#e2e8f0] font-semibold truncate" title={typeof value === "string" ? value : undefined}>{value}</div>
      <div className="text-xs text-[#94a3b8] mt-1">{sub}</div>
    </div>
  )
}
