import { useQuery } from "@tanstack/react-query"
import { fetchSystemDiagnostics } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { Button } from "@/components/ui/Button"
import { fmtDate } from "@/lib/utils"
import { Download, RefreshCw } from "lucide-react"

export function SystemDiagnostics() {
  const { config, connected } = useConnection()
  const data = useQuery({
    queryKey: ["system-diagnostics", config.url, config.key],
    queryFn: () => fetchSystemDiagnostics(config),
    enabled: connected,
    refetchInterval: 30_000,
  })
  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>
  const r = data.data
  const uptimeH = r ? (r.uptime_seconds / 3600).toFixed(1) : "—"

  return (
    <div>
      <Card>
        <CardTitle>
          <span>系统诊断</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => data.refetch()}>
              <RefreshCw size={12} /> 刷新
            </Button>
            <a href={`${config.url.replace(/\/$/, "")}/v0/management/system/diagnostics/export.zip`}
               target="_blank" rel="noreferrer"
               className="text-xs text-[#6c63ff] hover:underline flex items-center gap-1">
              <Download size={12} /> 导出诊断包 (.zip)
            </a>
          </div>
        </CardTitle>
        <Alert type="info">
          .zip 包内含 config.yaml（已 mask 所有 key/token/password/secret 字段）+ system_status + audit_log + overlay 特性清单 + self-check。Bearer / sk- 等 token 写入前已脱敏。
        </Alert>
        {r && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-3">
              <Field label="binary_hash" value={r.binary_hash ?? "—"} />
              <Field label="OS / Arch" value={`${r.os} / ${r.arch}`} />
              <Field label="Go" value={r.go_version} />
              <Field label="Uptime" value={`${uptimeH}h`} />
              <Field label="config" value={r.config_path ?? "—"} />
              <Field label="auth_dir" value={r.auth_dir ?? "—"} />
              <Field label="data_dir" value={r.data_dir ?? "—"} />
              <Field label="生成时间" value={fmtDate(r.generated_at)} />
            </div>

            <div className="mb-3">
              <h4 className="text-xs text-[#94a3b8] mb-1">健康检查</h4>
              <div className="space-y-1">
                {r.checks.map(c => (
                  <div key={c.name} className="flex items-center gap-2 text-xs">
                    <Badge variant={c.ok ? "green" : "red"}>{c.ok ? "ok" : "fail"}</Badge>
                    <span className="font-mono">{c.name}</span>
                    {c.note && <span className="text-[#94a3b8]">— {c.note}</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <h4 className="text-xs text-[#94a3b8] mb-1">环境变量（白名单）</h4>
              <div className="bg-[#11131a] rounded p-2 text-[0.7rem] font-mono">
                {Object.entries(r.env_summary).length === 0 && <span className="text-[#64748b]">无</span>}
                {Object.entries(r.env_summary).map(([k, v]) => (
                  <div key={k}>{k}={v}</div>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <h4 className="text-xs text-[#94a3b8] mb-1">Overlay 特性</h4>
              <div className="flex flex-wrap gap-1">
                {r.overlay_features.map(f => <Badge key={f} variant="default">{f}</Badge>)}
              </div>
            </div>

            {r.update_log_tail && (
              <div>
                <h4 className="text-xs text-[#94a3b8] mb-1">最近 update.log（尾部）</h4>
                <pre className="bg-[#11131a] rounded p-2 text-[0.65rem] text-[#94a3b8] overflow-auto max-h-48 whitespace-pre-wrap">
                  {r.update_log_tail}
                </pre>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#22263a] rounded p-2">
      <div className="text-[0.7rem] text-[#94a3b8]">{label}</div>
      <div className="text-xs font-mono text-[#e2e8f0] break-all">{value}</div>
    </div>
  )
}
