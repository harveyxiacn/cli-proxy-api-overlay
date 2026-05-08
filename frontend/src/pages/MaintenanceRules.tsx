import { useState } from "react"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import {
  fetchMaintenanceRules, upsertMaintenanceRule, deleteMaintenanceRule,
  dryRunMaintenanceRules, applyMaintenanceRules, qkeys,
} from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { Button } from "@/components/ui/Button"
import { useToast } from "@/components/ui/Toast"
import type {
  MaintenanceRule, MaintenanceCondition, MaintenanceDryRunResponse,
  MaintenanceDryRunActionItem,
} from "@/api/types"
import { Plus, Trash2, Play, CheckCircle2, AlertTriangle } from "lucide-react"

const FIELD_OPTIONS = [
  "level", "score", "needs_relogin", "unavailable", "disabled",
  "failure_rate_24h", "requests_24h",
  "quota_primary_remaining", "quota_secondary_remaining",
  "last_success_age_hours", "provider", "group", "tag",
]
const OP_OPTIONS = ["==", "!=", ">=", "<=", ">", "<", "in", "notin", "contains"]
const ACTION_OPTIONS = [
  { type: "select",        label: "select (仅候选)" },
  { type: "warmup",        label: "warmup" },
  { type: "disable",       label: "disable" },
  { type: "enable",        label: "enable" },
  { type: "move_group",    label: "move_group" },
  { type: "add_tag",       label: "add_tag" },
  { type: "lower_priority",label: "lower_priority" },
  { type: "relogin",       label: "relogin" },
  { type: "delete",        label: "delete (v1 不执行)" },
]

const riskColor = {
  none: "default",
  low: "blue",
  medium: "yellow",
  high: "red",
} as const

function emptyRule(): MaintenanceRule {
  return {
    id: "rule-" + Math.random().toString(36).slice(2, 8),
    name: "新规则",
    enabled: true,
    mode: "dry_run",
    conditions: [{ field: "failure_rate_24h", op: ">=", value: 0.6 }],
    action: { type: "disable" },
    scope: {},
  }
}

