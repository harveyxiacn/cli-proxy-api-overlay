import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchPricing } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Alert } from "@/components/ui/Alert"
import { Badge } from "@/components/ui/Badge"
import { Search } from "lucide-react"

function fmtPrice(v: number): string {
  if (v === 0) return "—"
  if (v < 1) return "$" + v.toFixed(3)
  return "$" + v.toFixed(2)
}

export function Pricing() {
  const { config, connected } = useConnection()
  const [filter, setFilter] = useState("")

  const data = useQuery({
    queryKey: ["pricing", config.url, config.key],
    queryFn: () => fetchPricing(config),
    enabled: connected,
  })

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (data.data?.items ?? []).filter(r => !q || r.prefix.toLowerCase().includes(q))
  }, [data.data, filter])

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          <span>定价表（核对官方价格用）</span>
          <span className="text-xs text-[#64748b] font-normal">
            {data.data?.unit ?? "USD per 1M tokens"}
          </span>
        </CardTitle>
        <Alert type="info">
          数据来自进程内 <code>pricingTable</code>（token_stats.go）。匹配规则是模型 id 的"最长子串前缀"——
          列表按前缀长度从长到短排序，首匹配胜出。<br />
          <code>cached_input</code> 等于 <code>input</code> 表示官方在
          <a className="text-[#6c63ff] hover:underline ml-1" href="https://developers.openai.com/api/docs/pricing"
             target="_blank" rel="noreferrer">developers.openai.com/api/docs/pricing</a>
          标注 <code>"-"</code>（无缓存折扣，按 input 价计费）。<br />
          <code>reasoning</code> 列：若与 <code>output</code> 相同且标 <i>(继承)</i>，表示数据库未单独配置，复用 output rate；
          o-series 通常单独列出。
        </Alert>
        <div className="flex items-center gap-2 mb-3 bg-[#22263a] border border-[#2d3148] rounded px-2 py-1 max-w-sm">
          <Search size={12} className="text-[#64748b]" />
          <input className="bg-transparent text-xs outline-none flex-1"
                 placeholder="过滤 model 前缀（gpt-5.4 / o3 / chat-latest …）"
                 value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <div className="text-xs text-[#94a3b8] mb-2">
          显示 {filtered.length} / {data.data?.count ?? 0}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[#94a3b8] border-b border-[#2d3148]">
              <tr>
                <th className="py-2 pr-2">model 前缀</th>
                <th className="py-2 pr-2 text-right">input / 1M</th>
                <th className="py-2 pr-2 text-right">cached input / 1M</th>
                <th className="py-2 pr-2 text-right">output / 1M</th>
                <th className="py-2 pr-2 text-right">reasoning / 1M</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.prefix} className="border-b border-[#1f2230] hover:bg-[#22263a]/50">
                  <td className="py-2 pr-2 font-mono text-[#e2e8f0]">{r.prefix}</td>
                  <td className="py-2 pr-2 text-right font-mono">{fmtPrice(r.input_per_1m)}</td>
                  <td className="py-2 pr-2 text-right font-mono">
                    {fmtPrice(r.cached_input_per_1m)}
                    {r.cached_input_per_1m === r.input_per_1m && r.input_per_1m > 0 && (
                      <span className="text-[0.65rem] text-[#64748b] ml-1">(同 input)</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono">{fmtPrice(r.output_per_1m)}</td>
                  <td className="py-2 pr-2 text-right font-mono">
                    {fmtPrice(r.reasoning_per_1m)}
                    {r.reasoning_inherits_output && (
                      <Badge variant="default" className="ml-1">继承</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
