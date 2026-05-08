import { cn } from "@/lib/utils"
import { type ReactNode } from "react"

const variants = {
  primary: "bg-[#6c63ff] text-white hover:bg-[#5b52e6]",
  success: "bg-green-700   text-white hover:bg-green-800",
  danger:  "bg-red-700     text-white hover:bg-red-800",
  warn:    "bg-amber-700   text-white hover:bg-amber-800",
  ghost:   "bg-[#22263a]   text-[#e2e8f0] border border-[#2d3148] hover:bg-[#2d3148]",
} as const

interface ButtonProps {
  variant?: keyof typeof variants
  size?: "sm" | "md"
  disabled?: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
  type?: "button" | "submit"
  title?: string
}

export function Button({ variant = "ghost", size = "md", disabled, onClick, className, children, type = "button", title }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[7px] font-semibold whitespace-nowrap transition-all cursor-pointer",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        size === "sm" ? "px-2 py-1 text-[0.76rem]" : "px-3 py-1.5 text-[0.83rem]",
        variants[variant], className
      )}
    >
      {children}
    </button>
  )
}
