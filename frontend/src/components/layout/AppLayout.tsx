import { type ReactNode, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Sidebar } from "./Sidebar"
import { Header } from "./Header"
import { ConnectBar } from "./ConnectBar"
import { useConnection } from "@/stores/connection"
import { fetchStartupSnapshot } from "@/api/queries"
import { ErrorBoundary } from "@/components/ErrorBoundary"

export function AppLayout({ children }: { children: ReactNode }) {
  const { config, connected, setConnected } = useConnection()
  const qc = useQueryClient()
  const triedAutoConnect = useRef(false)

  // Auto-connect on first mount if a saved key exists
  useEffect(() => {
    if (triedAutoConnect.current) return
    if (connected) return
    if (!config.url || !config.key) return
    triedAutoConnect.current = true
    fetchStartupSnapshot(config)
      .then(() => {
        setConnected(true)
        qc.invalidateQueries()
      })
      .catch(() => {
        // Silent fail — show connect bar
      })
  }, [config, connected, setConnected, qc])

  return (
    <div className="flex min-h-screen bg-[#0f1117]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-4 max-w-[1600px] w-full mx-auto">
          {!connected && <ConnectBar />}
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
