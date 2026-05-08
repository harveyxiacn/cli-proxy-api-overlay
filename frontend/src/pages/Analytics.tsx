import { useQuery } from "@tanstack/react-query"
import {
  fetchErrorsAnalytics, fetchStorageSummary, fetchTopAuthsAnalytics,
  fetchUsageDailyAnalytics, fetchUsageHourlyAnalytics, qkeys
} from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Alert } from "@/components/ui/Alert"
import { Badge } from "@/components/ui/Badge"
import { fmtTokens, fmtUSD } from "@/lib/utils"
import type { UsageAggregate } from "@/api/types"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts"

const tooltipContentStyle = {
  background: "#1a1d27",
  border: "1px solid #2d3148",
  borderRadius: 8,
  fontSize: 12,
  color: "#e2e8f0",
}

export function Analytics() {
  const { config, connected } = useConnection()
  const daily = useQuery({
    queryKey: [...qkeys.analytics(config), "daily"],
    queryFn:  () => fetchUsageDailyAnalytics(config),
    enabled:  connected,
  })
  const hourly = useQuery({
    queryKey: [...qkeys.analytics(config), "hourly"],
    queryFn:  () => fetchUsageHourlyAnalytics(config),
    enabled:  connected,
    refetchInterval: 30_000,
  })
  const top = useQuery({
    queryKey: [...qkeys.analytics(config), "top-auths"],
    queryFn:  () => fetchTopAuthsAnalytics(config),
    enabled:  connected,
  })
  const errors = useQuery({
    queryKey: [...qkeys.analytics(config), "errors"],
    queryFn:  () => fetchErrorsAnalytics(config),
    enabled:  connected,
  })
  const storage = useQuery({
    queryKey: [...qkeys.analytics(config), "storage"],
    queryFn:  () => fetchStorageSummary(config),
    enabled:  connected,
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  // Format hourly data for chart
  const hourlyChartData = (hourly.data?.items ?? []).map(h => ({
    hour: typeof h.hour === "string" ? h.hour.slice(11, 16) : String(h.hour ?? ""),
    success: Number(h.requests ?? 0),
    failed:  Number(h.failed_requests ?? 0),
    tokens:  Number(h.total_tokens ?? 0),
  })).slice(-24)

  return (
    <div>
      {/* Storage layer overview */}
      <Card>
        <CardTitle>存储与分析层</CardTitle>
        <div className="text-sm text-[#94a3b8] flex items-center gap-3 flex-wrap">
          <span>当前模式：<Badge variant="default">{storage.data?.mode ?? "-"}</Badge></span>
          <span>SQLite：{storage.data?.sqlite_enabled ? <Badge variant="green">已启用</Badge> : <Badge variant="default">未启用（JSONL/JSON 快照）</Badge>}</span>
          <span className="text-[#64748b]">已加载记录：{storage.data?.records_loaded ?? 0} / 容量 {storage.data?.request_history_capacity ?? 0}</span>
        </div>
      </Card>

      {/* Hourly chart - new */}
      <Card>
        <CardTitle>近 24 小时趋势</CardTitle>
        {hourlyChartData.length === 0 ? (
          <p className="text-[#64748b] text-sm py-4 text-center">暂无小时级数据</p>
        ) : (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={hourlyChartData} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
                <XAxis dataKey="hour" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  cursor={{ fill: "rgba(108,99,255,.08)" }}
                  formatter={(v: number, n: string) => {
                    if (n === "tokens") return [fmtTokens(v), "Tokens"]
                    if (n === "success") return [v, "成功"]
                    if (n === "failed")  return [v, "失败"]
                    return [v, n]
                  }}
                />
                <Bar dataKey="success" fill="#6c63ff" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed"  fill="#ef4444" stackId="a" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Daily aggregate */}
      <Card>
        <CardTitle>每日用量</CardTitle>
        <Table rows={daily.data?.items ?? []} first="day" />
      </Card>

      {/* Top accounts */}
      <Card>
        <CardTitle>Top 账号</CardTitle>
        <Table rows={top.data?.items ?? []} first="auth_id" />
      </Card>

      {/* Error distribution */}
      <Card>
        <CardTitle>错误分布</CardTitle>
        {(errors.data?.items ?? []).length === 0 ? (
          <p className="text-[#64748b] text-sm py-3">暂无错误记录</p>
        ) : (
          <div className="space-y-1 text-sm">
            {errors.data?.items.map((e, i) => (
              <div key={i} className="flex justify-between border-b border-[#2d3148] py-1.5 px-2 hover:bg-[#6c63ff]/5">
                <span>
                  {e.provider ? <Badge variant="default" className="mr-1">{e.provider}</Badge> : null}
                  <span className="text-[#94a3b8]">{e.model || "(unknown model)"}</span>
                </span>
                <span className="text-red-400 font-semibold">{String(e.count)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Table({ rows, first }: { rows: UsageAggregate[]; first: keyof UsageAggregate }) {
  if (rows.length === 0) return <div className="text-sm text-[#64748b] py-3">暂无数据。</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[#64748b] bg-[#22263a]">
            <th className="px-2 py-2">{String(first)}</th>
            <th className="px-2 py-2">请求</th>
            <th className="px-2 py-2">失败</th>
            <th className="px-2 py-2">Tokens</th>
            <th className="px-2 py-2">费用</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
              <td className="px-2 py-1.5 text-[#94a3b8]">{String(r[first] ?? "-")}</td>
              <td className="px-2 py-1.5 text-green-400">{String(r.requests ?? 0)}</td>
              <td className="px-2 py-1.5 text-red-400">{String(r.failed_requests ?? 0)}</td>
              <td className="px-2 py-1.5 text-blue-400">{fmtTokens(Number(r.total_tokens ?? 0))}</td>
              <td className="px-2 py-1.5 text-emerald-400">{fmtUSD(Number(r.estimated_usd ?? 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
