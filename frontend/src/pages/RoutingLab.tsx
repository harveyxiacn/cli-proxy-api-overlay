import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { simulateRouting } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { Button } from "@/components/ui/Button"
import type { RoutingSimulateResponse } from "@/api/types"
import { Play } from "lucide-react"

export function RoutingLab() {
  const { config, connected } = useConnection()
  const [provider, setProvider] = useState("")
  const [model, setModel] = useState("")
  const [apiKeyHash, setApiKeyHash] = useState("")
  const [group, setGroup] = useState("")
  const [includeDisabled, setIncludeDisabled] = useState(false)
  const [quotaMode, setQuotaMode] = useState<"cached" | "fresh">("cached")
  const [result, setResult] = useState<RoutingSimulateResponse | null>(null)

  const sim = useMutation({
    mutationFn: () => simulateRouting(config, {
      provider: provider || undefined,
      model: model || undefined,
      api_key_hash: apiKeyHash || undefined,
      group: group || undefined,
      include_disabled: includeDisabled,
      quota_mode: quotaMode,
    }),
    onSuccess: r => setResult(r),
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  return (
    <div>
      <Card>
        <CardTitle>路由实验台</CardTitle>
        <Alert type="info">
          模拟"为这个请求会选中哪个账号"——只读，不会发送真实 provider 请求，不会改账号状态。
          quota_mode=cached 仅读取上次 /codex-quota 缓存；fresh 在需要时重新拉取（v1 暂同 cached）。
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <Field label="provider"      value={provider}    onChange={setProvider}    placeholder="codex / claude / gemini" />
          <Field label="model"          value={model}      onChange={setModel}        placeholder="gpt-5.4" />
          <Field label="api_key_hash"   value={apiKeyHash} onChange={setApiKeyHash}   placeholder="可选" />
          <Field label="group"          value={group}      onChange={setGroup}        placeholder="free-pool" />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeDisabled} onChange={e => setIncludeDisabled(e.target.checked)} />
            <span>包含 disabled 账号</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[#94a3b8]">quota_mode</span>
            <select className="bg-[#22263a] border border-[#2d3148] rounded px-2 py-1"
                    value={quotaMode} onChange={e => setQuotaMode(e.target.value as never)}>
              <option value="cached">cached</option>
              <option value="fresh">fresh</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <Button size="sm" variant="primary" onClick={() => sim.mutate()} disabled={sim.isPending}>
            <Play size={12} /> 运行 simulate
          </Button>
        </div>
      </Card>

      {result && (
        <Card>
          <CardTitle>
            <span>结果：选中 <code className="text-[#6c63ff]">{result.selected || "—"}</code></span>
            <span className="text-xs text-[#64748b]">strategy {result.strategy} · quota_mode {result.quota_mode}</span>
          </CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[#94a3b8] border-b border-[#2d3148]">
                <tr>
                  <th className="py-2 pr-2">name</th>
                  <th className="py-2 pr-2 text-center">score</th>
                  <th className="py-2 pr-2">selected</th>
                  <th className="py-2 pr-2">reasons</th>
                  <th className="py-2 pr-2">skip_reasons</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.map(c => (
                  <tr key={c.name} className="border-b border-[#1f2230]">
                    <td className="py-2 pr-2 font-mono">{c.name}</td>
                    <td className="py-2 pr-2 text-center font-mono">{c.score}</td>
                    <td className="py-2 pr-2">{c.selected ? <Badge variant="green">selected</Badge> : "—"}</td>
                    <td className="py-2 pr-2 text-[#94a3b8]">{(c.reasons ?? []).join(", ")}</td>
                    <td className="py-2 pr-2 text-red-300">{(c.skip_reasons ?? []).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-[#94a3b8] block mb-1">{label}</span>
      <input className="w-full bg-[#22263a] border border-[#2d3148] rounded px-2 py-1"
             value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}
