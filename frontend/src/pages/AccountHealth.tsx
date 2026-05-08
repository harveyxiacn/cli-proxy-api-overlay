import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import {
  fetchAccountHealth, recomputeAccountHealth, qkeys,
  warmupAccounts, patchAuthFileStatusBatch,
} from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { Button } from "@/components/ui/Button"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { useToast } from "@/components/ui/Toast"
import type { AccountHealthItem, AccountHealthSuggestion } from "@/api/types"
import { fmtRelative, fmtDate } from "@/lib/utils"
import { RefreshCw, Activity, Filter } from "lucide-react"

const levelVariant = {
  healthy: "green",
  warning: "yellow",
  critical: "red",
} as const

const severityBadge = {
  info: "blue",
  warning: "yellow",
  critical: "red",
} as const

const riskVariant = {
  none: "default",
  low: "blue",
  medium: "yellow",
  high: "red",
} as const

const REASON_LABEL: Record<string, string> = {
  disabled: "已禁用",
  status_error: "状态错误",
  needs_relogin: "需要重新登录",
  unavailable: "不可用",
  failure_rate_high: "失败率偏高",
  failure_rate_severe: "失败率严重",
  consecutive_failures: "连续失败",
  stale: "长时间无成功请求",
  quota_low: "Quota 偏低",
  quota_critical: "Quota 危急",
}

function formatReason(code: string, message?: string): string {
  const label = REASON_LABEL[code] ?? code
  return message ? `${label}：${message}` : label
}

function fmtPct(v: number | undefined): string {
  if (v === undefined || v === null) return "—"
  return v.toFixed(1) + "%"
}

