import { cn } from "@/lib/utils"
import { needsRelogin } from "@/lib/utils"
import { type ReactNode } from "react"

const variants = {
  default:  "bg-white/10    text-[#94a3b8]",
  green:    "bg-green-500/15  text-green-400",
  red:      "bg-red-500/15    text-red-400",
  yellow:   "bg-yellow-500/15 text-yellow-400",
  blue:     "bg-blue-500/15   text-blue-400",
  purple:   "bg-purple-500/15 text-purple-400",
  orange:   "bg-orange-500/15 text-orange-400",
  disabled: "bg-slate-500/20  text-slate-400",
} as const

type BadgeVariant = keyof typeof variants

export function Badge({ variant = "default", className, children, title }: {
  variant?: BadgeVariant; className?: string; children: ReactNode; title?: string
}) {
  return (
    <span title={title} className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.74rem] font-semibold whitespace-nowrap",
      variants[variant], className
    )}>
      {children}
    </span>
  )
}

export function AuthStatusBadge({ status, disabled, statusMessage, lastRefresh, failed, lastError }: {
  status?: string; disabled?: boolean; statusMessage?: string
  lastRefresh?: string; failed?: number
  lastError?: { code?: string; message?: string }
}) {
  if (disabled) return <Badge variant="disabled">禁用</Badge>

  // Status authoritative: when conductor flips status back to "active"/"ready" it
  // clears LastError + StatusMessage too, so a stale 401 string left over from a
  // past failure should NOT mask a healthy account. We only look at
  // needsRelogin() text when status itself signals trouble (error / unavailable
  // / unknown) — that matches the upstream UI's behavior.
  if (status === "active") {
    if (!lastRefresh) {
      const baseTip = (failed ?? 0) > 0
        ? "状态为 active 但从未成功刷新过 token；最近的刷新尝试有失败记录，账号可能已失效"
        : "状态为 active 但尚未成功刷新过 token；建议手动 warmup 验证"
      const tip = lastError?.message
        ? `${baseTip}\n错误：${lastError.message}`
        : baseTip
      return <Badge variant="yellow" title={tip}>未刷新</Badge>
    }
    return <Badge variant="green">active</Badge>
  }
  if (status === "ready") return <Badge variant="blue">ready</Badge>

  // From here status ∈ {error, unavailable, "", unknown}. Only now does a
  // relogin-flavored message earn the orange "需重登录" badge.
  if (needsRelogin(statusMessage)) {
    const tip = lastError?.message
      ? `需要重新 OAuth 登录\n错误：${lastError.message}`
      : "需要重新 OAuth 登录"
    return <Badge variant="orange" title={tip}>需重登录</Badge>
  }
  if (status === "error") {
    const tip = lastError?.message ? `error\n错误：${lastError.message}` : "error"
    return <Badge variant="red" title={tip}>error</Badge>
  }
  if (status === "unavailable") return <Badge variant="yellow">不可用</Badge>
  return <Badge variant="yellow">{status ?? "?"}</Badge>
}
