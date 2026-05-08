import { useState, useRef, useEffect, useCallback } from "react"
import { useConnection } from "@/stores/connection"
import { fetchLogs, clearLogs } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { useToast } from "@/components/ui/Toast"

const LEVEL_RE = /\[(info|warn|error|debug)\s*\]/i
const LEVEL_OPTIONS = [
  { value: "", label: "全部级别" },
  { value: "error", label: "error" },
  { value: "warn",  label: "warn"  },
  { value: "info",  label: "info"  },
  { value: "debug", label: "debug" },
]

function lineColor(line: string): string {
  const m = LEVEL_RE.exec(line)
  if (!m) return "text-[#94a3b8]"
  switch (m[1].toLowerCase()) {
    case "error": return "text-red-400"
    case "warn":  return "text-yellow-400"
    case "info":  return "text-blue-400"
    case "debug": return "text-[#64748b]"
    default:      return "text-[#94a3b8]"
  }
}

export function Logs() {
  const { config, connected } = useConnection()
  const toast = useToast()
  const boxRef = useRef<HTMLDivElement>(null)

  const [lines, setLines]               = useState<string[]>([])
  const [latest, setLatest]             = useState(0)
  const [follow, setFollow]             = useState(true)
  const [loading, setLoading]           = useState(false)
  const [status, setStatus]             = useState("")
  const [search, setSearch]             = useState("")
  const [levelFilter, setLevelFilter]   = useState("")
  const [pollEnabled, setPollEnabled]   = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const load = useCallback(async (reset = false) => {
    if (!connected) return
    setLoading(true)
    try {
      const after = reset ? 0 : latest
      const data = await fetchLogs(config, 500, after)
      const newLines = data.lines ?? []
      setLines(prev => reset ? newLines : [...prev, ...newLines].slice(-2000))
      if (data["latest-timestamp"]) setLatest(data["latest-timestamp"])
      setStatus(`更新于 ${new Date().toLocaleTimeString("zh-CN")} · 共 ${data["line-count"] ?? 0} 行`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus("加载失败: " + msg)
      if (reset) setLines([`[ERROR] ${msg}`])
    } finally { setLoading(false) }
  }, [config, connected, latest])

  useEffect(() => {
    clearInterval(pollRef.current)
    if (pollEnabled && connected) {
      pollRef.current = setInterval(() => load(false), 10_000)
    }
    return () => clearInterval(pollRef.current)
  }, [pollEnabled, connected, load])

  useEffect(() => {
    if (follow && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight
    }
  }, [lines, follow])

  const filtered = lines
    .filter(l => !levelFilter || l.toLowerCase().includes(`[${levelFilter}`))
    .filter(l => !search    || l.toLowerCase().includes(search.toLowerCase()))

  const handleClear = async () => {
    if (!confirm("确认清空所有日志文件？")) return
    try {
      await clearLogs(config)
      setLines([]); setLatest(0)
      toast.success("日志已清空")
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <Card>
      <CardTitle>
        服务器日志
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[0.72rem] text-[#64748b]">{status}</span>
          <Button variant="primary" size="sm" onClick={() => load(true)} disabled={loading}>
            {loading ? <><Spinner size={12} /> 加载中</> : "🔄 刷新"}
          </Button>
          <Button variant={follow ? "primary" : "ghost"} size="sm" onClick={() => setFollow(f => !f)}>
            📌 {follow ? "跟随" : "已暂停"}
          </Button>
          <Button variant="danger" size="sm" onClick={handleClear}>🗑 清空</Button>
        </div>
      </CardTitle>

      <Alert type="warn" className="text-[0.78rem]">
        ⚠ 日志功能需要 config.yaml 中配置 <code className="bg-black/30 px-1 rounded">logging-to-file: true</code>。
      </Alert>

      <div className="flex gap-2 flex-wrap items-center mb-2">
        <Input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="过滤关键词（本地搜索）" className="w-[200px]"
        />
        <Select value={levelFilter} onChange={setLevelFilter} options={LEVEL_OPTIONS} className="w-[110px]" />
        <label className="flex items-center gap-1.5 text-[0.82rem] text-[#94a3b8] cursor-pointer">
          <input type="checkbox" checked={pollEnabled} onChange={e => setPollEnabled(e.target.checked)} className="accent-[#6c63ff]" />
          自动轮询 (10s)
        </label>
        <span className="text-[0.75rem] text-[#64748b]">显示 {filtered.length} 行</span>
      </div>

      <div
        ref={boxRef}
        className="h-[520px] overflow-y-auto rounded-lg p-3 font-mono text-[0.75rem] leading-relaxed bg-[#0a0c14] border border-[#2d3148]"
        style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}
      >
        {filtered.length === 0 && (
          <span className="text-[#64748b]">
            {lines.length === 0 ? "点击「🔄 刷新」加载日志" : "无匹配行"}
          </span>
        )}
        {filtered.map((line, i) => (
          <div key={i} className={lineColor(line)}>{line}</div>
        ))}
      </div>
    </Card>
  )
}
