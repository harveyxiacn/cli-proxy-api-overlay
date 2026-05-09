import { useState, useEffect, useRef, useCallback } from "react"
import { useConnection } from "@/stores/connection"
import { connectManagementEvents } from "@/api/events"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"
import type { ManagementEventEnvelope } from "@/api/types"

interface EventEntry {
  id: number
  ts: number
  type: string
  source: string
  preview: string
  raw: ManagementEventEnvelope
}

const EVENT_COLORS: Record<string, string> = {
  "job.created":          "blue",
  "job.updated":          "blue",
  "request.recorded":     "green",
  "auth.status_changed":  "orange",
  "oauth.session_created":"purple",
  "oauth.warmup_completed":"green",
  "alert.api_key_quota_warn":    "yellow",
  "alert.api_key_quota_exceeded":"red",
  "webhook.test":         "default",
  "oauth.batch_created":  "purple",
}

function eventPreview(e: ManagementEventEnvelope): string {
  if (!e.payload || typeof e.payload !== "object") return ""
  const p = e.payload as Record<string, unknown>
  if (e.type.startsWith("job.")) {
    return `id=${String(p.id ?? "").slice(0,8)} status=${p.status} done=${p.done}/${p.total}`
  }
  if (e.type === "request.recorded") {
    return `model=${p.model ?? "?"} success=${p.success}`
  }
  if (e.type === "auth.status_changed") {
    return `${p.name ?? p.id ?? "?"} → ${p.status}`
  }
  return JSON.stringify(p).slice(0, 80)
}

export function RealtimeMonitor() {
  const { config, connected } = useConnection()
  const [events, setEvents] = useState<EventEntry[]>([])
  const [sseState, setSseState] = useState<"connecting" | "open" | "error" | "closed">("closed")
  const [paused, setPaused] = useState(false)
  const [maxEvents, setMaxEvents] = useState(200)
  const [counters, setCounters] = useState<Record<string, number>>({})
  const closeRef = useRef<(() => void) | null>(null)
  const pausedRef = useRef(false)
  const counterRef = useRef(0)
  const eventCountRef = useRef<Record<string, number>>({})

  pausedRef.current = paused

  const addEvent = useCallback((env: ManagementEventEnvelope) => {
    if (pausedRef.current) return
    const entry: EventEntry = {
      id: counterRef.current++,
      ts: Date.now(),
      type: env.type,
      source: env.source,
      preview: eventPreview(env),
      raw: env,
    }
    eventCountRef.current[env.type] = (eventCountRef.current[env.type] ?? 0) + 1
    setCounters({ ...eventCountRef.current })
    setEvents(prev => [entry, ...prev].slice(0, maxEvents))
  }, [maxEvents])

  useEffect(() => {
    if (!connected) {
      closeRef.current?.()
      setSseState("closed")
      return
    }

    let cancelled = false
    setSseState("connecting")

    const connect = async () => {
      if (cancelled) return
      try {
        const close = await connectManagementEvents(
          config,
          (env) => { if (!cancelled) addEvent(env) },
          (s) => { if (!cancelled) setSseState(s) }
        )
        if (cancelled) { close(); return }
        closeRef.current = close
      } catch {
        if (!cancelled) setSseState("error")
      }
    }

    connect()
    return () => {
      cancelled = true
      closeRef.current?.()
      closeRef.current = null
      setSseState("closed")
    }
  }, [config, connected, addEvent])

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  const stateColors = {
    open: "green", connecting: "blue", error: "yellow", closed: "default"
  } as const

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>
          <span>📡 实时事件监控</span>
          <div className="flex items-center gap-2">
            <Badge variant={stateColors[sseState] as "green" | "blue" | "yellow" | "default"}>
              {sseState === "open" ? "● 实时" : sseState === "connecting" ? "连接中…" : sseState === "error" ? "重连中" : "已断开"}
            </Badge>
            <Button
              variant={paused ? "primary" : "ghost"}
              size="sm"
              onClick={() => setPaused(v => !v)}
            >
              {paused ? "▶ 继续" : "⏸ 暂停"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEvents([]); eventCountRef.current = {}; setCounters({}) }}>
              🗑 清空
            </Button>
          </div>
        </CardTitle>

        {/* Event type counters */}
        {Object.keys(counters).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {Object.entries(counters).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <span key={type} className="text-[0.7rem] bg-[#1a1d27] border border-[#2d3148] rounded px-2 py-0.5 text-[#94a3b8]">
                <span className="text-[#64748b]">{type}:</span> <span className="font-semibold">{count}</span>
              </span>
            ))}
          </div>
        )}

        {events.length === 0 && (
          <div className="text-center py-12 text-[#64748b] text-sm">
            {sseState === "open"
              ? "等待事件… 执行操作（刷新 token、上传文件等）将在此处实时显示"
              : "正在建立 SSE 连接…"
            }
          </div>
        )}

        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {events.map(entry => {
            const color = EVENT_COLORS[entry.type] ?? "default"
            const time = new Date(entry.ts).toLocaleTimeString("zh-CN", { hour12: false })
            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 text-[0.78rem] py-1.5 px-2 rounded bg-[#0f1117] border border-[#1a1d27] hover:border-[#2d3148] transition-colors"
              >
                <span className="text-[#4a5568] font-mono shrink-0 mt-0.5">{time}</span>
                <Badge
                  variant={color as "blue" | "green" | "orange" | "purple" | "yellow" | "red" | "default"}
                  className="text-[0.68rem] shrink-0 mt-0.5"
                >
                  {entry.type}
                </Badge>
                <span className="text-[#64748b] shrink-0 hidden sm:inline mt-0.5">{entry.source}</span>
                <span className="text-[#94a3b8] break-all flex-1 mt-0.5 font-mono text-[0.72rem]">
                  {entry.preview}
                </span>
              </div>
            )
          })}
        </div>

        {events.length > 0 && (
          <div className="text-[0.7rem] text-[#4a5568] text-right mt-2">
            显示最近 {events.length} 条 / 最大 {maxEvents} 条
            <button
              type="button"
              className="ml-2 text-[#6c63ff] hover:underline"
              onClick={() => setMaxEvents(v => Math.min(v + 200, 1000))}
            >
              增加上限
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
