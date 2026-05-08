import { cn } from "@/lib/utils"
import { windowLabel } from "@/lib/utils"
import type { QuotaWindow } from "@/api/types"

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const color = value > 50 ? "bg-green-400" : value > 20 ? "bg-yellow-400" : "bg-red-400"
  return (
    <div className={cn("h-[7px] rounded bg-[#0f1117] overflow-hidden", className)}>
      <div className={cn("h-full rounded transition-all", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export function QuotaWindowCells({ w, hide }: { w?: QuotaWindow | null; hide?: boolean }) {
  if (hide) return null
  if (!w) return (
    <>
      <td className="px-2 py-2 text-[#64748b] text-xs">-</td>
      <td className="px-2 py-2 text-[#64748b] text-xs">-</td>
      <td className="px-2 py-2 text-[#64748b] text-xs">-</td>
    </>
  )
  const pct = w.remaining_percent
  const color = pct > 50 ? "text-green-400" : pct > 20 ? "text-yellow-400" : "text-red-400"
  const wl = windowLabel(w.window_minutes)
  const rst = w.reset_in ?? (w.reset_at ? new Date(w.reset_at * 1000).toLocaleString("zh-CN") : "-")
  return (
    <>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5 min-w-[110px]">
          <ProgressBar value={pct} className="flex-1 min-w-[60px]" />
          <span className="text-[0.71rem] text-[#64748b] whitespace-nowrap">
            {w.used_percent}%已用{wl ? ` · ${wl}` : ""}
          </span>
        </div>
      </td>
      <td className="px-2 py-2"><span className={cn("text-xs font-bold", color)}>{pct}%</span></td>
      <td className="px-2 py-2 text-[0.71rem] text-[#64748b] whitespace-nowrap">{rst}</td>
    </>
  )
}
