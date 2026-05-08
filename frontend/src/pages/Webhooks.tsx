import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import {
  fetchWebhooks, upsertWebhook, deleteWebhook, testWebhook, fetchWebhookDeliveries, qkeys,
} from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Alert } from "@/components/ui/Alert"
import { Badge } from "@/components/ui/Badge"
import { Spinner } from "@/components/ui/Spinner"
import { Input } from "@/components/ui/Input"
import { useToast } from "@/components/ui/Toast"
import { fmtRelative } from "@/lib/utils"
import type { Webhook } from "@/api/types"
import { X } from "lucide-react"

const EVENT_LABELS: Record<string, string> = {
  "alert.api_key_quota_warn": "⚠ API Key 配额 ≥80%",
  "alert.api_key_quota_exceeded": "❌ API Key 配额已耗尽",
  "oauth.batch_created": "🔁 批量 OAuth 重登发起",
  "system_update.completed": "🚀 CPA 系统更新完成",
}

export function Webhooks() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const [edit, setEdit] = useState<{ open: boolean; initial?: Webhook }>({ open: false })
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null)

  const dataQ = useQuery({
    queryKey: qkeys.webhooks(config),
    queryFn: () => fetchWebhooks(config),
    enabled: connected,
    refetchInterval: 30_000,
  })

  const upsertMut = useMutation({
    mutationFn: (body: Parameters<typeof upsertWebhook>[1]) => upsertWebhook(config, body),
    onSuccess: () => {
      toast.success("Webhook 已保存")
      qc.invalidateQueries({ queryKey: qkeys.webhooks(config) })
      setEdit({ open: false })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWebhook(config, id),
    onSuccess: () => {
      toast.success("已删除")
      qc.invalidateQueries({ queryKey: qkeys.webhooks(config) })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const testMut = useMutation({
    mutationFn: (id: string) => testWebhook(config, id),
    onSuccess: (resp) => {
      if (resp.status === "ok") toast.success(`测试成功 (HTTP ${resp.http_code} · ${resp.duration_ms}ms)`)
      else toast.error(resp.error || "测试失败")
      qc.invalidateQueries({ queryKey: qkeys.webhooks(config) })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  const data = dataQ.data
  const hooks = data?.webhooks ?? []
  const known = data?.known_events ?? []

  return (
    <div>
      <Card>
        <CardTitle>
          📢 Webhook 推送
          <Button variant="primary" size="sm" onClick={() => setEdit({ open: true })}>+ 新增 Webhook</Button>
        </CardTitle>
        <Alert type="info" className="text-[0.78rem]">
          {data?.note || "v1 仅支持 Discord webhook。"}
          {" "}支持事件：{known.map(e => EVENT_LABELS[e] || e).join("、") || "（暂无）"}
        </Alert>
      </Card>

      <Card>
        <CardTitle>
          已配置 Webhook ({hooks.length})
          <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: qkeys.webhooks(config) })}>
            🔄 刷新
          </Button>
        </CardTitle>
        {dataQ.isLoading && <div className="flex gap-2 items-center text-sm text-[#94a3b8]"><Spinner /> 加载中…</div>}
        {hooks.length === 0 && !dataQ.isLoading && (
          <p className="text-center text-[#64748b] py-6 text-sm">还没有配置 webhook。</p>
        )}
        {hooks.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {hooks.map(h => (
              <WebhookCard
                key={h.id}
                hook={h}
                onEdit={() => setEdit({ open: true, initial: h })}
                onDelete={() => confirm(`确认删除 ${h.name || h.id}？`) && deleteMut.mutate(h.id)}
                onTest={() => testMut.mutate(h.id)}
                onShowDeliveries={() => setDeliveriesFor(h.id)}
                testing={testMut.isPending && testMut.variables === h.id}
              />
            ))}
          </div>
        )}
      </Card>

      {edit.open && (
        <EditWebhookDialog
          initial={edit.initial}
          knownEvents={known}
          onClose={() => setEdit({ open: false })}
          onSubmit={(body) => upsertMut.mutate(body)}
          submitting={upsertMut.isPending}
        />
      )}

      {deliveriesFor && (
        <DeliveriesDialog
          webhookId={deliveriesFor}
          onClose={() => setDeliveriesFor(null)}
        />
      )}
    </div>
  )
}

function WebhookCard({
  hook, onEdit, onDelete, onTest, onShowDeliveries, testing,
}: {
  hook: Webhook
  onEdit: () => void
  onDelete: () => void
  onTest: () => void
  onShowDeliveries: () => void
  testing: boolean
}) {
  const previewURL = (() => {
    try {
      const u = new URL(hook.url)
      return `${u.host}${u.pathname.slice(0, 30)}…`
    } catch {
      return hook.url.slice(0, 40)
    }
  })()

  return (
    <div className="border border-[#2d3148] rounded-lg p-3 bg-[#11131a] flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-[#e2e8f0] text-sm">{hook.name || "(unnamed)"}</h4>
            {hook.enabled
              ? <Badge variant="green" className="text-[0.7rem]">启用</Badge>
              : <Badge variant="default" className="text-[0.7rem]">已停用</Badge>
            }
            <Badge variant="default" className="text-[0.7rem]">{hook.provider}</Badge>
          </div>
          <p className="font-mono text-[0.7rem] text-[#64748b]">{previewURL}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {hook.events.length === 0 && <span className="text-[0.7rem] text-[#64748b]">未订阅任何事件</span>}
        {hook.events.map(e => (
          <span key={e} className="px-2 py-0.5 rounded bg-[#22263a] text-[0.7rem] text-[#94a3b8]">
            {EVENT_LABELS[e] || e}
          </span>
        ))}
      </div>

      {hook.last_error && (
        <p className="text-[0.7rem] text-red-400" title={hook.last_error}>
          ⚠ 最近错误：{hook.last_error.slice(0, 60)}
        </p>
      )}
      {hook.last_sent_at && (
        <p className="text-[0.7rem] text-[#64748b]">最近投递：{fmtRelative(hook.last_sent_at)}</p>
      )}

      <div className="flex gap-1 flex-wrap">
        <Button variant="primary" size="sm" onClick={onTest} disabled={testing}>
          {testing ? <><Spinner size={10} /> 测试中</> : "🚀 测试"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onShowDeliveries}>📋 投递记录</Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>编辑</Button>
        <Button variant="danger" size="sm" onClick={onDelete}>删除</Button>
      </div>
    </div>
  )
}

interface EditFormBody {
  id?: string
  name: string
  url: string
  events: string[]
  enabled: boolean
  provider: string
}

function EditWebhookDialog({
  initial, knownEvents, onClose, onSubmit, submitting,
}: {
  initial?: Webhook
  knownEvents: string[]
  onClose: () => void
  onSubmit: (body: EditFormBody) => void
  submitting: boolean
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [url, setUrl] = useState(initial?.url ?? "")
  const [events, setEvents] = useState<string[]>(initial?.events ?? knownEvents)
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [error, setError] = useState("")

  const toggleEvent = (e: string) => {
    setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])
  }

  const submit = () => {
    if (!url.trim().startsWith("https://discord")) {
      setError("URL 必须是 Discord webhook (https://discord.com/api/webhooks/...)")
      return
    }
    setError("")
    onSubmit({
      id: initial?.id,
      name: name.trim(),
      url: url.trim(),
      events,
      enabled,
      provider: "discord",
    })
  }

  return (
    <div className="fixed inset-0 bg-black/55 z-[1000] flex items-center justify-center" style={{ backdropFilter: "blur(2px)" }}>
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-6 min-w-[480px] max-w-[640px] w-[92vw] max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-base">{initial ? "编辑 Webhook" : "新增 Webhook"}</h3>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0]"><X size={16} /></button>
        </div>

        <div className="space-y-3 text-[0.85rem]">
          <FieldLabel label="名称">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="例如 #cpa-alerts" />
          </FieldLabel>

          <FieldLabel label="Discord Webhook URL">
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/123456/abcdef..." />
            <p className="text-[0.7rem] text-[#64748b] mt-1">
              Discord 服务器 → 频道设置 → 集成 → Webhook → 复制 URL。
            </p>
          </FieldLabel>

          <FieldLabel label="订阅事件">
            <div className="space-y-1.5 mt-1">
              {knownEvents.length === 0 && <p className="text-[0.78rem] text-[#64748b]">暂无可订阅事件</p>}
              {knownEvents.map(e => (
                <label key={e} className="flex items-center gap-2 cursor-pointer text-[#94a3b8] text-[0.82rem]">
                  <input
                    type="checkbox"
                    checked={events.includes(e)}
                    onChange={() => toggleEvent(e)}
                    className="accent-[#6c63ff]"
                  />
                  <span>{EVENT_LABELS[e] || e}</span>
                  <span className="text-[0.7rem] text-[#64748b] font-mono">({e})</span>
                </label>
              ))}
            </div>
          </FieldLabel>

          <label className="flex items-center gap-2 cursor-pointer text-[#94a3b8]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="accent-[#6c63ff]"
            />
            启用此 Webhook
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

function DeliveriesDialog({ webhookId, onClose }: { webhookId: string; onClose: () => void }) {
  const { config } = useConnection()
  const dataQ = useQuery({
    queryKey: qkeys.webhookDeliveries(config, webhookId),
    queryFn: () => fetchWebhookDeliveries(config, webhookId),
    refetchInterval: 5_000,
  })

  return (
    <div className="fixed inset-0 bg-black/55 z-[1000] flex items-center justify-center" style={{ backdropFilter: "blur(2px)" }}>
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-6 min-w-[520px] max-w-[760px] w-[92vw] max-h-[88vh] overflow-y-auto shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-base">📋 投递记录（最近 50 条）</h3>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0]"><X size={16} /></button>
        </div>
        {dataQ.isLoading && <div className="flex gap-2 items-center text-sm text-[#94a3b8]"><Spinner /> 加载中…</div>}
        {dataQ.data && dataQ.data.deliveries.length === 0 && (
          <p className="text-center text-[#64748b] py-6 text-sm">还没有投递记录。</p>
        )}
        {dataQ.data && dataQ.data.deliveries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.78rem] border-collapse">
              <thead>
                <tr className="bg-[#22263a]">
                  {["状态", "事件", "HTTP", "耗时", "时间", "错误"].map(h => (
                    <th key={h} className="text-left px-2 py-2 text-[#64748b] font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataQ.data.deliveries.map(d => (
                  <tr key={d.id} className="border-t border-[#2d3148]">
                    <td className="px-2 py-1.5">
                      {d.status === "ok" && <Badge variant="green" className="text-[0.7rem]">✅ ok</Badge>}
                      {d.status === "error" && <Badge variant="red" className="text-[0.7rem]">❌ error</Badge>}
                      {d.status === "skipped" && <Badge variant="default" className="text-[0.7rem]">⏭ skip</Badge>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[#94a3b8] text-xs">{d.event}</td>
                    <td className="px-2 py-1.5 text-[#94a3b8]">{d.http_code || "-"}</td>
                    <td className="px-2 py-1.5 text-[#94a3b8]">{d.duration_ms}ms</td>
                    <td className="px-2 py-1.5 text-[#64748b] whitespace-nowrap">{fmtRelative(d.started_at)}</td>
                    <td className="px-2 py-1.5 text-red-400 text-xs max-w-[200px] truncate" title={d.error}>
                      {d.error || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
