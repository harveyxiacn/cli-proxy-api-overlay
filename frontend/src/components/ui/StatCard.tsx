import { cn } from "@/lib/utils"
import { type ReactNode } from "react"

export function StatCard({ label, value, color, sub }: {
  label: string; value: ReactNode; color?: string; sub?: string
}) {
  return (
    <div className="bg-[#22263a] border border-[#2d3148] rounded-[10px] p-3 text-center">
      <div className={cn("text-[1.7rem] font-extrabold leading-none", color ?? "text-[#e2e8f0]")}>
        {value}
      </div>
      <div className="text-[0.75rem] text-[#94a3b8] mt-1 leading-tight">{label}</div>
      {sub && <div className="text-[0.7rem] text-[#64748b] mt-0.5">{sub}</div>}
    </div>
  )
}

export function StatsGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("grid gap-2.5 mb-4", className)}
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}
    >
      {children}
    </div>
  )
}
