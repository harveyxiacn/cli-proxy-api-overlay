import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchCapacityForecast } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { Button } from "@/components/ui/Button"

const riskVariant = {
  green: "green",
  amber: "yellow",
  red: "red",
  unknown: "default",
} as const

const riskColor = {
  green: "text-green-400",
  amber: "text-yellow-400",
  red: "text-red-400",
  unknown: "text-slate-400",
} as const

type Range = "1h" | "6h" | "24h"

export function CapacityForecast() {
  const { config, connected } = useConnection()
  const [range, setRange] = useState<Range>("24h")
  const data = useQuery({
    queryKey: ["capacity-forecast", config.url, config.key, range],
    queryFn: () => fetchCapacityForecast(config, { range }),
    enabled: connected,
    refetchInterval: 60_000,
  })
  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>
  const r = data.data
  return (
    <div>
      <Card>
        <CardTitle>
          <span>容量预测</span>
          <div className="flex gap-1">
            {(["1h", "6h", "24h"] as Range[]).map(rg => (
              <Button key={rg} size="sm" variant={range === rg ? "primary" : "ghost"} onClick={() => setRange(rg)}>
                {rg}
              </Button>
            ))}
          </div>
        </CardTitle>
        <Alert type="info">
          AE = Account-Equivalent。1 AE = 一个账号 7 天的 secondary 满额。预测基于 codex-quota 的最近缓存快照，请先在 Quota 页拉一次最新数据以获得准确结果。
        </Alert>

        {r && (
          <>
            <StatsGrid>
              <StatCard label="可用账号" value={r.summary.available_accounts} />
              <StatCard label="剩余 AE"  value={r.summary.secondary_capacity_remaining_ae.toFixed(2)} />
              <StatCard label="日消耗 AE" value={r.summary.burn_rate_ae_per_day.toFixed(2)} />
              <StatCard label="预计可支撑天数"
                        value={r.summary.estimated_days_remaining > 0 ? r.summary.estimated_days_remaining.toFixed(1) : "—"}
                        color={riskColor[r.summary.pool_risk]} />
              <StatCard label="池风险"
                        value={<Badge variant={riskVariant[r.summary.pool_risk]}>{r.summary.pool_risk}</Badge>} />
              <StatCard label="primary 平均压力" value={r.summary.primary_pressure_pct.toFixed(1) + "%"} />
            </StatsGrid>

            {r.recommendations && r.recommendations.length > 0 && (
              <div className="space-y-1">
                {r.recommendations.map((m, i) => <Alert key={i} type="info">{m}</Alert>)}
              </div>
            )}
          </>
        )}
      </Card>

      <Card>
        <CardTitle>分组明细</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[#94a3b8] border-b border-[#2d3148]">
              <tr>
                <th className="py-2 pr-2">group</th>
                <th className="py-2 pr-2 text-right">accounts</th>
                <th className="py-2 pr-2 text-right">remaining_ae</th>
                <th className="py-2 pr-2 text-right">burn_ae/d</th>
                <th className="py-2 pr-2 text-right">days</th>
                <th className="py-2 pr-2">risk</th>
              </tr>
            </thead>
            <tbody>
              {r?.groups.map(g => (
                <tr key={g.group} className="border-b border-[#1f2230]">
                  <td className="py-2 pr-2 font-mono">{g.group}</td>
                  <td className="py-2 pr-2 text-right">{g.accounts}</td>
                  <td className="py-2 pr-2 text-right">{g.remaining_ae.toFixed(2)}</td>
                  <td className="py-2 pr-2 text-right">{g.burn_rate_ae_per_day.toFixed(2)}</td>
                  <td className="py-2 pr-2 text-right">{g.estimated_days_remaining || "—"}</td>
                  <td className="py-2 pr-2"><Badge variant={riskVariant[g.pool_risk]}>{g.pool_risk}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(r?.groups.length ?? 0) === 0 && !data.isLoading && (
          <Alert type="success">无可用 quota 数据。先在 Quota 页拉取一次。</Alert>
        )}
      </Card>
    </div>
  )
}
