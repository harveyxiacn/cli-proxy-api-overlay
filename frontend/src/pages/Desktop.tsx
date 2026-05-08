import { useQuery } from "@tanstack/react-query"
import { fetchDesktopInfo, qkeys } from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Alert } from "@/components/ui/Alert"

export function Desktop() {
  const { config, connected } = useConnection()
  const info = useQuery({ queryKey: qkeys.desktop(config), queryFn: () => fetchDesktopInfo(config), enabled: connected })
  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>
  const entries = info.data?.entrypoints ?? {}
  return (
    <Card>
      <CardTitle>桌面化与回退入口</CardTitle>
      <div className="text-sm text-[#94a3b8] mb-3">当前模式：{info.data?.mode ?? "browser"} · 旧入口支持：{info.data?.legacy_supported ? "是" : "否"}</div>
      <div className="grid gap-2">
        {Object.entries(entries).map(([name, path]) => (
          <a key={name} href={path} className="block bg-[#11131a] border border-[#2d3148] rounded p-3 hover:border-[#6c63ff]">
            <span className="font-semibold">{name}</span>
            <span className="ml-3 text-[#64748b]">{path}</span>
          </a>
        ))}
      </div>
    </Card>
  )
}
