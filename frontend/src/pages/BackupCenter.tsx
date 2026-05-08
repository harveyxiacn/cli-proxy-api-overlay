import { useState } from "react"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import {
  fetchBackups, createBackup, previewRestore, restoreBackup, removeBackup,
} from "@/api/queries"
import { useConnection } from "@/stores/connection"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Alert } from "@/components/ui/Alert"
import { Button } from "@/components/ui/Button"
import { useToast } from "@/components/ui/Toast"
import type { BackupManifest, BackupPreviewResponse } from "@/api/types"
import { fmtDate } from "@/lib/utils"
import { Plus, Download, Trash2, Eye, RotateCcw } from "lucide-react"

function fmtBytes(n: number): string {
  if (n < 1024) return n + " B"
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB"
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB"
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB"
}

export function BackupCenter() {
  const { config, connected } = useConnection()
  const qc = useQueryClient()
  const toast = useToast()
  const [preview, setPreview] = useState<{ backupId: string; data: BackupPreviewResponse } | null>(null)

  const list = useQuery({
    queryKey: ["backups", config.url, config.key],
    queryFn: () => fetchBackups(config),
    enabled: connected,
  })

  const create = useMutation({
    mutationFn: () => createBackup(config),
    onSuccess: () => {
      toast.success("已创建备份")
      qc.invalidateQueries({ queryKey: ["backups", config.url, config.key] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => removeBackup(config, id),
    onSuccess: () => {
      toast.success("已删除")
      qc.invalidateQueries({ queryKey: ["backups", config.url, config.key] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const previewMut = useMutation({
    mutationFn: (id: string) => previewRestore(config, id),
    onSuccess: (data, id) => setPreview({ backupId: id, data }),
    onError: (e: Error) => toast.error(e.message),
  })

  const restoreMut = useMutation({
    mutationFn: (args: { id: string; previewID: string }) => restoreBackup(config, args.id, args.previewID),
    onSuccess: r => {
      toast.success(`已恢复 ${r.succeeded} 个文件，失败 ${r.failed}（pre-restore=${r.pre_restore_id}）`)
      setPreview(null)
      qc.invalidateQueries({ queryKey: ["backups", config.url, config.key] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!connected) return <Alert type="info">请先连接管理 API。</Alert>

  return (
    <div>
      <Card>
        <CardTitle>
          <span>备份与恢复</span>
          <Button size="sm" variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>
            <Plus size={12} /> 创建备份
          </Button>
        </CardTitle>
        <Alert type="info">
          备份包含 config.yaml、auth-dir 全部文件、data 目录的统计/历史/审计文件。
          缺失文件静默跳过。restore 会先创建 pre-restore 安全备份，且需要带未过期的 preview_id。
        </Alert>

        {list.isLoading && <div className="text-sm text-[#94a3b8]">加载中…</div>}
        {(list.data?.items.length ?? 0) === 0 && !list.isLoading && (
          <Alert type="success">暂无备份。点击右上角"创建备份"开始。</Alert>
        )}
        <div className="space-y-2">
          {list.data?.items.map(b => (
            <BackupRow key={b.id} b={b}
              downloadURL={`${config.url.replace(/\/$/, "")}/v0/management/backups/${encodeURIComponent(b.id)}/download`}
              onPreview={() => previewMut.mutate(b.id)}
              onDelete={() => { if (confirm(`删除备份 ${b.id}？`)) remove.mutate(b.id) }}
            />
          ))}
        </div>
      </Card>

      {preview && (
        <Card>
          <CardTitle>
            <span>恢复预览：{preview.backupId}</span>
            <span className="text-xs text-[#64748b]">
              preview_id 过期于 {fmtDate(preview.data.expires_at)}
            </span>
          </CardTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs mb-3">
            <PreviewSection title="将创建" items={preview.data.will_create} color="green" />
            <PreviewSection title="将覆盖" items={preview.data.will_update} color="yellow" />
            <PreviewSection title="冲突" items={preview.data.conflicts} color="red" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>取消</Button>
            <Button size="sm" variant="warn" disabled={restoreMut.isPending}
              onClick={() => {
                if (confirm(`即将覆盖 ${preview.data.will_update.length} 个文件，新增 ${preview.data.will_create.length} 个。继续？`)) {
                  restoreMut.mutate({ id: preview.backupId, previewID: preview.data.preview_id })
                }
              }}>
              <RotateCcw size={12} /> 确认恢复
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

function BackupRow({ b, downloadURL, onPreview, onDelete }: {
  b: BackupManifest; downloadURL: string; onPreview: () => void; onDelete: () => void
}) {
  return (
    <div className="border border-[#2d3148] rounded-lg p-3 bg-[#11131a] flex items-start gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-sm">{b.id}</span>
          <Badge variant={b.source === "manual" ? "blue" : "default"}>{b.source}</Badge>
          <span className="text-xs text-[#64748b]">{fmtDate(b.created_at)}</span>
          <span className="text-xs text-[#64748b]">{fmtBytes(b.size_bytes)}</span>
        </div>
        <div className="text-[0.7rem] text-[#94a3b8]">
          {b.files.length} 文件{b.skipped && b.skipped.length > 0 && `（跳过 ${b.skipped.length}）`}
        </div>
        {b.note && <div className="text-[0.7rem] text-[#94a3b8] mt-1">{b.note}</div>}
      </div>
      <a href={downloadURL} target="_blank" rel="noreferrer"
         className="text-xs text-[#6c63ff] hover:underline flex items-center gap-1">
        <Download size={12} /> 下载
      </a>
      <Button size="sm" variant="ghost" onClick={onPreview}><Eye size={12} /> 预览</Button>
      <Button size="sm" variant="danger" onClick={onDelete}><Trash2 size={12} /></Button>
    </div>
  )
}

function PreviewSection({ title, items, color }: { title: string; items: string[]; color: "green" | "yellow" | "red" }) {
  return (
    <div className="bg-[#22263a] rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold">{title}</span>
        <Badge variant={color}>{items.length}</Badge>
      </div>
      <div className="max-h-32 overflow-auto text-[0.65rem] text-[#94a3b8] font-mono">
        {items.length === 0 ? <span className="text-[#64748b]">—</span>
          : items.map(p => <div key={p}>{p}</div>)}
      </div>
    </div>
  )
}
