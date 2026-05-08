import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ackAlert, fetchAlerts, qkeys, resolveAlert } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"

export function Alerts() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const alerts = useQuery({ queryKey: qkeys.alerts(config), queryFn: () => fetchAlerts(config), enabled: connected })
  const ack = useMutation({ mutationFn: (id: string) => ackAlert(config, id), onSuccess: () => qc.invalidateQueries({ queryKey: qkeys.alerts(config) }) })
  const resolve = useMutation({ mutationFn: (id: string) => resolveAlert(config, id), onSuccess: () => qc.invalidateQueries({ queryKey: qkeys.alerts(config) }) })
  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>
  return (
    <Card>
      <CardTitle>告警中心 <span className="text-xs text-[#64748b]">{alerts.data?.count ?? 0} 条</span></CardTitle>
      {alerts.data?.alerts.length === 0 && <Alert type="success">当前没有活动告警。</Alert>}
      <div className="space-y-2">
        {alerts.data?.alerts.map(a => (
          <div key={a.id} className="border border-[#2d3148] rounded-lg p-3 bg-[#11131a]">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={a.level === "critical" ? "red" : a.level === "warning" ? "yellow" : "blue"}>{a.level}</Badge>
              <Badge>{a.status}</Badge>
              <span className="font-semibold text-sm">{a.title}</span>
              {a.target && <span className="text-xs text-[#64748b]">{a.target}</span>}
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => ack.mutate(a.id)}>确认</Button>
                <Button size="sm" variant="success" onClick={() => resolve.mutate(a.id)}>解决</Button>
              </div>
            </div>
            {a.message && <p className="text-xs text-[#94a3b8] mt-2">{a.message}</p>}
          </div>
        ))}
      </div>
    </Card>
  )
}