export function MaintenanceRules() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<MaintenanceRule | null>(null)
  const [dryRun, setDryRun] = useState<MaintenanceDryRunResponse | null>(null)
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set())

  const list = useQuery({
    queryKey: qkeys.maintenanceRules(config),
    queryFn: () => fetchMaintenanceRules(config),
    enabled: connected,
  })

  const upsert = useMutation({
    mutationFn: (rule: MaintenanceRule) => upsertMaintenanceRule(config, rule),
    onSuccess: () => {
      toast.success("已保存规则")
      setEditing(null)
      qc.invalidateQueries({ queryKey: qkeys.maintenanceRules(config) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteMaintenanceRule(config, id),
    onSuccess: () => {
      toast.success("已删除规则")
      qc.invalidateQueries({ queryKey: qkeys.maintenanceRules(config) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const dryRunMut = useMutation({
    mutationFn: () => dryRunMaintenanceRules(config),
    onSuccess: r => {
      setDryRun(r)
      setSelectedActions(new Set(r.actions.map(a => a.id)))
      toast.info(`已匹配 ${r.matched_accounts} 个账号 / ${r.actions.length} 个动作`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const applyMut = useMutation({
    mutationFn: (body: { dry_run_token: string; action_ids: string[]; confirmed: boolean }) =>
      applyMaintenanceRules(config, body),
    onSuccess: r => {
      toast.success(`apply 完成：成功 ${r.succeeded} / 失败 ${r.failed} / 跳过 ${r.skipped}`)
      qc.invalidateQueries({ queryKey: qkeys.accountHealth(config) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          <span>维护规则（dry-run + 手动 apply）</span>
          <Button size="sm" variant="primary" onClick={() => setEditing(emptyRule())}>
            <Plus size={12} /> 新增规则
          </Button>
        </CardTitle>
        <Alert type="info">
          v1 仅 dry-run + 用户显式 apply，不会自动定时执行。disable / move_group / add_tag 等动作通过现有 batch endpoint 执行；delete 永远不自动执行。
        </Alert>
        {list.isLoading && <div className="text-sm text-[#94a3b8]">加载中…</div>}
        {(list.data?.items.length ?? 0) === 0 && !list.isLoading && (
          <div className="text-sm text-[#94a3b8]">尚无规则。点击"新增规则"开始。</div>
        )}
        <div className="space-y-2">
          {list.data?.items.map(rule => (
            <RuleRow key={rule.id} rule={rule}
                     onEdit={() => setEditing(rule)}
                     onDelete={() => {
                       if (confirm(`删除规则 ${rule.id}？`)) remove.mutate(rule.id)
                     }} />
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>
          <span>Dry-run / Apply</span>
          <Button size="sm" variant="primary" onClick={() => dryRunMut.mutate()} disabled={dryRunMut.isPending}>
            <Play size={12} /> 运行 dry-run
          </Button>
        </CardTitle>
        {!dryRun && <Alert type="info">点击"运行 dry-run"查看哪些账号会被匹配。</Alert>}
        {dryRun && (
          <>
            <div className="text-xs text-[#94a3b8] mb-2">
              token：<code className="text-[#e2e8f0]">{dryRun.dry_run_token}</code>
              （TTL 10 分钟，过期需重新 dry-run）·
              规则 {dryRun.rules} · 命中 {dryRun.matched_accounts} 个账号 / {dryRun.actions.length} 个动作
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[#94a3b8] border-b border-[#2d3148]">
                  <tr>
                    <th className="py-2 pr-2"><input type="checkbox"
                          checked={selectedActions.size === dryRun.actions.length && dryRun.actions.length > 0}
                          onChange={e => setSelectedActions(e.target.checked
                            ? new Set(dryRun.actions.map(a => a.id))
                            : new Set())}/></th>
                    <th className="py-2 pr-2">target</th>
                    <th className="py-2 pr-2">action</th>
                    <th className="py-2 pr-2">risk</th>
                    <th className="py-2 pr-2">would_change</th>
                    <th className="py-2 pr-2">reason</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRun.actions.map(a => (
                    <ActionRow key={a.id} a={a}
                      checked={selectedActions.has(a.id)}
                      onToggle={c => {
                        const s = new Set(selectedActions)
                        if (c) s.add(a.id); else s.delete(a.id)
                        setSelectedActions(s)
                      }} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[#94a3b8]">已选 {selectedActions.size} / {dryRun.actions.length}</span>
              <Button size="sm" variant="warn" disabled={selectedActions.size === 0 || applyMut.isPending}
                onClick={() => {
                  const ids = Array.from(selectedActions)
                  const hasHigh = dryRun.actions.some(a => ids.includes(a.id) && a.risk === "high")
                  if (hasHigh && !confirm("所选包含 high-risk 动作。确认 apply？"))
                    return
                  applyMut.mutate({ dry_run_token: dryRun.dry_run_token, action_ids: ids, confirmed: hasHigh })
                }}>
                <CheckCircle2 size={12} /> Apply 所选
              </Button>
            </div>
            {applyMut.data && (
              <div className="mt-3 max-h-40 overflow-auto text-xs bg-[#11131a] rounded p-2">
                {applyMut.data.results.map(r => (
                  <div key={r.id} className="flex items-center gap-2 py-0.5">
                    {r.ok ? <CheckCircle2 size={12} className="text-green-400" />
                          : <AlertTriangle size={12} className="text-red-400" />}
                    <span className="font-mono text-[#94a3b8]">{r.target}</span>
                    <span className="text-[#64748b]">{r.action}</span>
                    {r.message && <span className="text-[#64748b]">— {r.message}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {editing && <RuleEditor rule={editing}
        onSave={r => upsert.mutate(r)}
        onCancel={() => setEditing(null)}
        busy={upsert.isPending} />}
    </div>
  )
}

function RuleRow({ rule, onEdit, onDelete }: { rule: MaintenanceRule; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="border border-[#2d3148] rounded-lg p-3 bg-[#11131a] flex items-start gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm">{rule.name}</span>
          <Badge variant={rule.enabled ? "green" : "default"}>{rule.enabled ? "启用" : "停用"}</Badge>
          <Badge variant="default">{rule.id}</Badge>
        </div>
        <div className="text-xs text-[#94a3b8]">
          IF <code className="text-[#e2e8f0]">
            {rule.conditions.map(c => `${c.field} ${c.op} ${JSON.stringify(c.value)}`).join(" && ") || "(no conditions)"}
          </code> → action: <code className="text-[#e2e8f0]">{rule.action.type}</code>
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit}>编辑</Button>
      <Button size="sm" variant="danger" onClick={onDelete}><Trash2 size={12} /></Button>
    </div>
  )
}

function ActionRow({ a, checked, onToggle }: {
  a: MaintenanceDryRunActionItem; checked: boolean; onToggle: (v: boolean) => void
}) {
  return (
    <tr className="border-b border-[#1f2230]">
      <td className="py-2 pr-2">
        <input type="checkbox" checked={checked} onChange={e => onToggle(e.target.checked)} />
      </td>
      <td className="py-2 pr-2 font-mono">{a.target}</td>
      <td className="py-2 pr-2">{a.action}</td>
      <td className="py-2 pr-2"><Badge variant={riskColor[a.risk]}>{a.risk}</Badge></td>
      <td className="py-2 pr-2">{a.would_change ? "yes" : "no"}</td>
      <td className="py-2 pr-2 text-[#94a3b8]">{a.reason}</td>
    </tr>
  )
}

function RuleEditor({ rule, onSave, onCancel, busy }: {
  rule: MaintenanceRule
  onSave: (r: MaintenanceRule) => void
  onCancel: () => void
  busy?: boolean
}) {
  const [draft, setDraft] = useState<MaintenanceRule>(rule)

  const setCond = (i: number, patch: Partial<MaintenanceCondition>) => {
    const cs = [...draft.conditions]
    cs[i] = { ...cs[i], ...patch }
    setDraft({ ...draft, conditions: cs })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl w-[92vw] max-w-[640px] p-4"
           onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-sm mb-3">编辑规则</h3>
        <div className="space-y-2 text-xs">
          <label className="block">
            <span className="text-[#94a3b8]">ID</span>
            <input className="w-full bg-[#22263a] border border-[#2d3148] rounded px-2 py-1"
                   value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[#94a3b8]">名称</span>
            <input className="w-full bg-[#22263a] border border-[#2d3148] rounded px-2 py-1"
                   value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.enabled}
                   onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
            <span>启用</span>
          </label>

          <div>
            <span className="text-[#94a3b8] block mb-1">条件（AND）</span>
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex gap-1 mb-1">
                <select className="bg-[#22263a] border border-[#2d3148] rounded px-1 py-0.5"
                        value={c.field} onChange={e => setCond(i, { field: e.target.value })}>
                  {FIELD_OPTIONS.map(f => <option key={f}>{f}</option>)}
                </select>
                <select className="bg-[#22263a] border border-[#2d3148] rounded px-1 py-0.5"
                        value={c.op} onChange={e => setCond(i, { op: e.target.value as MaintenanceCondition["op"] })}>
                  {OP_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
                <input className="flex-1 bg-[#22263a] border border-[#2d3148] rounded px-2 py-0.5"
                       value={String(c.value ?? "")}
                       onChange={e => {
                         const v = e.target.value
                         const num = Number(v)
                         setCond(i, { value: !isNaN(num) && v.trim() !== "" ? num : v })
                       }} />
                <Button size="sm" variant="ghost"
                        onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })}>
                  ×
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost"
                    onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: "level", op: "==", value: "warning" }] })}>
              + 增加条件
            </Button>
          </div>

          <label className="block">
            <span className="text-[#94a3b8]">动作</span>
            <select className="w-full bg-[#22263a] border border-[#2d3148] rounded px-2 py-1"
                    value={draft.action.type}
                    onChange={e => setDraft({ ...draft, action: { ...draft.action, type: e.target.value as MaintenanceRule["action"]["type"] } })}>
              {ACTION_OPTIONS.map(a => <option key={a.type} value={a.type}>{a.label}</option>)}
            </select>
          </label>

          {draft.action.type === "move_group" && (
            <label className="block">
              <span className="text-[#94a3b8]">目标 group</span>
              <input className="w-full bg-[#22263a] border border-[#2d3148] rounded px-2 py-1"
                     value={String(draft.action.params?.group ?? "")}
                     onChange={e => setDraft({ ...draft, action: { ...draft.action, params: { ...draft.action.params, group: e.target.value } } })} />
            </label>
          )}
          {draft.action.type === "add_tag" && (
            <label className="block">
              <span className="text-[#94a3b8]">tag</span>
              <input className="w-full bg-[#22263a] border border-[#2d3148] rounded px-2 py-1"
                     value={String(draft.action.params?.tag ?? "")}
                     onChange={e => setDraft({ ...draft, action: { ...draft.action, params: { ...draft.action.params, tag: e.target.value } } })} />
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onSave(draft)}>保存</Button>
        </div>
      </div>
    </div>
  )
}
