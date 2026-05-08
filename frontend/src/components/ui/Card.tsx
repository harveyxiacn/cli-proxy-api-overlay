import { cn } from "@/lib/utils"
import { type ReactNode } from "react"

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("bg-[#1a1d27] border border-[#2d3148] rounded-[10px] p-4 mb-3.5", className)}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between flex-wrap gap-2 mb-3 text-sm font-bold", className)}>
      {children}
    </div>
  )
}
