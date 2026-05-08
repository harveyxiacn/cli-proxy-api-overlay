import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useConnection, defaultCpaUrl } from "@/stores/connection"
import { fetchStartupSnapshot } from "@/api/queries"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"

export function ConnectBar() {
  const { config, setConfig, setConnected } = useConnection()
  const currentOrigin = defaultCpaUrl()
  const [url, setUrl] = useState(config.url)
  const [key, setKey] = useState(config.key)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const connect = async () => {
    if (!url.trim() || !key.trim()) { setErr("请填写地址和密钥"); return }
    setBusy(true); setErr("")
    const cfg = { url: url.trim().replace(/\/$/, ""), key: key.trim() }
    try {
      await fetchStartupSnapshot(cfg)
      setConfig(cfg)
      setConnected(true)
      qc.invalidateQueries()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "连接失败")
    } finally { setBusy(false) }
  }

  return (
    <div className="flex gap-2 flex-wrap items-center bg-[#1a1d27] border border-[#2d3148] rounded-[10px] p-3 mb-4">
      <Input
        value={url} onChange={e => setUrl(e.target.value)}
        placeholder={`CPA 地址  ${currentOrigin}`}
        className="flex-1 min-w-[200px]"
      />
      {url !== currentOrigin && (
        <Button
          variant="ghost"
          onClick={() => setUrl(currentOrigin)}
          title={`重置为当前站点 (${currentOrigin})`}
        >
          📍 当前站点
        </Button>
      )}
      <Input
        type="password" value={key} onChange={e => setKey(e.target.value)}
        onKeyDown={e => e.key === "Enter" && connect()}
        placeholder="管理密钥 (management secret key)"
        className="flex-1 min-w-[180px]"
      />
      <Button variant="primary" onClick={connect} disabled={busy}>
        {busy ? "连接中…" : "连接"}
      </Button>
      {err && <span className="text-[0.83rem] text-red-400">{err}</span>}
    </div>
  )
}
