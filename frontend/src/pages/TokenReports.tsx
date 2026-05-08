import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  fetchTokenReportSummary, fetchTokenReportByModel, fetchTokenReportByProvider,
  fetchTokenReportByAPIKey, fetchTokenReportByAccount,
} from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Alert } from "@/components/ui/Alert"
import { Button } from "@/components/ui/Button"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import type { TokenReportItem } from "@/api/types"
import { fmtTokens, fmtUSD } from "@/lib/utils"
import { Download } from "lucide-react"

type Range = "24h" | "7d" | "30d"
type Tab = "model" | "provider" | "api-key" | "account"

export function TokenReports() {
  const { config, connected } = useConnection()
  const [range, setRange] = useState<Range>("24h")
  const [tab, setTab] = useState<Tab>("model")

  const summary = useQuery({
    queryKey: ["token-reports", "summary", config.url, config.key, range],
    queryFn: () => fetchTokenReportSummary(config, range),
    enabled: connected,
    staleTime: 30_000,
  })

  const byTab = useQuery({
    queryKey: ["token-reports", tab, config.url, config.key, range],
    queryFn: () => {
      switch (tab) {
        case "model": return fetchTokenReportByModel(config, range)
        case "provider": return fetchTokenReportByProvider(config, range)
        case "api-key": return fetchTokenReportByAPIKey(config, range)
        case "account": return fetchTokenReportByAccount(config, range)
      }
    },
    enabled: connected,
    staleTime: 30_000,
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>
  const sum = summary.data
  const breakdown = byTab.data

  return (
    <div>
      <Card>
        <CardTitle>
          <span>Token 报表</span>
          <div className="flex gap-2 items-center">
            {(["24h", "7d", "30d"] as Range[]).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`text-xs px-2 py-1 rounded ${range === r ? "bg-[#6c63ff] text-white" : "bg-[#22263a] text-[#94a3b8] hover:bg-[#2d3148]"}`}>
                {r}
              </button>
            ))}
            <a href={`${config.url.replace(/\/$/, "")}/v0/management/token-reports/export.csv?range=${range}`}
               target="_blank" rel="noreferrer"
               className="text-xs text-[#6c63ff] hover:underline flex items-center gap-1">
              <Download size={12} /> CSV
            </a>
          </div>
        </CardTitle>
        {sum?.truncated && (
          <Alert type="warn">
            request_history ring buffer 不足以覆盖完整的 {range} 区间，实际窗口约 {(sum.actual_range_seconds / 3600).toFixed(1)}h。完整 30 天数据需启用 SQLite 分析库（P3）。
          </Alert>
        )}
        <StatsGrid>
          <StatCard label="请求数"     value={sum?.totals.requests ?? 0} />
          <StatCard label="失败请求"   value={sum?.totals.failed_requests ?? 0}
                    color={(sum?.totals.failed_requests ?? 0) > 0 ? "text-red-400" : undefined} />
          <StatCard label="Input"      value={fmtTokens(sum?.totals.input_tokens ?? 0)} />
          <StatCard label="Output"     value={fmtTokens(sum?.totals.output_tokens ?? 0)} />
          <StatCard label="Cached"     value={fmtTokens(sum?.totals.cached_tokens ?? 0)} />
          <StatCard label="Reasoning"  value={fmtTokens(sum?.totals.reasoning_tokens ?? 0)} />
          <StatCard label="Total"      value={fmtTokens(sum?.totals.total_tokens ?? 0)}
                    color="text-[#6c63ff]" />
          <StatCard label="USD"        value={fmtUSD(sum?.totals.estimated_usd ?? 0)} color="text-green-400" />
        </StatsGrid>
      </Card>

      <Card>
        <CardTitle>
          <div className="flex gap-1">
            {([
              ["model", "按模型"],
              ["provider", "按 Provider"],
              ["api-key", "按 API Key"],
              ["account", "按账号"],
            ] as [Tab, string][]).map(([t, label]) => (
              <Button key={t} size="sm"
                variant={tab === t ? "primary" : "ghost"}
                onClick={() => setTab(t)}>
                {label}
              </Button>
            ))}
          </div>
        </CardTitle>

        {byTab.isLoading && <div className="text-sm text-[#94a3b8]">加载中…</div>}
        {breakdown && breakdown.items.length === 0 && (
          <Alert type="success">当前窗口内无请求数据。</Alert>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[#94a3b8] border-b border-[#2d3148]">
              <tr>
                <th className="py-2 pr-2">key</th>
                <th className="py-2 pr-2 text-right">requests / failed</th>
                <th className="py-2 pr-2 text-right">failure_rate</th>
                <th className="py-2 pr-2 text-right">input</th>
                <th className="py-2 pr-2 text-right">output</th>
                <th className="py-2 pr-2 text-right">total</th>
                <th className="py-2 pr-2 text-right">USD</th>
              </tr>
            </thead>
            <tbody>
              {breakdown?.items.slice(0, 50).map(it => <ReportRow key={it.key} it={it} />)}
            </tbody>
          </table>
          {breakdown && breakdown.items.length > 50 && (
            <div className="text-[0.7rem] text-[#64748b] mt-2">仅显示前 50 项；导出 CSV 获取完整数据。</div>
          )}
        </div>
      </Card>
    </div>
  )
}

function ReportRow({ it }: { it: TokenReportItem }) {
  return (
    <tr className="border-b border-[#1f2230] hover:bg-[#22263a]/50">
      <td className="py-2 pr-2 font-mono text-[#e2e8f0]">{it.key}</td>
      <td className="py-2 pr-2 text-right font-mono">
        {it.requests}
        <span className="text-[#64748b]"> / </span>
        <span className={it.failed_requests > 0 ? "text-red-400" : "text-[#64748b]"}>{it.failed_requests}</span>
      </td>
      <td className="py-2 pr-2 text-right font-mono">{(it.failure_rate * 100).toFixed(2)}%</td>
      <td className="py-2 pr-2 text-right font-mono">{fmtTokens(it.input_tokens)}</td>
      <td className="py-2 pr-2 text-right font-mono">{fmtTokens(it.output_tokens)}</td>
      <td className="py-2 pr-2 text-right font-mono">{fmtTokens(it.total_tokens)}</td>
      <td className="py-2 pr-2 text-right font-mono text-green-400">{fmtUSD(it.estimated_usd)}</td>
    </tr>
  )
}
