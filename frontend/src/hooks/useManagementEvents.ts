import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { connectManagementEvents } from "@/api/events"
import { qkeys } from "@/api/queries"
import type { ManagementEventEnvelope } from "@/api/types"

export type SSEState = "connecting" | "open" | "error" | "closed"

/**
 * Connect to /v0/management/events SSE stream and invalidate React Query
 * caches when relevant events arrive. Auto-reconnects on error after 5s.
 *
 * Returns the current connection state for display in UI.
 */
export function useManagementEvents(): SSEState {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const [state, setState] = useState<SSEState>("closed")
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>()
  const closeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!connected) {
      closeRef.current?.()
      closeRef.current = null
      setState("closed")
      return
    }

    let cancelled = false

    const connect = async () => {
      if (cancelled) return
      try {
        const close = await connectManagementEvents(
          config,
          (event) => onEvent(qc, config, event),
          (s) => { if (!cancelled) setState(s) }
        )
        if (cancelled) {
          close()
          return
        }
        closeRef.current = close
      } catch {
        if (!cancelled) {
          setState("error")
          // Retry after 5s
          reconnectRef.current = setTimeout(connect, 5_000)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimeout(reconnectRef.current)
      closeRef.current?.()
      closeRef.current = null
      setState("closed")
    }
  }, [config, connected, qc])

  // Reconnect on error after a delay
  useEffect(() => {
    if (state !== "error") return
    reconnectRef.current = setTimeout(() => {
      setState("connecting")
    }, 5_000)
    return () => clearTimeout(reconnectRef.current)
  }, [state])

  return state
}

function onEvent(
  qc: ReturnType<typeof useQueryClient>,
  config: { url: string; key: string },
  event: ManagementEventEnvelope
) {
  switch (event.type) {
    case "job.created":
    case "job.updated":
      qc.invalidateQueries({ queryKey: ["jobs-list", config.url, config.key] })
      break
    case "request.recorded":
      qc.invalidateQueries({ queryKey: qkeys.history(config) })
      qc.invalidateQueries({ queryKey: qkeys.tokens(config) })
      qc.invalidateQueries({ queryKey: qkeys.snapshot(config) })
      break
    case "auth.status_changed":
      qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
      qc.invalidateQueries({ queryKey: qkeys.snapshot(config) })
      qc.invalidateQueries({ queryKey: qkeys.issues(config) })
      qc.invalidateQueries({ queryKey: qkeys.alerts(config) })
      break
    case "oauth.session_created":
    case "oauth.warmup_completed":
      qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
      break
  }
}
