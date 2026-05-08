import { cn } from "@/lib/utils"

/** Animated shimmer placeholder for content that's still loading. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn(
        "rounded animate-pulse bg-gradient-to-r from-[#22263a] via-[#2d3148] to-[#22263a] bg-[length:200%_100%]",
        className
      )}
      style={{ animationDuration: "1.5s", ...style }}
    />
  )
}

/** Skeleton for a stat-card grid (used in Dashboard / TokenStats). */
export function StatCardSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid gap-2.5 mb-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-[#22263a] border border-[#2d3148] rounded-[10px] p-3 text-center">
          <Skeleton className="h-7 w-1/2 mx-auto mb-2" />
          <Skeleton className="h-3 w-3/4 mx-auto" />
        </div>
      ))}
    </div>
  )
}

/** Skeleton for table rows. */
export function TableRowSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-t border-[#2d3148]">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-2 py-2">
              <Skeleton className="h-4" style={{ width: `${50 + ((i * j) % 50)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
