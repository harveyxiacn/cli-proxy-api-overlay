import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchManagementJobs } from "@/api/queries"
import { BriefcaseBusiness } from "lucide-react"

/**
 * Header badge that surfaces currently running jobs. Updates every 5s and
 * also reacts to job.created/updated SSE events (via useManagementEvents
 * which invalidates the same query key).
 */
export function ActiveJobsBadge() {
  const { config, connected } = useConnection()
  const navigate = useNavigate()

  const jobsQ = useQuery({
    queryKey: ["jobs-list", config.url, config.key],
    queryFn: () => fetchManagementJobs(config),
    enabled: connected,
    refetchInterval: 5_000,
  })

  if (!connected) return null

  const jobs = jobsQ.data?.jobs ?? []
  const running = jobs.filter(j => j.status === "running")
  if (running.length === 0) return null

  // Compute aggregate progress
  const totalDone = running.reduce((n, j) => n + j.done, 0)
  const totalCount = running.reduce((n, j) => n + j.total, 0)
  const pct = totalCount > 0 ? Math.round((totalDone / totalCount) * 100) : 0

  return (
    <button
      onClick={() => navigate("/jobs")}
      title={`${running.length} 个任务运行中 — 整体进度 ${pct}%（点击查看详情）`}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 text-[0.7rem] font-semibold hover:bg-blue-500/25 transition-colors cursor-pointer"
    >
      <BriefcaseBusiness size={12} />
      <span>{running.length} 任务</span>
      {totalCount > 0 && (
        <span className="text-[0.65rem] opacity-80">
          {totalDone}/{totalCount}
        </span>
      )}
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"
        aria-hidden
      />
    </button>
  )
}
