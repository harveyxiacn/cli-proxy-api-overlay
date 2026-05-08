import { createEventsToken } from "./queries"
import type { ConnectConfig, ManagementEventEnvelope } from "./types"

export type ManagementEventHandler = (event: ManagementEventEnvelope) => void

export async function connectManagementEvents(
  config: ConnectConfig,
  onEvent: ManagementEventHandler,
  onState?: (state: "connecting" | "open" | "error") => void,
): Promise<() => void> {
  onState?.("connecting")
  const token = await createEventsToken(config)
  const base = config.url.replace(/\/$/, "")
  const source = new EventSource(`${base}/v0/management/events?token=${encodeURIComponent(token.token)}`)
  source.onopen = () => onState?.("open")
  source.onerror = () => onState?.("error")
  const listener = (msg: MessageEvent) => {
    try {
      onEvent(JSON.parse(msg.data) as ManagementEventEnvelope)
    } catch {
      // Ignore malformed events; REST polling remains the fallback.
    }
  }
  source.addEventListener("job.created", listener)
  source.addEventListener("job.updated", listener)
  source.addEventListener("request.recorded", listener)
  source.addEventListener("auth.status_changed", listener)
  source.addEventListener("oauth.session_created", listener)
  source.addEventListener("oauth.warmup_completed", listener)
  return () => source.close()
}
