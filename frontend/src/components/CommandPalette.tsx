import { useEffect, useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient, useQuery } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import {
  refreshAllTokens, qkeys,
  fetchAccountHealth, fetchAPIKeyInsights, fetchIssues,
} from "@/api/queries"
import { useToast } from "@/components/ui/Toast"
import {
  Search, LayoutDashboard, FileKey2, Zap, BarChart3, History,
  CircleAlert, Bell, LineChart, KeyRound, BriefcaseBusiness,
  ScrollText, Copy, Settings, RefreshCw, RotateCw, MessageSquareCode, Monitor,
  Boxes, Wrench, HeartPulse, Wand2, Shield, Receipt,
  Gauge, Compass, Sparkles, Archive, Stethoscope, DollarSign,
  User, Hash, AlertCircle,
  type LucideIcon,
} from "lucide-react"

interface CommandItem {
  id: string
  label: string
  hint?: string
  category: "导航" | "操作" | "账号" | "API Key" | "问题"
  icon: LucideIcon
  action: () => void | Promise<void>
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { config, connected } = useConnection()

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === "Escape" && open) setOpen(false)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open])

  // Reset state when reopening
  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const close = () => setOpen(false)

  // Live data sources (only when palette is open and a search query exists, to
  // avoid hammering the server on every keystroke when the user is just
  // navigating).
  const filter = query.trim().toLowerCase()
  const enableLiveSearch = open && connected && filter.length >= 2

  const accountHealth = useQuery({
    queryKey: qkeys.accountHealth(config),
    queryFn: () => fetchAccountHealth(config),
    enabled: enableLiveSearch,
    staleTime: 60_000,
  })
  const keyInsights = useQuery({
    queryKey: ["api-key-insights", config.url, config.key],
    queryFn: () => fetchAPIKeyInsights(config),
    enabled: enableLiveSearch,
    staleTime: 60_000,
  })
  const issues = useQuery({
    queryKey: qkeys.issues(config),
    queryFn: () => fetchIssues(config),
    enabled: enableLiveSearch,
    staleTime: 60_000,
  })

  const liveItems: CommandItem[] = []
  if (enableLiveSearch) {
    accountHealth.data?.items
      .filter(it => it.name.toLowerCase().includes(filter)
        || (it.email ?? "").toLowerCase().includes(filter)
        || (it.group ?? "").toLowerCase().includes(filter))
      .slice(0, 8)
      .forEach(it => liveItems.push({
        id: "acct-" + it.name,
        label: it.name,
        hint: `${it.level}${it.email ? " · " + it.email : ""}`,
        category: "账号",
        icon: User,
        action: () => navigate(`/accounts/${encodeURIComponent(it.name)}`),
      }))

    keyInsights.data?.items
      .filter(it => (it.preview ?? "").toLowerCase().includes(filter)
        || (it.name ?? "").toLowerCase().includes(filter)
        || it.hash.toLowerCase().includes(filter))
      .slice(0, 5)
      .forEach(it => liveItems.push({
        id: "key-" + it.hash,
        label: it.preview ?? it.name ?? it.hash,
        hint: it.status,
        category: "API Key",
        icon: Hash,
        action: () => navigate("/api-key-insights"),
      }))

    issues.data?.items
      .filter(it => it.title.toLowerCase().includes(filter)
        || (it.detail ?? "").toLowerCase().includes(filter)
        || (it.auth_name ?? "").toLowerCase().includes(filter))
      .slice(0, 5)
      .forEach(it => liveItems.push({
        id: "issue-" + it.id,
        label: it.title,
        hint: it.auth_name ?? it.severity,
        category: "问题",
        icon: AlertCircle,
        action: () => navigate("/issues"),
      }))
  }

  const items: CommandItem[] = [
    { id: "go-/",           label: "前往 仪表盘",     category: "导航", icon: LayoutDashboard,    action: () => navigate("/") },
    { id: "go-/accounts",   label: "前往 授权文件",   category: "导航", icon: FileKey2,            action: () => navigate("/accounts") },
    { id: "go-/quota",      label: "前往 Codex 配额", category: "导航", icon: Zap,                 action: () => navigate("/quota") },
    { id: "go-/models",     label: "前往 模型池",     category: "导航", icon: Boxes,               action: () => navigate("/models") },
    { id: "go-/system",     label: "前往 系统/更新",  category: "导航", icon: Wrench,              action: () => navigate("/system") },
    { id: "go-/system-diagnostics", label: "前往 系统诊断", category: "导航", icon: Stethoscope,    action: () => navigate("/system-diagnostics") },
    { id: "go-/backups",    label: "前往 备份与恢复",  category: "导航", icon: Archive,             action: () => navigate("/backups") },
    { id: "go-/tokens",     label: "前往 Token 统计", category: "导航", icon: BarChart3,           action: () => navigate("/tokens") },
    { id: "go-/token-reports", label: "前往 Token 报表", category: "导航", icon: Receipt,          action: () => navigate("/token-reports") },
    { id: "go-/pricing",    label: "前往 定价表",      category: "导航", icon: DollarSign,        action: () => navigate("/pricing") },
    { id: "go-/api-key-insights", label: "前往 API Key 画像", category: "导航", icon: Sparkles,    action: () => navigate("/api-key-insights") },
    { id: "go-/routing-lab", label: "前往 路由实验台",   category: "导航", icon: Compass,         action: () => navigate("/routing-lab") },
    { id: "go-/capacity-forecast", label: "前往 容量预测", category: "导航", icon: Gauge,         action: () => navigate("/capacity-forecast") },
    { id: "go-/history",    label: "前往 请求历史",   category: "导航", icon: History,             action: () => navigate("/history") },
    { id: "go-/account-health", label: "前往 账号健康", category: "导航", icon: HeartPulse,          action: () => navigate("/account-health") },
    { id: "go-/maintenance-rules", label: "前往 维护规则", category: "导航", icon: Wand2,            action: () => navigate("/maintenance-rules") },
    { id: "go-/audit-log",  label: "前往 审计日志",   category: "导航", icon: Shield,              action: () => navigate("/audit-log") },
    { id: "go-/issues",     label: "前往 问题中心",   category: "导航", icon: CircleAlert,         action: () => navigate("/issues") },
    { id: "go-/alerts",     label: "前往 告警",       category: "导航", icon: Bell,                action: () => navigate("/alerts") },
    { id: "go-/analytics",  label: "前往 分析",       category: "导航", icon: LineChart,           action: () => navigate("/analytics") },
    { id: "go-/api-keys",   label: "前往 API Keys",   category: "导航", icon: KeyRound,            action: () => navigate("/api-keys") },
    { id: "go-/jobs",       label: "前往 任务",       category: "导航", icon: BriefcaseBusiness,   action: () => navigate("/jobs") },
    { id: "go-/oauth",      label: "前往 OAuth 登录", category: "导航", icon: MessageSquareCode,   action: () => navigate("/oauth") },
    { id: "go-/logs",       label: "前往 日志",       category: "导航", icon: ScrollText,          action: () => navigate("/logs") },
    { id: "go-/duplicates", label: "前往 重复检测",   category: "导航", icon: Copy,                action: () => navigate("/duplicates") },
    { id: "go-/desktop",    label: "前往 桌面/回退",  category: "导航", icon: Monitor,             action: () => navigate("/desktop") },
    { id: "go-/settings",   label: "前往 设置",       category: "导航", icon: Settings,            action: () => navigate("/settings") },

    {
      id: "act-refresh-all", label: "刷新全部 Token", hint: connected ? "" : "需要先连接", category: "操作", icon: RefreshCw,
      action: async () => {
        if (!connected) return
        try {
          const r = await refreshAllTokens(config)
          toast.success(`已触发刷新 ${r.queued} 个凭证`)
          qc.invalidateQueries({ queryKey: qkeys.snapshot(config) })
        } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
      },
    },
    {
      id: "act-invalidate", label: "强制刷新所有数据", category: "操作", icon: RotateCw,
      action: () => { qc.invalidateQueries(); toast.info("已刷新所有缓存") },
    },
  ]

  const filtered = filter
    ? [
        ...liveItems,
        ...items.filter(i => i.label.toLowerCase().includes(filter) || (i.hint?.toLowerCase().includes(filter))),
      ]
    : items

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIdx(i => Math.max(0, i - 1))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const item = filtered[activeIdx]
        if (item) {
          void item.action()
          close()
        }
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, activeIdx, filtered])

  if (!open) return null

  let lastCategory = ""
  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/55 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
      onClick={close}
    >
      <div
        className="bg-[#1a1d27] border border-[#2d3148] rounded-xl shadow-2xl w-[92vw] max-w-[600px] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[#2d3148] px-4 py-3">
          <Search size={16} className="text-[#64748b]" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            placeholder="搜索命令或页面…"
            className="flex-1 bg-transparent outline-none text-sm text-[#e2e8f0] placeholder:text-[#64748b]"
          />
          <span className="text-[0.7rem] text-[#64748b]">ESC 退出</span>
        </div>
        <div className="max-h-[55vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-[#64748b] text-sm">无匹配项</div>
          )}
          {filtered.map((item, i) => {
            const showHeader = item.category !== lastCategory
            lastCategory = item.category
            const Icon = item.icon
            const active = i === activeIdx
            return (
              <div key={item.id}>
                {showHeader && (
                  <div className="px-4 py-1.5 text-[0.68rem] font-bold uppercase text-[#64748b] mt-1">
                    {item.category}
                  </div>
                )}
                <button
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => { void item.action(); close() }}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                    active ? "bg-[#6c63ff]/20 text-[#e2e8f0]" : "text-[#94a3b8] hover:bg-[#22263a]"
                  }`}
                >
                  <Icon size={14} className={active ? "text-[#6c63ff]" : "text-[#64748b]"} />
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <span className="text-[0.7rem] text-[#64748b]">{item.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="border-t border-[#2d3148] px-4 py-2 text-[0.68rem] text-[#64748b] flex items-center justify-between">
          <span>↑↓ 选择 · Enter 确认</span>
          <span>Cmd/Ctrl + K 唤出</span>
        </div>
      </div>
    </div>
  )
}
