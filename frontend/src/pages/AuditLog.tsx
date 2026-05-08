import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchAuditLog, qkeys } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { Button } from "@/components/ui/Button"
import { fmtDate } from "@/lib/utils"
import { Download, Search } from "lucide-react"

export function AuditLog() {
  const { config, connected } = useConnection()
  const [actionFilter, setActionFilter] = useState("")
  const [q, setQ] = useState("")
  const [limit] = useState(200)

  const log = useQuery({
    queryKey: [...qkeys.auditLog(config), actionFilter, q, limit],
    queryFn: () => fetchAuditLog(config, { action: actionFilter || undefined, q: q || undefined, limit }),
    enabled: connected,
    refetchInterval: 30_000,
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          <span>审计日志</span>
          <a href={`${config.url.replace(/\/$/, "")}/v0/management/audit-log/export.csv`}
             target="_blank" rel="noreferrer"
             className="text-xs text-[#6c63ff] hover:underline flex items-center gap-1">
            <Download size={12} /> 导出 CSV
          </a>
        </CardTitle>
        <Alert type="info">
          所有破坏性管理操作均落入 <code>data/audit_log.jsonl</code>。原始 bearer token 不入库，仅记录 SHA-256 前 16 字符指纹。
        </Alert>

        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <input className="bg-[#22263a] border border-[#2d3148] rounded px-2 py-1 text-xs flex-1 min-w-[180px]"
                 placeholder="action（精确，例：auth.delete_batch）"
                 value={actionFilter} onChange={e => setActionFilter(e.target.value)} />
          <div className="flex items-center gap-1 bg-[#22263a] border border-[#2d3148] rounded px-2 py-1">
            <Search size={12} className="text-[#64748b]" />
            <input className="bg-transparent text-xs outline-none"
                   placeholder="模糊搜索 path / target ids"
                   value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Button size="sm" variant="ghost" onClick={() => log.refetch()}>刷新</Button>
        </div>

        <div className="text-xs text-[#94a3b8] mb-2">
          显示 {log.data?.count ?? 0} / {log.data?.total ?? 0}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[#94a3b8] border-b border-[#2d3148]">
              <tr>
                <th className="py-2 pr-2">时间</th>
                <th className="py-2 pr-2">action</th>
                <th className="py-2 pr-2">target</th>
                <th className="py-2 pr-2">actor</th>
                <th className="py-2 pr-2">result</th>
                <th className="py-2 pr-2">path</th>
              </tr>
            </thead>
            <tbody>
              {log.data?.items.map(ev => (
                <tr key={ev.id} className="border-b border-[#1f2230] hover:bg-[#22263a]/50">
                  <td className="py-2 pr-2 whitespace-nowrap">{fmtDate(ev.ts)}</td>
                  <td className="py-2 pr-2 font-mono text-[#e2e8f0]">{ev.action}</td>
                  <td className="py-2 pr-2 font-mono text-[#94a3b8]">
                    {ev.target.type ?? "—"}
                    {ev.target.ids && ev.target.ids.length > 0 && (
                      <span className="text-[#64748b]">: {ev.target.ids.slice(0, 3).join(", ")}{ev.target.ids.length > 3 ? "…" : ""}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-[#94a3b8] whitespace-nowrap">
                    {ev.actor.ip ?? "—"}
                    <div className="text-[0.65rem] text-[#64748b]">{ev.actor.management_key_hash}</div>
                  </td>
                  <td className="py-2 pr-2">
                    <Badge variant={ev.result.ok ? "green" : "red"}>{ev.result.ok ? "ok" : "fail"}</Badge>
                  </td>
                  <td className="py-2 pr-2 text-[#64748b] font-mono">{ev.request.method} {ev.request.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {log.data?.total === 0 && (
            <Alert type="success">暂无审计记录。</Alert>
          )}
        </div>
      </Card>
    </div>
  )
}
