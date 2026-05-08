import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { ConnectConfig } from "@/api/types"

interface ConnectionState {
  config: ConnectConfig
  connected: boolean
  setConfig: (config: ConnectConfig) => void
  setConnected: (v: boolean) => void
  disconnect: () => void
}

// defaultCpaUrl returns the URL the panel should default to. For new users it
// uses the current page origin (so a panel hosted at https://cpa.example.com
// pre-fills https://cpa.example.com instead of localhost), with a localhost
// fallback for SSR / non-browser contexts.
export function defaultCpaUrl(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin) {
    return window.location.origin.replace(/\/$/, "")
  }
  return "http://127.0.0.1:8317"
}

// Stale-localhost migration. zustand-persist hydrates `config` from localStorage
// if present, so users who saved http://127.0.0.1:8317 with an older bundle keep
// it after re-deployment even though the panel is now hosted on a public domain.
// If we detect that exact mismatch, replace with the current origin once.
const LEGACY_LOCALHOST_URL = "http://127.0.0.1:8317"
const localhostOriginPattern = /^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/

function maybeMigrateStaleLocalhost(state: ConnectionState | undefined): void {
  if (!state) return
  if (typeof window === "undefined" || !window.location?.origin) return
  const currentOrigin = window.location.origin.replace(/\/$/, "")
  const onLocalhostPage = localhostOriginPattern.test(currentOrigin)
  // Only migrate when the panel is hosted on a non-localhost origin AND the
  // saved url is exactly the legacy default. Anyone who deliberately typed
  // localhost (e.g. accessing local CPA from a remote panel) keeps it.
  if (!onLocalhostPage && state.config.url === LEGACY_LOCALHOST_URL) {
    state.config = { ...state.config, url: currentOrigin }
  }
}

export const useConnection = create<ConnectionState>()(
  persist(
    (set) => ({
      config: { url: defaultCpaUrl(), key: "" },
      connected: false,
      setConfig:    (config)    => set({ config }),
      setConnected: (connected) => set({ connected }),
      disconnect:   ()          => set({ connected: false }),
    }),
    {
      name: "cpa-connection",
      partialize: (s) => ({ config: s.config }),
      onRehydrateStorage: () => (state) => maybeMigrateStaleLocalhost(state),
    }
  )
)