export function AccountHealth() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()

  const [levelFilter, setLevelFilter] = useState<"all" | "healthy" | "warning" | "critical">("all")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const [reasonFilter, setReasonFilter] = useState<string>("all")
  const [search, setSearch] = useState("")

  const health = useQuery({
    queryKey: qkeys.accountHealth(config),
    queryFn: () => fetchAccountHealth(config),
    enabled: connected,
    refetchInterval: 30_000,
  })

  const recompute = useMutation({
    mutationFn: () => recomputeAccountHealth(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.accountHealth(config) })
      toast.success("已重新计算")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const warmup = useMutation({
    mutationFn: (names: string[]) => warmupAccounts(config, names),
    onSuccess: r => {
      toast.success(`Warmup 完成：成功 ${r.succeeded} / 失败 ${r.failed}`)
      qc.invalidateQueries({ queryKey: qkeys.accountHealth(config) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const disableBatch = useMutation({
    mutationFn: (names: string[]) => patchAuthFileStatusBatch(config, names, true),
    onSuccess: () => {
      toast.success("已禁用所选账号")
      qc.invalidateQueries({ queryKey: qkeys.accountHealth(config) })
      qc.invalidateQueries({ queryKey: qkeys.authFiles(config) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const data = health.data
  const items = data?.items ?? []
  const summary = data?.summary

  const providers = useMemo(() => {
    const set = new Set<string>()
    items.forEach(i => i.provider && set.add(i.provider))
    return Array.from(set).sort()
  }, [items])

  const reasonCodes = useMemo(() => {
    const set = new Set<string>()
    items.forEach(i => (i.reasons ?? []).forEach(r => set.add(r.code)))
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i => {
      if (levelFilter !== "all" && i.level !== levelFilter) return false
      if (providerFilter !== "all" && i.provider !== providerFilter) return false
      if (reasonFilter !== "all" && !(i.reasons ?? []).some(r => r.code === reasonFilter)) return false
      if (q) {
        const hay = `${i.name} ${i.email ?? ""} ${i.group ?? ""} ${(i.tags ?? []).join(" ")}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, levelFilter, providerFilter, reasonFilter, search])

  const handleConfirmedAction = (kind: string, names: string[], action: () => void) => {
    if (names.length === 0) {
      toast.info("没有候选账号")
      return
    }
    if (window.confirm(`确认对 ${names.length} 个账号执行${kind}？`)) action()
  }

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          <span className="flex items-center gap-2"><Activity size={16} /> 账号健康诊断</span>
          <div className="flex items-center gap-2">
            {data?.computed_at && (
              <span className="text-[0.7rem] text-[#64748b] font-normal">
                更新于 {fmtRelative(data.computed_at)}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
              <RefreshCw size={12} /> 重新计算
            </Button>
          </div>
        </CardTitle>
        <Alert type="info">
          诊断只读取本地缓存（auth manager + 上次 codex-quota + 请求历史 ring buffer），不向 provider 发送请求。建议动作仅作提示，禁用 / 删除等动作仍需人工在批量操作区显式确认。
        </Alert>
        <StatsGrid>
          <StatCard label="总数"        value={summary?.total ?? 0} />
          <StatCard label="Healthy"    value={summary?.healthy ?? 0}  color="text-green-400" />
          <StatCard label="Warning"    value={summary?.warning ?? 0}  color="text-yellow-400" />
          <StatCard label="Critical"   value={summary?.critical ?? 0} color="text-red-400" />
          <StatCard label="需重登录"    value={summary?.needs_relogin ?? 0} color="text-orange-400" />
          <StatCard label="Quota 偏低"  value={summary?.quota_low ?? 0}     color="text-yellow-400" />
          <StatCard label="长时间未用"  value={summary?.stale ?? 0}         color="text-slate-400" />
        </StatsGrid>
      </Card>

      <Card>
        <CardTitle>
          <span className="flex items-center gap-2"><Filter size={14} /> 批量候选</span>
        </CardTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
          <BatchTile
            title="需要重登录"
            names={data?.candidates.relogin ?? []}
            actionLabel="复制清单"
            onAct={names => handleConfirmedAction("批量重登录提示", names, () => {
              navigator.clipboard.writeText(names.join("\n")).then(
                () => toast.success(`已复制 ${names.length} 个账号名称，到 OAuth 登录页执行批量重登录`),
              )
            })}
          />
          <BatchTile
            title="建议 Warmup"
            names={data?.candidates.warmup ?? []}
            actionLabel="一键 Warmup"
            onAct={names => handleConfirmedAction("Warmup", names, () => warmup.mutate(names))}
            busy={warmup.isPending}
          />
          <BatchTile
            title="建议禁用"
            names={data?.candidates.disable ?? []}
            actionLabel="批量禁用"
            danger
            onAct={names => handleConfirmedAction("禁用", names, () => disableBatch.mutate(names))}
            busy={disableBatch.isPending}
          />
          <BatchTile
            title="删除复核"
            names={data?.candidates.delete_review ?? []}
            actionLabel="复制清单"
            onAct={names => handleConfirmedAction("删除复核（仅复制清单，不执行删除）", names, () => {
              navigator.clipboard.writeText(names.join("\n")).then(
                () => toast.success(`已复制 ${names.length} 个候选名称`),
              )
            })}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>账号健康表</CardTitle>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select className="bg-[#22263a] border border-[#2d3148] rounded px-2 py-1 text-xs"
                  value={levelFilter} onChange={e => setLevelFilter(e.target.value as never)}>
            <option value="all">全部等级</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="healthy">Healthy</option>
          </select>
          <select className="bg-[#22263a] border border-[#2d3148] rounded px-2 py-1 text-xs"
                  value={providerFilter} onChange={e => setProviderFilter(e.target.value)}>
            <option value="all">全部 Provider</option>
            {providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="bg-[#22263a] border border-[#2d3148] rounded px-2 py-1 text-xs"
                  value={reasonFilter} onChange={e => setReasonFilter(e.target.value)}>
            <option value="all">全部 reason</option>
            {reasonCodes.map(r => <option key={r} value={r}>{REASON_LABEL[r] ?? r}</option>)}
          </select>
          <input className="bg-[#22263a] border border-[#2d3148] rounded px-2 py-1 text-xs flex-1 min-w-[180px]"
                 placeholder="搜索 name / email / group / tag"
                 value={search} onChange={e => setSearch(e.target.value)} />
          <span className="text-[0.7rem] text-[#64748b]">显示 {filtered.length} / {items.length}</span>
        </div>

        {health.isLoading && <div className="text-sm text-[#94a3b8]">加载中…</div>}
        {!health.isLoading && filtered.length === 0 && (
          <Alert type="success">
            {items.length === 0
              ? "尚无账号数据。请先在 OAuth 页面登录或上传 auth 文件。"
              : "当前过滤条件下无匹配账号。"}
          </Alert>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[0.78rem]">
            <thead className="text-left text-[#94a3b8] border-b border-[#2d3148]">
              <tr>
                <th className="py-2 pr-2">账号</th>
                <th className="py-2 pr-2">等级</th>
                <th className="py-2 pr-2 text-center">Score</th>
                <th className="py-2 pr-2">主要原因</th>
                <th className="py-2 pr-2">建议</th>
                <th className="py-2 pr-2 text-right">24h 请求 / 失败</th>
                <th className="py-2 pr-2 text-right">Quota</th>
                <th className="py-2 pr-2 text-right">最近请求</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => <Row key={item.name} item={item} />)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Row({ item }: { item: AccountHealthItem }) {
  return (
    <tr className="border-b border-[#1f2230] hover:bg-[#22263a]/50">
      <td className="py-2 pr-2">
        <Link to={`/accounts/${encodeURIComponent(item.name)}`}
              className="font-semibold text-[#e2e8f0] hover:text-[#6c63ff] hover:underline">
          {item.name}
        </Link>
        {(item.email || item.group) && (
          <div className="text-[0.7rem] text-[#64748b]">
            {[item.email, item.group, item.provider].filter(Boolean).join(" · ")}
          </div>
        )}
        {item.tags && item.tags.length > 0 && (
          <div className="flex gap-1 mt-1">
            {item.tags.map(t => <Badge key={t} variant="default">{t}</Badge>)}
          </div>
        )}
      </td>
      <td className="py-2 pr-2"><Badge variant={levelVariant[item.level]}>{item.level}</Badge></td>
      <td className="py-2 pr-2 text-center font-mono">{item.score}</td>
      <td className="py-2 pr-2">
        {(item.reasons?.length ?? 0) === 0
          ? <span className="text-[#64748b]">—</span>
          : (
            <div className="flex flex-wrap gap-1">
              {(item.reasons ?? []).map((r, i) => (
                <Badge key={`${r.code}:${i}`} variant={severityBadge[r.severity]}
                       title={r.message}>
                  {formatReason(r.code, r.message)}
                </Badge>
              ))}
            </div>
          )}
      </td>
      <td className="py-2 pr-2">
        <div className="flex flex-wrap gap-1">
          {(item.suggested_actions ?? []).map((s: AccountHealthSuggestion, i) => (
            <Badge key={`${s.type}:${i}`} variant={riskVariant[s.risk]}>{s.label}</Badge>
          ))}
        </div>
      </td>
      <td className="py-2 pr-2 text-right font-mono">
        <span>{item.request_window.requests_24h}</span>
        <span className="text-[#64748b]"> / </span>
        <span className={item.request_window.failed_24h > 0 ? "text-red-400" : "text-[#64748b]"}>
          {item.request_window.failed_24h}
        </span>
        {item.request_window.requests_24h >= 10 && (
          <div className="text-[0.65rem] text-[#64748b]">
            {(item.request_window.failure_rate_24h * 100).toFixed(1)}%
          </div>
        )}
      </td>
      <td className="py-2 pr-2 text-right font-mono">
        {item.quota
          ? (
            <div>
              <div title="primary remaining">P {fmtPct(item.quota.primary_remaining)}</div>
              <div title="secondary remaining" className="text-[0.65rem] text-[#94a3b8]">
                S {fmtPct(item.quota.secondary_remaining)}
              </div>
            </div>
          )
          : <span className="text-[#64748b]">—</span>}
      </td>
      <td className="py-2 pr-2 text-right text-[#94a3b8]">
        {item.last_request_at
          ? <span title={fmtDate(item.last_request_at)}>{fmtRelative(item.last_request_at)}</span>
          : <span className="text-[#64748b]">从未</span>}
      </td>
    </tr>
  )
}

function BatchTile({ title, names, actionLabel, onAct, danger, busy }: {
  title: string
  names: string[]
  actionLabel: string
  onAct: (names: string[]) => void
  danger?: boolean
  busy?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-[#22263a] border border-[#2d3148] rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold">{title}</span>
        <Badge variant={danger ? "red" : names.length > 0 ? "yellow" : "default"}>
          {names.length}
        </Badge>
      </div>
      {names.length === 0
        ? <div className="text-[0.7rem] text-[#64748b]">无候选</div>
        : (
          <>
            <div className="text-[0.7rem] text-[#94a3b8] mb-2 max-h-20 overflow-auto">
              {(expanded ? names : names.slice(0, 3)).map(n => <div key={n}>{n}</div>)}
              {names.length > 3 && (
                <button
                  className="text-[#6c63ff] hover:underline text-[0.7rem]"
                  onClick={() => setExpanded(v => !v)}
                >
                  {expanded ? "收起" : `+${names.length - 3} 更多`}
                </button>
              )}
            </div>
            <Button
              size="sm"
              variant={danger ? "danger" : "primary"}
              disabled={busy}
              onClick={() => onAct(names)}
            >
              {actionLabel}
            </Button>
          </>
        )}
    </div>
  )
}
