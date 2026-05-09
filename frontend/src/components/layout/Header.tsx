import { useState, useRef, useEffect } from "react"
import { useConnection } from "@/stores/connection"
import { serverVersion } from "@/api/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/Button"
import { LogOut, ChevronDown, Plus, Trash2, Check } from "lucide-react"
import { useManagementEvents } from "@/hooks/useManagementEvents"
import { ActiveJobsBadge } from "./ActiveJobsBadge"

const sseLabels: Record<string, { label: string; color: string; pulse?: boolean }> = {
  open:       { label: "实时", color: "bg-green-500/15 text-green-400", pulse: true },
  connecting: { label: "连接中…", color: "bg-blue-500/15 text-blue-400" },
  error:      { label: "重连中", color: "bg-yellow-500/15 text-yellow-400" },
  closed:     { label: "轮询", color: "bg-slate-500/20 text-slate-400" },
}

export function Header() {
  const { connected, disconnect, config, savedInstances, saveInstance, switchInstance, removeInstance } = useConnection()
  const sseState = useManagementEvents()
  const sseInfo = sseLabels[sseState] ?? sseLabels.closed
  const [showInstances, setShowInstances] = useState(false)
  const [saveLabel, setSaveLabel] = useState("")
  const [showSaveInput, setShowSaveInput] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowInstances(false)
        setShowSaveInput(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const urlLabel = config.url.replace(/^https?:\/\//, "").replace(/\/$/, "")

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

        {/* Instance switcher */}
        {connected && (
          <div className="relative" ref={dropRef}>
            <button
              type="button"
              onClick={() => setShowInstances(v => !v)}
              className="flex items-center gap-1 text-[0.7rem] text-[#64748b] hover:text-[#94a3b8] transition-colors"
            >
              <span className="hidden sm:inline">{urlLabel}</span>
              <ChevronDown size={11} className={cn("transition-transform", showInstances && "rotate-180")} />
            </button>

            {showInstances && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-[#1a1d27] border border-[#2d3148] rounded-lg shadow-xl z-50 p-2">
                <div className="text-[0.68rem] text-[#64748b] px-2 py-1 mb-1">已保存的 CPA 实例</div>

                {savedInstances.length === 0 && (
                  <div className="text-[0.72rem] text-[#4a5568] px-2 py-2">暂无保存的实例</div>
                )}

                {savedInstances
                  .sort((a, b) => b.lastUsed - a.lastUsed)
                  .map(inst => (
                    <div
                      key={inst.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#22263a] group"
                    >
                      <button
                        type="button"
                        className="flex-1 text-left text-[0.78rem]"
                        onClick={() => { switchInstance(inst.id); setShowInstances(false) }}
                      >
                        <div className="flex items-center gap-1.5">
                          {inst.config.url === config.url && <Check size={10} className="text-[#6c63ff]" />}
                          <span className={inst.config.url === config.url ? "text-[#6c63ff] font-semibold" : "text-[#94a3b8]"}>
                            {inst.label}
                          </span>
                        </div>
                        <div className="text-[0.68rem] text-[#4a5568] truncate">
                          {inst.config.url.replace(/^https?:\/\//, "")}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 text-[#4a5568] hover:text-red-400 transition-all"
                        onClick={() => removeInstance(inst.id)}
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}

                <div className="border-t border-[#2d3148] mt-1 pt-1">
                  {showSaveInput ? (
                    <div className="px-2 py-1 flex gap-1.5">
                      <input
                        autoFocus
                        value={saveLabel}
                        onChange={e => setSaveLabel(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && saveLabel.trim()) {
                            saveInstance(saveLabel.trim())
                            setSaveLabel("")
                            setShowSaveInput(false)
                          }
                          if (e.key === "Escape") setShowSaveInput(false)
                        }}
                        placeholder="实例名称（回车保存）"
                        className="flex-1 bg-[#0f1117] border border-[#2d3148] rounded px-2 py-1 text-[0.75rem] text-[#e2e8f0] placeholder:text-[#4a5568] outline-none focus:border-[#6c63ff]"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowSaveInput(true)}
                      className="flex items-center gap-1.5 px-2 py-1.5 w-full text-left text-[0.75rem] text-[#64748b] hover:text-[#94a3b8] transition-colors"
                    >
                      <Plus size={12} /> 保存当前连接
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
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
