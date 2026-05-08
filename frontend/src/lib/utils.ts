import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind class names safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format large token counts: 1.2B / 34.5M / 678K / 999 */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/** Format USD value; values < $0.01 are shown in milli-dollars (m) */
export function fmtUSD(v: number): string {
  if (v === 0) return '$0.00'
  if (Math.abs(v) < 0.001) return (v * 1000).toFixed(2) + 'm'
  if (Math.abs(v) < 1) return '$' + v.toFixed(4)
  return '$' + v.toFixed(2)
}

/** Format a Unix timestamp (seconds) as a zh-CN locale date-time string */
export function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Return a relative time string for a Unix timestamp (seconds, may be fractional) */
export function fmtRelative(unix: number): string {
  const diff = Math.floor(Date.now() / 1000 - unix)
  if (diff < 0) return '刚刚'
  if (diff < 60) return diff + '秒前'
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前'
  return Math.floor(diff / 86400) + '天前'
}

/** Convert a window size in minutes to a human-readable label */
export function windowLabel(minutes: number | null | undefined): string {
  if (!minutes) return ''
  if (minutes >= 10080) return '7天'
  if (minutes >= 1440) return Math.round(minutes / 1440) + '天'
  if (minutes >= 60) return Math.round(minutes / 60) + 'h'
  return String(minutes) + 'min'
}

/** Check whether an error message indicates the user needs to re-login */
export function needsRelogin(msg: string | null | undefined): boolean {
  if (!msg) return false
  const lower = msg.toLowerCase()
  return (
    lower.includes('unauthorized') ||
    lower.includes('refresh_token_reused') ||
    lower.includes('invalid_grant') ||
    lower.includes('session expired') ||
    lower.includes('sign in again')
  )
}
