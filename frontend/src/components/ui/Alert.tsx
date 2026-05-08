import { cn } from "@/lib/utils"
import { type ReactNode } from "react"

const styles = {
  info:    "bg-blue-500/10  border-blue-500/30  text-blue-300",
  success: "bg-green-500/10 border-green-500/30 text-green-400",
  warn:    "bg-yellow-500/10 border-yellow-500/30 text-yellow-300",
  error:   "bg-red-500/10   border-red-500/30   text-red-300",
} as const

export function Alert({ type = "info", children, className }: {
  type?: keyof typeof styles; children: ReactNode; className?: string
}) {
  return (
    <div className={cn("px-3 py-2 rounded-[7px] border text-[0.84rem] mb-2.5", styles[type], className)}>
      {children}
    </div>
  )
}
