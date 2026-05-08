import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import {
  createOAuthRepairBatch,
  fetchAuthMaintenanceSummary,
  warmupOAuthRepairSession,
  qkeys,
} from "@/api/queries"
import { apiFetch } from "@/api/client"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { Spinner } from "@/components/ui/Spinner"
import type { OAuthRepairSession } from "@/api/types"
import { X } from "lucide-react"

type SlotStatus = "pending" | "in_progress" | "success" | "skipped" | "error"

interface Slot {
  target: string
  provider: string
  sessionId?: string
  authPath?: string  // /v0/management/codex-auth-url?...&repair_session=<id>
  oauthUrl?: string  // resolved real OAuth URL
  status: SlotStatus
  error?: string
}

const POLL_INTERVAL_MS = 4000
const OAUTH_TAB_NAME = "cpa-oauth"

interface Props {
  open: boolean
  initialTargets: { name: string; provider: string }[]
  onClose: () => void
  onComplete?: (stats: { total: number; success: number; skipped: number; error: number }) => void
}

export function BatchReloginDialog({ open, initialTargets, onClose, onComplete }: Props) {
  const { config } = useConnection()
  const qc = useQueryClient()

  const [phase, setPhase] = useState<"review" | "running" | "summary">("review")
  const [selected, setSelected] = useState<Set<string>>(new Set(initialTargets.map(t => t.name)))
  const [slots, setSlots] = useState<Slot[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [error, setError] = useState<string>("")
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset state every time the dialog opens with fresh targets
  useEffect(() => {
    if (open) {
      setPhase("review")
      setSelected(new Set(initialTargets.map(t => t.name)))
      setSlots([])
      setCurrentIdx(0)
      setError("")
    }
  }, [open, initialTargets])

  // Cleanup polling on close / unmount
  useEffect(() => {
    return () => stopPoll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopPoll = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  const totalSelected = selected.size
  const selectedList = useMemo(
    () => initialTargets.filter(t => selected.has(t.name)),
    [initialTargets, selected],
  )

  const begin = async () => {
    if (selectedList.length === 0) return
    setError("")
    try {
      // Default provider — codex is the most common needs_relogin source. Per-target
      // provider is included in the request so backend uses each target's own.
      const resp = await createOAuthRepairBatch(config, {
        provider: selectedList[0]?.provider || "codex",
        mode: "replace",
        targets: selectedList.map(t => ({ provider: t.provider, target_name: t.name })),
      })
      const newSlots: Slot[] = resp.sessions.map(s => ({
        target: s.target_name,
        provider: s.provider,
        sessionId: s.session?.session_id,
        authPath: s.session?.auth_url,
        status: s.error ? "error" : "pending",
        error: s.error,
      }))
      setSlots(newSlots)
      const firstReady = newSlots.findIndex(s => s.status === "pending")
      setCurrentIdx(firstReady === -1 ? newSlots.length : firstReady)
      setPhase("running")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const currentSlot = slots[currentIdx]

  // When entering a new pending slot, auto-mint OAuth URL + open tab + start polling
  useEffect(() => {
    if (phase !== "running" || !currentSlot || currentSlot.status !== "pending") return
    let cancelled = false

    const arm = async () => {
      const slot = currentSlot
      try {
        if (!slot.authPath) throw new Error("缺少 auth_url")
        const path = slot.authPath.replace(/^\/v0\/management/, "")
        const oauth = await apiFetch<{ url: string; state: string }>("GET", path, config)
        if (cancelled) return
        // Mark in_progress, save resolved URL, open tab (reuse same window name)
        setSlots(prev => prev.map((s, i) => i === currentIdx ? { ...s, oauthUrl: oauth.url, status: "in_progress" } : s))
        window.open(oauth.url, OAUTH_TAB_NAME)
        startPolling(slot.target)
      } catch (e) {
        if (cancelled) return
        setSlots(prev => prev.map((s, i) => i === currentIdx ? { ...s, status: "error", error: e instanceof Error ? e.message : String(e) } : s))
      }
    }
    arm()
    return () => { cancelled = true; stopPoll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIdx])

  const startPolling = (target: string) => {
    stopPoll()
    pollTimerRef.current = setInterval(async () => {
      try {
        const summary = await fetchAuthMaintenanceSummary(config)
        const stillNeeds = summary.candidates.needs_relogin.includes(target)
        if (!stillNeeds) {
          markCurrent("success", "auto-detected")
        }
      } catch {
        // silent — keep polling
      }
    }, POLL_INTERVAL_MS)
  }

  const markCurrent = (status: SlotStatus, _hint?: string) => {
    void _hint
    stopPoll()
    setSlots(prev => prev.map((s, i) => i === currentIdx ? { ...s, status } : s))
    // Optionally tell backend the session is done so it can be cleaned up
    if (status === "success" && currentSlot?.sessionId) {
      warmupOAuthRepairSession(config, currentSlot.sessionId).catch(() => {})
    }
    setTimeout(() => advance(), 200)
  }

  const advance = () => {
    setSlots(prev => {
      const nextIdx = prev.findIndex((s, i) => i > currentIdx && s.status === "pending")
      if (nextIdx === -1) {
        // done
        const stats = computeStats(prev)
        setPhase("summary")
        qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
        qc.invalidateQueries({ queryKey: qkeys.maintenance(config) })
        if (onComplete) onComplete(stats)
        return prev
      }
      setCurrentIdx(nextIdx)
      return prev
    })
  }

  const computeStats = (list: Slot[]) => {
    const stats = { total: list.length, success: 0, skipped: 0, error: 0 }
    for (const s of list) {
      if (s.status === "success") stats.success++
      else if (s.status === "skipped") stats.skipped++
      else if (s.status === "error") stats.error++
    }
    return stats
  }

  const handleClose = () => {
    stopPoll()
    if (phase === "running") {
      if (!confirm("批量重登正在进行中，确认中止？已完成的账号不会回滚。")) return
    }
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/55 z-[1000] flex items-center justify-center" style={{ backdropFilter: "blur(2px)" }}>
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-6 min-w-[480px] max-w-[720px] w-[92vw] max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-base">
            🔁 批量重登 OAuth
            {phase === "running" && (
              <span className="ml-2 text-xs font-normal text-[#94a3b8]">
                {currentIdx + 1} / {slots.length}
              </span>
            )}
          </h3>
          <button onClick={handleClose} className="text-[#64748b] hover:text-[#e2e8f0] ml-4 transition-colors" title="关闭">
            <X size={16} />
          </button>
        </div>

        {phase === "review" && (
          <ReviewPhase
            initialTargets={initialTargets}
            selected={selected}
            setSelected={setSelected}
            error={error}
            totalSelected={totalSelected}
            onCancel={handleClose}
            onStart={begin}
          />
        )}

        {phase === "running" && (
          <RunningPhase
            slots={slots}
            currentIdx={currentIdx}
            currentSlot={currentSlot}
            onMarkDone={() => markCurrent("success")}
            onSkip={() => markCurrent("skipped")}
            onReopenTab={() => { if (currentSlot?.oauthUrl) window.open(currentSlot.oauthUrl, OAUTH_TAB_NAME) }}
          />
        )}

        {phase === "summary" && (
          <SummaryPhase
            slots={slots}
            onClose={handleClose}
          />
        )}
      </div>
    </div>
  )
}

function ReviewPhase({
  initialTargets, selected, setSelected, error, totalSelected, onCancel, onStart,
}: {
  initialTargets: { name: string; provider: string }[]
  selected: Set<string>
  setSelected: (s: Set<string>) => void
  error: string
  totalSelected: number
  onCancel: () => void
  onStart: () => void
}) {
  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name); else next.add(name)
    setSelected(next)
  }
  const all = () => setSelected(new Set(initialTargets.map(t => t.name)))
  const none = () => setSelected(new Set())

  return (
    <>
      <p className="text-sm text-[#94a3b8] mb-2">
        选中以下账号将依次进入 OAuth 重登流程，每完成一个自动跳到下一个。OAuth 标签会复用同一个浏览器 tab，不会爆开 N 个窗口。
      </p>
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-2 text-[0.82rem] mb-2">
          {error}
        </div>
      )}
      <div className="flex gap-2 mb-2 text-[0.78rem]">
        <Button variant="ghost" size="sm" onClick={all}>全选</Button>
        <Button variant="ghost" size="sm" onClick={none}>清空</Button>
        <span className="ml-auto text-[#94a3b8] self-center">{totalSelected} / {initialTargets.length} 已选</span>
      </div>
      <div className="border border-[#2d3148] rounded-lg max-h-[40vh] overflow-y-auto bg-[#0f1117] mb-3">
        {initialTargets.length === 0 && (
          <p className="text-center text-[#64748b] py-6 text-sm">没有需要重登的账号</p>
        )}
        {initialTargets.map(t => (
          <label
            key={t.name}
            className="flex items-center gap-2 px-3 py-1.5 border-b border-[#2d3148] last:border-b-0 hover:bg-[#6c63ff]/5 cursor-pointer text-[0.82rem]"
          >
            <input
              type="checkbox"
              checked={selected.has(t.name)}
              onChange={() => toggle(t.name)}
              className="accent-[#6c63ff]"
            />
            <Badge variant="default" className="text-[0.7rem]">{t.provider}</Badge>
            <span className="font-mono text-[#e2e8f0] truncate">{t.name}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>取消</Button>
        <Button variant="primary" onClick={onStart} disabled={totalSelected === 0}>
          开始批量重登 ({totalSelected})
        </Button>
      </div>
    </>
  )
}

function RunningPhase({
  slots, currentIdx, currentSlot, onMarkDone, onSkip, onReopenTab,
}: {
  slots: Slot[]
  currentIdx: number
  currentSlot: Slot | undefined
  onMarkDone: () => void
  onSkip: () => void
  onReopenTab: () => void
}) {
  const completed = slots.filter(s => s.status === "success").length
  const skipped = slots.filter(s => s.status === "skipped").length
  const errored = slots.filter(s => s.status === "error").length
  const progressPct = Math.round(((completed + skipped + errored) / slots.length) * 100)

  return (
    <>
      <div className="h-2 rounded bg-[#0f1117] overflow-hidden mb-3">
        <div className="h-full rounded bg-[#6c63ff] transition-all duration-300" style={{ width: `${progressPct}%` }} />
      </div>

      {currentSlot ? (
        <div className="bg-[#0f1117] border border-[#6c63ff]/30 rounded-lg p-4 mb-3">
          <div className="flex items-center gap-2 mb-2 text-[0.78rem] text-[#94a3b8]">
            <Spinner size={12} />
            <span>当前账号 ({currentIdx + 1}/{slots.length})</span>
            <Badge variant="default" className="text-[0.7rem]">{currentSlot.provider}</Badge>
          </div>
          <p className="font-mono text-[#e2e8f0] text-sm break-all mb-3">{currentSlot.target}</p>
          {currentSlot.oauthUrl ? (
            <>
              <p className="text-[0.78rem] text-[#94a3b8] mb-2">
                ✅ OAuth 链接已在新标签打开。完成授权后系统会自动检测并跳到下一个；如果没自动跳，点「我已完成」。
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button variant="primary" size="sm" onClick={onReopenTab}>🔗 重新打开 OAuth 标签</Button>
                <Button variant="success" size="sm" onClick={onMarkDone}>✅ 我已完成</Button>
                <Button variant="ghost" size="sm" onClick={onSkip}>⏭ 跳过</Button>
              </div>
            </>
          ) : currentSlot.status === "error" ? (
            <>
              <p className="text-red-400 text-[0.82rem] mb-2">{currentSlot.error}</p>
              <Button variant="ghost" size="sm" onClick={onSkip}>⏭ 跳过</Button>
            </>
          ) : (
            <p className="text-[0.78rem] text-[#94a3b8]">⏳ 正在准备 OAuth 链接…</p>
          )}
        </div>
      ) : (
        <p className="text-center text-[#64748b] py-3">无当前账号</p>
      )}

      <div className="grid grid-cols-3 gap-2 text-center text-[0.78rem] mb-3">
        <Stat label="✅ 完成" value={completed} color="text-green-400" />
        <Stat label="⏭ 跳过" value={skipped} color="text-yellow-400" />
        <Stat label="❌ 失败" value={errored} color="text-red-400" />
      </div>

      <details className="text-[0.78rem]">
        <summary className="cursor-pointer text-[#94a3b8] mb-1">📋 全部任务列表 ({slots.length})</summary>
        <div className="border border-[#2d3148] rounded-lg max-h-[28vh] overflow-y-auto bg-[#0f1117]">
          {slots.map((s, i) => (
            <div
              key={s.target}
              className={`flex items-center gap-2 px-2 py-1 border-b border-[#2d3148] last:border-b-0 ${i === currentIdx ? "bg-[#6c63ff]/10" : ""}`}
            >
              <span className="w-5 text-[#64748b]">{i + 1}.</span>
              <span className="w-12">{slotIcon(s.status)}</span>
              <span className="font-mono text-[#94a3b8] truncate flex-1">{s.target}</span>
              {s.error && <span className="text-red-400 text-[0.7rem]">{s.error.slice(0, 30)}</span>}
            </div>
          ))}
        </div>
      </details>
    </>
  )
}

function SummaryPhase({ slots, onClose }: { slots: Slot[]; onClose: () => void }) {
  const success = slots.filter(s => s.status === "success").length
  const skipped = slots.filter(s => s.status === "skipped").length
  const errored = slots.filter(s => s.status === "error").length
  const failedSlots = slots.filter(s => s.status === "error" || s.status === "skipped")

  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <SummaryTile label="✅ 完成" value={success} color="text-green-400" />
        <SummaryTile label="⏭ 跳过" value={skipped} color="text-yellow-400" />
        <SummaryTile label="❌ 失败" value={errored} color="text-red-400" />
      </div>
      {failedSlots.length > 0 && (
        <details open className="text-[0.82rem] mb-3">
          <summary className="cursor-pointer text-[#94a3b8] mb-1">未完成的账号 ({failedSlots.length})</summary>
          <div className="border border-[#2d3148] rounded-lg max-h-[30vh] overflow-y-auto bg-[#0f1117] mt-1">
            {failedSlots.map(s => (
              <div key={s.target} className="flex items-center gap-2 px-2 py-1 border-b border-[#2d3148] last:border-b-0">
                <span className="w-12">{slotIcon(s.status)}</span>
                <span className="font-mono text-[#94a3b8] truncate flex-1">{s.target}</span>
                {s.error && <span className="text-red-400 text-[0.7rem]">{s.error.slice(0, 40)}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>关闭</Button>
      </div>
    </>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-[#2d3148] bg-[#11131a] p-2">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[0.7rem] text-[#64748b]">{label}</div>
    </div>
  )
}

function SummaryTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-[#2d3148] bg-[#11131a] p-3">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-[#64748b] mt-1">{label}</div>
    </div>
  )
}

function slotIcon(status: SlotStatus): string {
  switch (status) {
    case "pending": return "⏳"
    case "in_progress": return "🔄"
    case "success": return "✅"
    case "skipped": return "⏭"
    case "error": return "❌"
  }
}

// Re-export type for callers
export type { OAuthRepairSession }
