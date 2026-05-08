import { useConnection } from "@/stores/connection"
import { serverVersion } from "@/api/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/Button"
import { LogOut } from "lucide-react"
import { useManagementEvents } from "@/hooks/useManagementEvents"
import { ActiveJobsBadge } from "./ActiveJobsBadge"

const sseLabels: Record<string, { label: string; color: string; pulse?: boolean }> = {
  open:       { label: "实时", color: "bg-green-500/15 text-green-400", pulse: true },
  connecting: { label: "连接中…", color: "bg-blue-500/15 text-blue-400" },
  error:      { label: "重连中", color: "bg-yellow-500/15 text-yellow-400" },
  closed:     { label: "轮询", color: "bg-slate-500/20 text-slate-400" },
}

export function Header() {
  const { connected, disconnect, config } = useConnection()
  const sseState = useManagementEvents()
  const sseInfo = sseLabels[sseState] ?? sseLabels.closed

  return (
    <header className="bg-[#1a1d27] border-b border-[#2d3148] px-5 py-3 flex items-center justify-between sticky top-0 z-50">
      <span className="text-sm font-semibold text-[#94a3b8]">
        CLI<span className="text-[#6c63ff]">Proxy</span>API 管理面板
      </span>
      <div className="flex items-center gap-3">
        {serverVersion.version && (
          <span className="text-[0.7rem] text-[#64748b]">
            v{serverVersion.version}
            {serverVersion.commit && serverVersion.commit !== "none"
              ? ` (${serverVersion.commit.slice(0,7)})`
              : ""}
          </span>
        )}
        {connected && (
          <span className="text-[0.7rem] text-[#64748b] hidden sm:inline">
            {config.url}
          </span>
        )}
        {connected && <ActiveJobsBadge />}
        {connected && (
          <span
            title={`实时事件流：${sseInfo.label}`}
            className={cn(
              "inline-flex items-center gap-1 text-[0.7rem] px-2 py-0.5 rounded-full font-semibold",
              sseInfo.color
            )}
          >
            <span className={cn(
              "inline-block w-1.5 h-1.5 rounded-full",
              sseState === "open" ? "bg-green-400" :
              sseState === "connecting" ? "bg-blue-400" :
              sseState === "error" ? "bg-yellow-400" :
              "bg-slate-500",
              sseInfo.pulse && "animate-pulse"
            )} />
            {sseInfo.label}
          </span>
        )}
        <span className={cn(
          "text-xs px-2 py-0.5 rounded-full font-semibold",
          connected
            ? "bg-green-500/15 text-green-400"
            : "bg-slate-500/20 text-slate-400"
        )}>
          {connected ? "已连接" : "未连接"}
        </span>
        {connected && (
          <Button variant="ghost" size="sm" onClick={disconnect} title="断开连接">
            <LogOut size={13} />
          </Button>
        )}
      </div>
    </header>
  )
}
