import { useQuery } from "@tanstack/react-query"
import { fetchAPIKeyUsage, fetchAPIKeys } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"

interface ApiKeysResponse {
  "api-keys"?: string[]
}

export function ApiKeys() {
  const { config, connected } = useConnection()
  const keysQ = useQuery({
    queryKey: ["api-keys", config.url, config.key],
    queryFn: () => fetchAPIKeys(config) as Promise<ApiKeysResponse>,
    enabled: connected,
  })
  const usageQ = useQuery({
    queryKey: ["api-key-usage", config.url, config.key],
    queryFn: () => fetchAPIKeyUsage(config),
    enabled: connected,
    refetchInterval: 30_000,
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  const keys = keysQ.data?.["api-keys"] ?? []
  const usage = usageQ.data ?? {}

  // Aggregate per-provider totals
  let totalKeys = 0
  let totalSuccess = 0
  let totalFailed = 0
  const providerRows: { provider: string; keyCount: number; success: number; failed: number }[] = []
  for (const [provider, perKey] of Object.entries(usage)) {
    let success = 0, failed = 0
    const keyCount = Object.keys(perKey).length
    for (const stats of Object.values(perKey)) {
      success += stats.success ?? 0
      failed += stats.failed ?? 0
    }
    totalKeys += keyCount
    totalSuccess += success
    totalFailed += failed
    providerRows.push({ provider, keyCount, success, failed })
  }
  providerRows.sort((a, b) => (b.success + b.failed) - (a.success + a.failed))

  // Mask key for display
  const maskKey = (k: string): string => {
    if (k.length <= 12) return k
    return k.slice(0, 6) + "…" + k.slice(-4)
  }

  return (
    <div>
      <Card>
        <CardTitle>
          API Key 概览
          <span className="text-xs text-[#64748b]">配置 {keys.length} 个 · 实际使用 {totalKeys} 个</span>
        </CardTitle>
        <Alert type="info" className="text-[0.78rem]">
          展示已配置的 API Key 和按 Provider 聚合的实际使用情况。
          密钥的创建/删除请通过 <code>config.yaml</code> 或 <code>PUT /v0/management/api-keys</code> 操作。
        </Alert>
        <StatsGrid>
          <StatCard label="配置 Key 数" value={keys.length}    color="text-blue-400" />
          <StatCard label="活跃 Provider" value={providerRows.length} color="text-purple-400" />
          <StatCard label="累计成功" value={totalSuccess}      color="text-green-400" />
          <StatCard label="累计失败" value={totalFailed}       color="text-red-400" />
        </StatsGrid>
      </Card>

      {/* Configured keys list */}
      <Card>
        <CardTitle>已配置的 API Key（来自 config.yaml）</CardTitle>
        {keysQ.isLoading && <Spinner />}
        {keys.length === 0 && !keysQ.isLoading && (
          <p className="text-[#64748b] text-sm py-3">未配置 API Key — 客户端将无法通过认证</p>
        )}
        {keys.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.82rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">序号</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">Key（已脱敏）</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">长度</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k, i) => (
                  <tr key={i} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
                    <td className="px-2 py-1.5 text-[#64748b]">{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono text-[#e2e8f0]" title={k}>
                      {maskKey(k)}
                    </td>
                    <td className="px-2 py-1.5 text-[#94a3b8]">{k.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Per-provider usage */}
      <Card>
        <CardTitle>
          按 Provider 使用量
          {usageQ.isFetching && <Spinner size={12} />}
        </CardTitle>
        {usageQ.isLoading && <Spinner />}
        {providerRows.length === 0 && !usageQ.isLoading && (
          <p className="text-[#64748b] text-sm py-3">暂无使用记录（等待首次代理请求）</p>
        )}
        {providerRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.82rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">Provider</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">Key 数量</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">成功请求</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">失败请求</th>
                  <th className="text-left px-2 py-2 text-[#64748b] font-medium">成功率</th>
                </tr>
              </thead>
              <tbody>
                {providerRows.map(r => {
                  const total = r.success + r.failed
                  const rate = total > 0 ? Math.round(r.success / total * 100) : 0
                  const rateColor = rate >= 90 ? "text-green-400" : rate >= 70 ? "text-yellow-400" : "text-red-400"
                  return (
                    <tr key={r.provider} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
                      <td className="px-2 py-1.5">
                        <Badge variant="default">{r.provider}</Badge>
                      </td>
                      <td className="px-2 py-1.5 text-[#94a3b8]">{r.keyCount}</td>
                      <td className="px-2 py-1.5 text-green-400">{r.success}</td>
                      <td className="px-2 py-1.5 text-red-400">{r.failed}</td>
                      <td className={`px-2 py-1.5 font-semibold ${rateColor}`}>{total > 0 ? `${rate}%` : "-"}</td>
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
