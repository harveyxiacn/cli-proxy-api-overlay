import { useState, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { startOAuthRepairFlow, fetchCodexAuthUrl, fetchAuthStatus, uploadAuthFile, warmupOAuthRepairSession, qkeys } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { useToast } from "@/components/ui/Toast"
import { Upload } from "lucide-react"

type OAuthPhase = "idle" | "pending" | "success" | "error" | "timeout"

export function OAuth() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase]       = useState<OAuthPhase>("idle")
  const [oauthUrl, setOauthUrl] = useState("")
  const [errMsg, setErrMsg]     = useState("")
  const [repairProvider, setRepairProvider] = useState("codex")
  const [repairTarget, setRepairTarget] = useState("")
  const [repairStatus, setRepairStatus] = useState("")
  const [repairSessionID, setRepairSessionID] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const stateRef = useRef("")

  const startOAuth = async () => {
    if (!connected) return
    setPhase("idle"); setOauthUrl(""); setErrMsg("")
    clearInterval(pollRef.current)
    try {
      const r = await fetchCodexAuthUrl(config)
      stateRef.current = r.state
      setOauthUrl(r.url)
      setPhase("pending")
      window.open(r.url, "_blank")
      let attempts = 0
      pollRef.current = setInterval(async () => {
        if (++attempts > 60 || stateRef.current !== r.state) {
          clearInterval(pollRef.current)
          if (stateRef.current === r.state) { setPhase("timeout"); setErrMsg("5分钟内未完成授权") }
          return
        }
        try {
          const s = await fetchAuthStatus(config, r.state)
          if (s.status === "ok") {
            clearInterval(pollRef.current); setPhase("success")
            toast.success("OAuth 授权完成，令牌已保存！")
            qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
          } else if (s.status === "error") {
            clearInterval(pollRef.current); setPhase("error"); setErrMsg(s.error ?? "授权失败")
          }
        } catch {}
      }, 5000)
    } catch (e) { setPhase("error"); setErrMsg(e instanceof Error ? e.message : String(e)) }
  }

  const stopOAuth = () => {
    stateRef.current = ""
    clearInterval(pollRef.current)
    setPhase("idle")
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    let ok = 0, fail = 0
    for (const f of Array.from(files)) {
      if (!f.name.endsWith(".json")) continue
      try { await uploadAuthFile(config, await f.arrayBuffer(), f.name); ok++ }
      catch { fail++ }
    }
    if (ok > 0) {
      toast.success(`上传成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ""}`)
      qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
    } else if (fail > 0) {
      toast.error(`上传失败 ${fail} 个文件`)
    }
  }

  const startRepair = async () => {
    if (!repairTarget.trim()) {
      toast.error("请输入需要修复的授权文件名")
      return
    }
    try {
      const { sessionId, providerOAuthUrl } = await startOAuthRepairFlow(config, repairProvider, repairTarget.trim())
      setRepairSessionID(sessionId)
      setRepairStatus("已创建修复会话，OAuth 授权页面已在新标签打开")
      window.open(providerOAuthUrl, "_blank")
    } catch (e) {
      setRepairStatus("创建失败：" + (e instanceof Error ? e.message : String(e)))
    }
  }

  const markRepairWarmup = async () => {
    if (!repairSessionID) return
    const session = await warmupOAuthRepairSession(config, repairSessionID)
    setRepairStatus(`修复状态：${session.status}`)
    qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
  }

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <div className="flex gap-3 flex-wrap">
      {/* Codex OAuth */}
      <Card className="flex-1 min-w-[300px] max-w-[520px]">
        <CardTitle>Codex OAuth 登录</CardTitle>
        <p className="text-[0.84rem] text-[#94a3b8] mb-3">
          通过 Web UI 完成 Codex (OpenAI) OAuth 授权，令牌自动保存到 CPA。
        </p>

        <div className="flex gap-2 mb-3">
          <Button variant="primary" onClick={startOAuth} disabled={phase === "pending"}>
            {phase === "pending" ? <><Spinner size={12} /> 等待授权…</> : "🔑 启动 Codex OAuth"}
          </Button>
          {phase === "pending" && (
            <Button variant="ghost" onClick={stopOAuth}>⏹ 停止</Button>
          )}
        </div>

        {oauthUrl && phase === "pending" && (
          <div className="bg-[#0f1117] border border-[#2d3148] rounded-lg p-3 text-[0.77rem] text-[#94a3b8] break-all mb-2">
            <p className="font-semibold mb-1">授权链接（已自动在新标签打开）:</p>
            <a href={oauthUrl} target="_blank" rel="noreferrer" className="text-[#6c63ff] hover:underline">{oauthUrl}</a>
          </div>
        )}

        {phase === "pending" && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 rounded-lg p-2.5 text-[0.82rem]">
            ⏳ 等待用户在浏览器中完成授权…
          </div>
        )}
        {phase === "success" && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg p-2.5 text-[0.82rem]">
            ✓ 授权完成，令牌已保存！
          </div>
        )}
        {(phase === "error" || phase === "timeout") && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-2.5 text-[0.82rem]">
            {phase === "timeout" ? "⏰ 超时：" : "✗ 授权失败："}{errMsg}
          </div>
        )}
      </Card>

      {/* Upload */}
      <Card className="flex-1 min-w-[300px] max-w-[520px]">
        <CardTitle>上传 JSON 授权文件</CardTitle>
        <p className="text-[0.84rem] text-[#94a3b8] mb-3">直接将已有的 JSON 令牌文件上传到 CPA。</p>
        <div
          className="border-2 border-dashed border-[#2d3148] rounded-[10px] p-6 text-center cursor-pointer hover:border-[#6c63ff] hover:bg-[#6c63ff]/5 transition-all"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files) }}
        >
          <Upload size={20} className="mx-auto mb-2 text-[#64748b]" />
          <p className="text-[0.84rem] text-[#94a3b8]">点击或拖拽上传 JSON 文件</p>
        </div>
        <input ref={fileRef} type="file" accept=".json" multiple className="hidden"
               onChange={e => handleUpload(e.target.files)} />
      </Card>

      <Card className="flex-1 min-w-[300px] max-w-[520px]">
        <CardTitle>OAuth 修复向导</CardTitle>
        <p className="text-[0.84rem] text-[#94a3b8] mb-3">
          针对 refresh_token_reused、invalid_grant 等失效账号创建修复会话。授权完成后可继续 warmup 并刷新账号状态。
        </p>
        <div className="grid gap-2 mb-3">
          <select value={repairProvider} onChange={e => setRepairProvider(e.target.value)} className="bg-[#11131a] border border-[#2d3148] rounded px-3 py-2 text-sm">
            <option value="codex">Codex</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini-cli">Gemini CLI</option>
            <option value="antigravity">Antigravity</option>
            <option value="kimi">Kimi</option>
          </select>
          <input value={repairTarget} onChange={e => setRepairTarget(e.target.value)} placeholder="例如 user@example.com.json" className="bg-[#11131a] border border-[#2d3148] rounded px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={startRepair}>创建修复会话</Button>
          <Button variant="success" disabled={!repairSessionID} onClick={markRepairWarmup}>标记 warmup</Button>
        </div>
        {repairStatus && <div className="mt-3 text-xs text-[#94a3b8] bg-[#11131a] border border-[#2d3148] rounded p-2">{repairStatus}</div>}
      </Card>
    </div>
  )
}
