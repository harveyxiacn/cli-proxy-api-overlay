import type { ConnectConfig } from "./types"

export const serverVersion = { version: "", commit: "", buildDate: "" }

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function apiFetch<T>(
  method: string, path: string, config: ConnectConfig, body?: unknown
): Promise<T> {
  const url = config.url.replace(/\/$/, "") + "/v0/management" + path
  const res = await fetch(url, {
    method,
    headers: { Authorization: "Bearer " + config.key, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const ver = res.headers.get("X-CPA-VERSION")
  if (ver) {
    serverVersion.version = ver
    serverVersion.commit = res.headers.get("X-CPA-COMMIT") ?? ""
    serverVersion.buildDate = res.headers.get("X-CPA-BUILD-DATE") ?? ""
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const d = await res.json() as { error?: string }; msg = d.error ?? msg } catch {}
    throw new ApiError(msg, res.status)
  }
  return res.json() as Promise<T>
}

export async function apiUpload<T>(
  config: ConnectConfig, blob: ArrayBuffer, filename: string
): Promise<T> {
  const url = config.url.replace(/\/$/, "") + "/v0/management/auth-files?name=" + encodeURIComponent(filename)
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + config.key, "Content-Type": "application/json" },
    body: blob,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const d = await res.json() as { error?: string }; msg = d.error ?? msg } catch {}
    throw new ApiError(msg, res.status)
  }
  return res.json() as Promise<T>
}
