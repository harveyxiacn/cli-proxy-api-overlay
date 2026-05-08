import { useQuery } from "@tanstack/react-query"
import { fetchAPIKeyInsights } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import type { APIKeyInsightItem } from "@/api/types"
import { fmtTokens, fmtUSD, fmtRelative } from "@/lib/utils"

const statusVariant = {
  ok: "green",
  warn: "yellow",
  exceeded: "red",
  unused: "default",
  high_failure: "orange",
} as const

export function ApiKeyInsights() {
  const { config, connected } = useConnection()
  const data = useQuery({
    queryKey: ["api-key-insights", config.url, config.key],
    queryFn: () => fetchAPIKeyInsights(config),
    enabled: connected,
    refetchInterval: 30_000,
  })
  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>
  const r = data.data
  return (
    <div>
      <Card>
        <CardTitle>API Key 画像</CardTitle>
        <Alert type="info">
          "unused" 判定依赖于内存请求历史的可见窗口（约 {((r?.summary.window_seconds ?? 0) / 3600).toFixed(1)}h）。
          完整 30 天判定需启用 SQLite 分析库。
        </Alert>
        <StatsGrid>
          <StatCard label="已配置"   value={r?.summary.configured ?? 0} />
          <StatCard label="今日活跃" value={r?.summary.active_today ?? 0} color="text-green-400" />
          <StatCard label="窗口内未用" value={r?.summary.unused_within_window ?? 0} color="text-slate-400" />
          <StatCard label="超限"     value={r?.summary.over_limit ?? 0} color="text-red-400" />
          <StatCard label="高失败率" value={r?.summary.high_failure ?? 0} color="text-orange-400" />
        </StatsGrid>
      </Card>
      <Card>
        <CardTitle>API Keys</CardTitle>
        {r?.items.length === 0 && !data.isLoading && (
          <Alert type="success">尚无 API Key 数据。</Alert>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[#94a3b8] border-b border-[#2d3148]">
              <tr>
                <th className="py-2 pr-2">Key</th>
                <th className="py-2 pr-2">状态</th>
                <th className="py-2 pr-2 text-right">今日 / 限额</th>
                <th className="py-2 pr-2 text-right">7d Tokens</th>
                <th className="py-2 pr-2 text-right">7d USD</th>
                <th className="py-2 pr-2 text-right">24h 失败率</th>
                <th className="py-2 pr-2 text-right">最近使用</th>
                <th className="py-2 pr-2">原因</th>
              </tr>
            </thead>
            <tbody>
              {r?.items.map(it => <Row key={it.hash} it={it} />)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Row({ it }: { it: APIKeyInsightItem }) {
  const usagePct = it.daily_limit && it.daily_limit > 0 ? (it.today_tokens / it.daily_limit * 100) : null
  return (
    <tr className="border-b border-[#1f2230] hover:bg-[#22263a]/50">
      <td className="py-2 pr-2">
        <div className="font-mono text-[#e2e8f0]">{it.preview ?? it.hash.slice(0, 12) + "…"}</div>
        <div className="text-[0.65rem] text-[#64748b]">{it.name ?? it.hash}</div>
      </td>
      <td className="py-2 pr-2"><Badge variant={statusVariant[it.status]}>{it.status}</Badge></td>
      <td className="py-2 pr-2 text-right font-mono">
        {fmtTokens(it.today_tokens)}
        {it.daily_limit ? <span className="text-[#64748b]"> / {fmtTokens(it.daily_limit)}</span> : null}
        {usagePct !== null && (
          <div className="text-[0.65rem] text-[#94a3b8]">{usagePct.toFixed(1)}%</div>
        )}
      </td>
      <td className="py-2 pr-2 text-right font-mono">{fmtTokens(it.seven_day_tokens)}</td>
      <td className="py-2 pr-2 text-right font-mono text-green-400">{fmtUSD(it.estimated_usd_7d)}</td>
      <td className="py-2 pr-2 text-right font-mono">{(it.failure_rate_24h * 100).toFixed(1)}%</td>
      <td className="py-2 pr-2 text-right text-[#94a3b8]">{it.last_used_at ? fmtRelative(it.last_used_at) : "—"}</td>
      <td className="py-2 pr-2 text-[#94a3b8]">
        {(it.reasons ?? []).map(r => (
          <div key={r} className="text-[0.65rem]">· {r}</div>
        ))}
      </td>
    </tr>
  )
}
