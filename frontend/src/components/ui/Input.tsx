import { cn } from "@/lib/utils"
import { forwardRef } from "react"

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "bg-[#0f1117] border border-[#2d3148] rounded-md text-[#e2e8f0]",
        "px-2.5 py-1.5 text-[0.85rem]",
        "focus:outline-none focus:border-[#6c63ff]",
        "placeholder:text-[#64748b]",
        className
      )}
      {...props}
    />
  )
)
Input.displayName = "Input"
