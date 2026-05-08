import { useState, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { fetchAuthFiles, deleteAuthFilesBatch, qkeys } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Badge, AuthStatusBadge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { useToast } from "@/components/ui/Toast"
import { fmtDate, needsRelogin } from "@/lib/utils"
import type { AuthFile } from "@/api/types"

const FN_PATTERNS: { re: RegExp; penalty: number; label: string }[] = [
  { re: /\s*\(\d+\)\s*\.json$/i,          penalty: 8, label: "OS复制 (N)" },
  { re: /-run\d+[-_]\d{8}[-_]\d{6}/i,    penalty: 5, label: "运行时间戳" },
  { re: /-\d{4}-?\d{2}-?\d{2}[-_]\d{6}/, penalty: 5, label: "日期时间戳" },
  { re: /[_-]\d{14}(?=\.json$)/i,         penalty: 5, label: "紧凑时间戳" },
  { re: /[-_](bak|backup|old|tmp)\b/i,    penalty: 5, label: "备份标记"  },
]

function filenameScore(name: string): number {
  let p = 0; for (const fp of FN_PATTERNS) if (fp.re.test(name)) p += fp.penalty
  return p > 0 ? -p : 3
}

function filenameHint(name: string): string {
  return FN_PATTERNS.filter(fp => fp.re.test(name)).map(fp => fp.label).join(" + ")
}

function scoreFile(f: AuthFile): number {
  if (f.disabled)                     return -20
  if (needsRelogin(f.status_message ?? "")) return -10
  let s = f.status === "active" ? 30 : f.status === "ready" ? 20 : f.status === "error" ? 0 : 5
  if (f.last_refresh) {
    const ageH = (Date.now() - new Date(f.last_refresh).getTime()) / 3600000
    s += Math.max(0, 10 - ageH)
  }
  const tot = (f.success ?? 0) + (f.failed ?? 0)
  if (tot > 0) s += Math.min(5, (f.success ?? 0) / tot * 5)
  s += filenameScore(f.name)
  return s
}

interface DupGroup { email: string; files: AuthFile[]; best: AuthFile }

function buildGroups(files: AuthFile[]): DupGroup[] {
  const map = new Map<string, AuthFile[]>()
  for (const f of files) {
    const key = (f.email ?? "").toLowerCase().trim()
    if (!key) continue
    map.set(key, [...(map.get(key) ?? []), f])
  }
  return [...map.entries()]
    .filter(([, fs]) => fs.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([email, fls]) => ({
      email, files: fls,
      best: fls.reduce((b, f) => scoreFile(f) > scoreFile(b) ? f : b)
    }))
}

export function Duplicates() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const [groups, setGroups]     = useState<DupGroup[]>([])
  const [loading, setLoading]   = useState(false)
  const [scanned, setScanned]   = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const detect = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchAuthFiles(config)
      setGroups(buildGroups(r.files))
      setScanned(true)
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [config, toast])

  const cleanGroup = useCallback(async (g: DupGroup) => {
    const toDelete = g.files.filter(f => f.name !== g.best.name)
    if (!confirm(`确认删除 ${g.email} 的 ${toDelete.length} 个冗余文件，保留"${g.best.name}"？`)) return
    try {
      const r = await deleteAuthFilesBatch(config, toDelete.map(f => f.name))
      const ok = r.deleted ?? r.files.length
      const fail = r.failed ?? 0
      toast[fail ? "warn" : "success"](`清理完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ""}`)
      await detect()
      qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [config, detect, qc, toast])

  const cleanAll = useCallback(async () => {
    const total = groups.reduce((n, g) => n + g.files.length - 1, 0)
    if (!confirm(`确认清理全部 ${groups.length} 个重复账号？将删除 ${total} 个冗余文件。`)) return
    const names = groups.flatMap(g => g.files.filter(f => f.name !== g.best.name).map(f => f.name))
    try {
      const r = await deleteAuthFilesBatch(config, names)
      const ok = r.deleted ?? r.files.length
      const fail = r.failed ?? 0
      toast[fail ? "warn" : "success"](`清理完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ""}`)
      await detect()
      qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [config, detect, groups, qc, toast])

  const totalDel = groups.reduce((n, g) => n + g.files.length - 1, 0)

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <Card>
      <CardTitle>
        重复账号检测
        <div className="flex gap-1.5 items-center">
          {scanned && groups.length > 0 && (
            <span className="text-[0.8rem] text-[#94a3b8]">
              发现 {groups.length} 个重复账号，{totalDel} 个冗余文件
            </span>
          )}
          <Button variant="primary" size="sm" onClick={detect} disabled={loading}>
            {loading ? "检测中…" : "🔍 检测重复"}
          </Button>
          {groups.length > 0 && (
            <Button variant="danger" size="sm" onClick={cleanAll}>🗑 一键清理全部</Button>
          )}
        </div>
      </CardTitle>

      <Alert type="info" className="text-[0.8rem]">
        按邮箱分组，找出 ≥2 个文件的账号。评分：active=30 / ready=20 / 错误=0 / 禁用=-20；
        文件名含"(1)"或时间戳 → 扣分；最近刷新 → 加分。保留得分最高的文件。
      </Alert>

      {scanned && groups.length === 0 && (
        <p className="text-center text-[#64748b] py-6">✓ 未发现重复账号</p>
      )}

      {groups.map(g => {
        const toDelete = g.files.filter(f => f.name !== g.best.name)
        const isOpen = expanded.has(g.email)
        return (
          <div key={g.email} className="border border-[#2d3148] rounded-lg mb-2 overflow-hidden">
            <div
              className="flex items-center gap-2 px-3 py-2 bg-[#22263a] cursor-pointer hover:brightness-110 flex-wrap"
              onClick={() => setExpanded(prev => {
                const n = new Set(prev)
                isOpen ? n.delete(g.email) : n.add(g.email)
                return n
              })}
            >
              <span className="text-sm font-semibold text-[#e2e8f0]">{g.email}</span>
              <Badge variant="red" className="text-[0.72rem]">{g.files.length} 个文件</Badge>
              <span className="text-xs text-[#64748b]">保留: <b className="text-[#e2e8f0]">{g.best.name}</b></span>
              <span className="flex-1" />
              <Button variant="danger" size="sm" onClick={() => cleanGroup(g)}>
                🗑 保留最优，删 {toDelete.length} 个
              </Button>
              <span className="text-[#64748b] text-xs">{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && (
              <div className="overflow-x-auto border-t border-[#2d3148]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#22263a]">
                      {["文件名", "状态", "最后刷新", "错误信息", "评分", "文件名问题", "判定"].map(h => (
                        <th key={h} className="text-left px-2 py-1.5 text-[#64748b] font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.files.map(f => {
                      const isKeep = f.name === g.best.name
                      const score  = scoreFile(f).toFixed(1)
                      const hint   = filenameHint(f.name)
                      return (
                        <tr key={f.name} className={isKeep ? "" : "bg-red-500/[0.04]"}>
                          <td className="px-2 py-1.5 text-[#94a3b8] max-w-[200px] truncate" title={f.name}>{f.name}</td>
                          <td className="px-2 py-1.5">
                            <AuthStatusBadge
                              status={f.status} disabled={f.disabled}
                              statusMessage={f.status_message}
                              lastRefresh={f.last_refresh} failed={f.failed}
                              lastError={f.last_error}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-[#64748b] whitespace-nowrap">
                            {f.last_refresh ? fmtDate(new Date(f.last_refresh).getTime() / 1000) : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-yellow-400 max-w-[180px] truncate" title={f.status_message ?? ""}>{f.status_message ?? "-"}</td>
                          <td className="px-2 py-1.5 text-[#94a3b8]" title={`综合评分 ${score}`}>{score}</td>
                          <td className="px-2 py-1.5 text-orange-400">{hint || "-"}</td>
                          <td className="px-2 py-1.5">
                            {isKeep
                              ? <Badge variant="green" className="text-[0.71rem]">保留</Badge>
                              : <Badge variant="red"   className="text-[0.71rem]">删除</Badge>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}
