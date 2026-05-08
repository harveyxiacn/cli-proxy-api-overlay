import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import {
  fetchAPIKeyLimits, upsertAPIKeyLimit, deleteAPIKeyLimit, qkeys,
} from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { StatCard, StatsGrid } from "@/components/ui/StatCard"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { Input } from "@/components/ui/Input"
import { useToast } from "@/components/ui/Toast"
import { fmtTokens, fmtRelative } from "@/lib/utils"
import type { APIKeyLimitWithUsage } from "@/api/types"
import { X } from "lucide-react"

type EditState = {
  open: boolean
  // existing limit being edited (or null = create new)
  initial?: APIKeyLimitWithUsage
  // pre-filled hash (e.g. clicked from orphan list)
  hashFromOrphan?: string
}

export function ApiKeyLimits() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const [edit, setEdit] = useState<EditState>({ open: false })

  const limitsQ = useQuery({
    queryKey: qkeys.apiKeyLimits(config),
    queryFn: () => fetchAPIKeyLimits(config),
    enabled: connected,
    refetchInterval: 30_000,
  })

  const upsertMut = useMutation({
    mutationFn: (body: Parameters<typeof upsertAPIKeyLimit>[1]) => upsertAPIKeyLimit(config, body),
    onSuccess: () => {
      toast.success("已保存")
      qc.invalidateQueries({ queryKey: qkeys.apiKeyLimits(config) })
      setEdit({ open: false })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (hash: string) => deleteAPIKeyLimit(config, hash),
    onSuccess: () => {
      toast.success("已删除")
      qc.invalidateQueries({ queryKey: qkeys.apiKeyLimits(config) })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  const data = limitsQ.data
  const limits = data?.limits ?? []
  const orphans = data?.orphans ?? []
  const enabledCount = limits.filter(l => l.enabled).length
  const exceededCount = limits.filter(l => l.status === "exceeded").length
  const warnCount = limits.filter(l => l.status === "warn").length
  const totalUsedToday = limits.reduce((acc, l) => acc + l.used_tokens, 0)

  return (
    <div>
      <Card>
        <CardTitle>
          API Key 限额
          <Button variant="primary" size="sm" onClick={() => setEdit({ open: true })}>
            + 新增限额
          </Button>
        </CardTitle>
        <Alert type="info" className="text-[0.78rem]">
          {data?.note || "v1 是软限额：超额仅展示 + 推送告警，不会拒绝请求。"}
          {data?.date && ` 今日（${data.date}）数据。`}
        </Alert>
      </Card>

      <Card>
        <CardTitle>
          📊 概览
          <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: qkeys.apiKeyLimits(config) })}>
            🔄 刷新
          </Button>
        </CardTitle>
        <StatsGrid>
          <StatCard label="配置数" value={limits.length} color="text-sky-400" />
          <StatCard label="启用中"  value={enabledCount} color="text-green-400" />
          <StatCard label="⚠ Warn (≥80%)" value={warnCount} color="text-yellow-400" />
          <StatCard label="❌ 超额"  value={exceededCount} color="text-red-400" />
          <StatCard label="今日累计 Tokens" value={fmtTokens(totalUsedToday)} color="text-blue-400" sub="所有受管 key" />
          <StatCard label="未管理 (orphan)"  value={orphans.length} color="text-violet-400" sub="活跃但未配置限额" />
        </StatsGrid>
      </Card>

      <Card>
        <CardTitle>已配置的 API Key 限额 ({limits.length})</CardTitle>
        {limitsQ.isLoading && <div className="flex gap-2 items-center text-sm text-[#94a3b8]"><Spinner /> 加载中…</div>}
        {limits.length === 0 && !limitsQ.isLoading && (
          <p className="text-center text-[#64748b] py-6 text-sm">还没有配置限额。点击右上角「+ 新增限额」开始。</p>
        )}
        {limits.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  {[
                    "状态", "名称", "Hash", "Preview", "今日 Used / Limit",
                    "% Used", "请求数", "Last Used", "操作",
                  ].map(h => (
                    <th key={h} className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {limits.map(l => (
                  <tr key={l.key_hash} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
                    <td className="px-2 py-2"><StatusPill status={l.status} /></td>
                    <td className="px-2 py-2 text-[#e2e8f0]">{l.name || <span className="text-[#64748b]">-</span>}</td>
                    <td className="px-2 py-2 font-mono text-[#94a3b8] text-xs" title={l.key_hash}>
                      {l.key_hash.slice(0, 8)}…{l.key_hash.slice(-6)}
                    </td>
                    <td className="px-2 py-2 font-mono text-[#94a3b8] text-xs">{l.key_preview || "-"}</td>
                    <td className="px-2 py-2 text-xs">
                      <span className="text-blue-400">{fmtTokens(l.used_tokens)}</span>
                      <span className="text-[#64748b]"> / </span>
                      <span className="text-[#94a3b8]">{fmtTokens(l.daily_token_limit)}</span>
                    </td>
                    <td className="px-2 py-2 text-xs w-[120px]">
                      <UsageBar pct={l.used_percent} status={l.status} />
                    </td>
                    <td className="px-2 py-2 text-[#94a3b8] text-xs">{l.requests}</td>
                    <td className="px-2 py-2 text-[#64748b] text-xs whitespace-nowrap">
                      {l.last_used_at ? fmtRelative(l.last_used_at) : "-"}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEdit({ open: true, initial: l })}>编辑</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => confirm(`确认删除 ${l.name || l.key_hash.slice(0, 12)} 的限额？`) && deleteMut.mutate(l.key_hash)}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {orphans.length > 0 && (
        <Card>
          <CardTitle>未管理的活跃 Key ({orphans.length})</CardTitle>
          <p className="text-[0.78rem] text-[#94a3b8] mb-3">
            这些 hash 今天有 token 使用但没有配置限额。点「添加限额」可以快速为某个 hash 设置上限。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  {["Hash", "今日 Tokens", "请求数", "Last Used", "操作"].map(h => (
                    <th key={h} className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orphans.map(o => (
                  <tr key={o.key_hash} className="border-t border-[#2d3148] hover:bg-[#6c63ff]/5">
                    <td className="px-2 py-2 font-mono text-[#94a3b8] text-xs" title={o.key_hash}>
                      {o.key_hash.slice(0, 8)}…{o.key_hash.slice(-6)}
                    </td>
                    <td className="px-2 py-2 text-blue-400 text-xs">{fmtTokens(o.used_tokens)}</td>
                    <td className="px-2 py-2 text-[#94a3b8] text-xs">{o.requests}</td>
                    <td className="px-2 py-2 text-[#64748b] text-xs whitespace-nowrap">
                      {o.last_used_at ? fmtRelative(o.last_used_at) : "-"}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      <Button variant="primary" size="sm" onClick={() => setEdit({ open: true, hashFromOrphan: o.key_hash })}>
                        + 添加限额
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {edit.open && (
        <EditDialog
          state={edit}
          onClose={() => setEdit({ open: false })}
          onSubmit={(body) => upsertMut.mutate(body)}
          submitting={upsertMut.isPending}
        />
      )}
    </div>
  )
}

function StatusPill({ status }: { status: APIKeyLimitWithUsage["status"] }) {
  const map = {
    ok:       { label: "✅ OK",        className: "bg-green-500/15 text-green-400 border-green-500/30" },
    warn:     { label: "⚠ Warn",       className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
    exceeded: { label: "❌ Exceeded",  className: "bg-red-500/15 text-red-400 border-red-500/30" },
    disabled: { label: "🚫 Disabled",  className: "bg-[#2d3148] text-[#64748b] border-[#2d3148]" },
    unused:   { label: "💤 Unused",    className: "bg-[#11131a] text-[#94a3b8] border-[#2d3148]" },
  }[status]
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-[0.72rem] ${map.className}`}>
      {map.label}
    </span>
  )
}

function UsageBar({ pct, status }: { pct: number; status: APIKeyLimitWithUsage["status"] }) {
  const clamped = Math.min(100, Math.max(0, pct))
  const color = status === "exceeded" ? "bg-red-500"
    : status === "warn" ? "bg-yellow-500"
    : status === "disabled" ? "bg-[#64748b]"
    : "bg-[#6c63ff]"
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded bg-[#0f1117] overflow-hidden">
        <div className={`h-full rounded transition-all ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-[#e2e8f0] tabular-nums w-10 text-right">{pct}%</span>
    </div>
  )
}

interface EditFormBody {
  id?: string
  key_hash?: string
  key?: string
  name?: string
  note?: string
  daily_token_limit: number
  enabled?: boolean
}

function EditDialog({
  state, onClose, onSubmit, submitting,
}: {
  state: EditState
  onClose: () => void
  onSubmit: (body: EditFormBody) => void
  submitting: boolean
}) {
  const isEdit = !!state.initial
  const [name, setName] = useState(state.initial?.name ?? "")
  const [hash, setHash] = useState(state.initial?.key_hash ?? state.hashFromOrphan ?? "")
  const [rawKey, setRawKey] = useState("")
  const [limit, setLimit] = useState(state.initial?.daily_token_limit ?? 1_000_000)
  const [enabled, setEnabled] = useState(state.initial?.enabled ?? true)
  const [note, setNote] = useState(state.initial?.note ?? "")
  const [error, setError] = useState("")

  const submit = () => {
    if (!hash && !rawKey.trim()) {
      setError("必须填写 Hash 或原始 Key 之一")
      return
    }
    if (limit < 0) {
      setError("限额不能为负")
      return
    }
    setError("")
    const body: EditFormBody = {
      name: name.trim(),
      note: note.trim(),
      daily_token_limit: Number(limit),
      enabled,
    }
    if (isEdit) body.id = state.initial!.id
    if (hash) body.key_hash = hash
    if (rawKey.trim() && !hash) body.key = rawKey.trim()
    onSubmit(body)
  }

  return (
    <div className="fixed inset-0 bg-black/55 z-[1000] flex items-center justify-center" style={{ backdropFilter: "blur(2px)" }}>
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-6 min-w-[420px] max-w-[560px] w-[92vw] shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-base">{isEdit ? "编辑 API Key 限额" : "新增 API Key 限额"}</h3>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 text-[0.85rem]">
          <FieldLabel label="名称（可选）">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="例如 harvey-personal" />
          </FieldLabel>

          {!isEdit && !state.hashFromOrphan && (
            <>
              <FieldLabel label="原始 API Key（推荐）">
                <Input value={rawKey} onChange={e => setRawKey(e.target.value)} placeholder="sk-..." />
                <p className="text-[0.7rem] text-[#64748b] mt-1">服务器会计算 SHA256 hash，原始 key 不会被存储。</p>
              </FieldLabel>
              <FieldLabel label="或 Key Hash">
                <Input value={hash} onChange={e => setHash(e.target.value)} placeholder="64 位十六进制 hash" disabled={!!rawKey} />
              </FieldLabel>
            </>
          )}

          {(isEdit || state.hashFromOrphan) && hash && (
            <FieldLabel label="Key Hash">
              <Input value={hash} onChange={() => {}} disabled />
            </FieldLabel>
          )}

          <FieldLabel label="每日 Token 限额">
            <Input type="number" value={String(limit)} onChange={e => setLimit(Number(e.target.value))} placeholder="例如 1000000" />
            <div className="flex gap-2 mt-2 text-[0.72rem]">
              {[100_000, 500_000, 1_000_000, 5_000_000, 10_000_000].map(n => (
                <button
                  key={n}
                  onClick={() => setLimit(n)}
                  className={`px-2 py-0.5 rounded border ${limit === n ? "border-[#6c63ff] bg-[#6c63ff]/15 text-[#6c63ff]" : "border-[#2d3148] text-[#94a3b8] hover:border-[#6c63ff]"}`}
                >
                  {fmtTokens(n)}
                </button>
              ))}
            </div>
          </FieldLabel>

          <FieldLabel label="备注（可选）">
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="例如 内部团队用" />
          </FieldLabel>

          <label className="flex items-center gap-2 cursor-pointer text-[#94a3b8]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="accent-[#6c63ff]"
            />
            启用此限额（关闭后视为不计入告警）
          </label>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-2 text-[0.82rem]">{error}</div>
          )}
        </div>

        <div className="flex gap-2 justify-end mt-4">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[0.78rem] text-[#94a3b8] block mb-1">{label}</span>
      {children}
    </label>
  )
}
