import { useQuery } from "@tanstack/react-query"
import { fetchIssues, qkeys } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"

const severityVariant = {
  critical: "red",
  warning: "yellow",
  info: "blue",
} as const

export function Issues() {
  const { config, connected } = useConnection()
  const issues = useQuery({ queryKey: qkeys.issues(config), queryFn: () => fetchIssues(config), enabled: connected })
  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>
  return (
    <div>
      <Card>
        <CardTitle>问题中心</CardTitle>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="bg-[#22263a] rounded p-3"><div className="text-red-400 font-bold text-lg">{issues.data?.summary.critical ?? 0}</div><div className="text-[#94a3b8]">Critical</div></div>
          <div className="bg-[#22263a] rounded p-3"><div className="text-yellow-400 font-bold text-lg">{issues.data?.summary.warning ?? 0}</div><div className="text-[#94a3b8]">Warning</div></div>
          <div className="bg-[#22263a] rounded p-3"><div className="text-blue-400 font-bold text-lg">{issues.data?.summary.info ?? 0}</div><div className="text-[#94a3b8]">Info</div></div>
        </div>
      </Card>
      <Card>
        <CardTitle>待处理事项</CardTitle>
        {issues.isLoading && <div className="text-sm text-[#94a3b8]">加载中…</div>}
        {issues.data?.items.length === 0 && <Alert type="success">当前没有需要处理的问题。</Alert>}
        <div className="space-y-2">
          {issues.data?.items.map(item => (
            <div key={item.id} className="border border-[#2d3148] rounded-lg p-3 bg-[#11131a]">
              <div className="flex items-center gap-2">
                <Badge variant={severityVariant[item.severity]}>{item.severity}</Badge>
                <span className="font-semibold text-sm">{item.title}</span>
                {item.auth_name && <span className="text-xs text-[#64748b]">{item.auth_name}</span>}
              </div>
              {item.detail && <p className="text-xs text-[#94a3b8] mt-2">{item.detail}</p>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

