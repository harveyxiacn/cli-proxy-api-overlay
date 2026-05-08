import { cn } from "@/lib/utils"
import type { RecentRequestBucket } from "@/api/types"

/**
 * Inline mini chart showing recent activity buckets.
 * Each bar = one bucket; height proportional to (success+failed); bar color
 * shows whether failures dominated the bucket.
 */
export function Sparkline({ buckets, max = 12, className }: {
  buckets?: RecentRequestBucket[]
  max?: number
  className?: string
}) {
  if (!buckets || buckets.length === 0) {
    return <span className="text-[0.7rem] text-[#64748b]">-</span>
  }
  // Reverse → newest on the right (most recent = right edge)
  const recent = [...buckets].reverse().slice(0, max)
  const peak = Math.max(1, ...recent.map(b => (b.success ?? 0) + (b.failed ?? 0)))
  return (
    <div className={cn("inline-flex items-end gap-px h-5", className)}>
      {recent.map((b, i) => {
        const total = (b.success ?? 0) + (b.failed ?? 0)
        const heightPct = (total / peak) * 100
        const failedRatio = total > 0 ? (b.failed ?? 0) / total : 0
        const color = total === 0
          ? "bg-[#2d3148]"
          : failedRatio > 0.5 ? "bg-red-400"
          : failedRatio > 0   ? "bg-yellow-400"
          : "bg-[#6c63ff]"
        return (
          <span
            key={i}
            className={cn("w-[4px] rounded-[1px]", color)}
            style={{ height: `${Math.max(8, heightPct)}%`, minHeight: total > 0 ? "2px" : "1px" }}
            title={`${b.time}: ✓${b.success ?? 0} ✗${b.failed ?? 0}`}
          />
        )
      })}
    </div>
  )
}
