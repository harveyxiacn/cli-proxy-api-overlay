import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { ConnectConfig } from "@/api/types"

export interface SavedInstance {
  id: string
  label: string
  config: ConnectConfig
  lastUsed: number
}

interface ConnectionState {
  config: ConnectConfig
  connected: boolean
  savedInstances: SavedInstance[]
  setConfig: (config: ConnectConfig) => void
  setConnected: (v: boolean) => void
  disconnect: () => void
  saveInstance: (label: string) => void
  switchInstance: (id: string) => void
  removeInstance: (id: string) => void
}

export function defaultCpaUrl(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin) {
    return window.location.origin.replace(/\/$/, "")
  }
  return "http://127.0.0.1:8317"
}

const LEGACY_LOCALHOST_URL = "http://127.0.0.1:8317"
const localhostOriginPattern = /^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/

function maybeMigrateStaleLocalhost(state: ConnectionState | undefined): void {
  if (!state) return
  if (typeof window === "undefined" || !window.location?.origin) return
  const currentOrigin = window.location.origin.replace(/\/$/, "")
  const onLocalhostPage = localhostOriginPattern.test(currentOrigin)
  if (!onLocalhostPage && state.config.url === LEGACY_LOCALHOST_URL) {
    state.config = { ...state.config, url: currentOrigin }
  }
}

export const useConnection = create<ConnectionState>()(
  persist(
    (set, get) => ({
      config: { url: defaultCpaUrl(), key: "" },
      connected: false,
      savedInstances: [],

      setConfig: (config) => set({ config }),
      setConnected: (connected) => set({ connected }),
      disconnect: () => set({ connected: false }),

      saveInstance: (label) => {
        const { config, savedInstances } = get()
        const id = `inst_${Date.now()}`
        // Don't duplicate same URL
        const existing = savedInstances.find(i => i.config.url === config.url)
        if (existing) {
          set({
            savedInstances: savedInstances.map(i =>
              i.id === existing.id ? { ...i, label, config, lastUsed: Date.now() } : i
            )
          })
          return
        }
        set({
          savedInstances: [
            ...savedInstances.slice(-4), // keep last 5
            { id, label, config, lastUsed: Date.now() }
          ]
        })
      },

      switchInstance: (id) => {
        const { savedInstances } = get()
        const inst = savedInstances.find(i => i.id === id)
        if (!inst) return
        set({
          config: inst.config,
          connected: false,
          savedInstances: savedInstances.map(i =>
            i.id === id ? { ...i, lastUsed: Date.now() } : i
          )
        })
      },

      removeInstance: (id) => {
        set({ savedInstances: get().savedInstances.filter(i => i.id !== id) })
      },
    }),
    {
      name: "cpa-connection",
      partialize: (s) => ({ config: s.config, savedInstances: s.savedInstances }),
      onRehydrateStorage: () => (state) => maybeMigrateStaleLocalhost(state),
    }
  )
)
