import { useState, useEffect } from "react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard, FileKey2, Zap, BarChart3, History,
  MessageSquareCode, ScrollText, Copy, Settings, CircleAlert,
  Bell, LineChart, KeyRound, BriefcaseBusiness, Monitor, Boxes, Wrench, Webhook,
  HeartPulse, Wand2, Shield, Receipt,
  Gauge, Compass, Sparkles,
  Archive, Stethoscope, DollarSign, ChevronDown, Radio,
} from "lucide-react"

type NavItem = { to: string; icon: React.ElementType; label: string; end?: boolean }

interface NavGroup {
  id: string
  label: string
  items: NavItem[]
  defaultOpen?: boolean
}

const navGroups: NavGroup[] = [
  {
    id: "core",
    label: "核心运维",
    defaultOpen: true,
    items: [
      { to: "/",           icon: LayoutDashboard, label: "仪表盘",    end: true },
      { to: "/accounts",   icon: FileKey2,         label: "授权文件" },
      { to: "/quota",      icon: Zap,              label: "Codex 配额" },
      { to: "/models",     icon: Boxes,            label: "模型池" },
      { to: "/account-health", icon: HeartPulse,   label: "账号健康" },
    ],
  },
  {
    id: "token",
    label: "Token & 费用",
    defaultOpen: true,
    items: [
      { to: "/tokens",        icon: BarChart3,    label: "Token 统计" },
      { to: "/token-reports", icon: Receipt,      label: "Token 报表" },
      { to: "/pricing",       icon: DollarSign,   label: "定价表" },
    ],
  },
  {
    id: "requests",
    label: "请求分析",
    defaultOpen: true,
    items: [
      { to: "/history",       icon: History,      label: "请求历史" },
      { to: "/realtime",      icon: Radio,        label: "实时监控" },
      { to: "/analytics",     icon: LineChart,    label: "分析" },
      { to: "/routing-lab",   icon: Compass,      label: "路由实验台" },
    ],
  },
  {
    id: "ops",
    label: "运维管理",
    defaultOpen: false,
    items: [
      { to: "/maintenance-rules", icon: Wand2,       label: "维护规则" },
      { to: "/audit-log",         icon: Shield,      label: "审计日志" },
      { to: "/backups",           icon: Archive,     label: "备份与恢复" },
      { to: "/system",            icon: Wrench,      label: "系统/更新" },
      { to: "/system-diagnostics",icon: Stethoscope, label: "系统诊断" },
    ],
  },
  {
    id: "alerts",
    label: "告警 & 推送",
    defaultOpen: false,
    items: [
      { to: "/issues",    icon: CircleAlert, label: "问题中心" },
      { to: "/alerts",    icon: Bell,        label: "告警" },
      { to: "/webhooks",  icon: Webhook,     label: "Webhook 推送" },
    ],
  },
  {
    id: "apikeys",
    label: "API Keys",
    defaultOpen: false,
    items: [
      { to: "/api-keys",         icon: KeyRound,  label: "API Keys" },
      { to: "/api-key-limits",   icon: KeyRound,  label: "Key 限额" },
      { to: "/api-key-insights", icon: Sparkles,  label: "Key 画像" },
    ],
  },
  {
    id: "tools",
    label: "工具",
    defaultOpen: false,
    items: [
      { to: "/capacity-forecast", icon: Gauge,           label: "容量预测" },
      { to: "/oauth",             icon: MessageSquareCode,label: "OAuth 登录" },
      { to: "/jobs",              icon: BriefcaseBusiness,label: "任务" },
      { to: "/logs",              icon: ScrollText,       label: "日志" },
      { to: "/duplicates",        icon: Copy,             label: "重复检测" },
      { to: "/desktop",           icon: Monitor,          label: "桌面/回退" },
      { to: "/settings",          icon: Settings,         label: "设置" },
    ],
  },
]

const STORAGE_KEY = "sidebar-group-state"

function loadGroupState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function Sidebar() {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const saved = loadGroupState()
    const defaults: Record<string, boolean> = {}
    for (const g of navGroups) {
      defaults[g.id] = g.id in saved ? saved[g.id] : (g.defaultOpen ?? false)
    }
    return defaults
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups))
  }, [openGroups])

  const toggle = (id: string) => setOpenGroups(s => ({ ...s, [id]: !s[id] }))

  return (
    <nav className="w-52 shrink-0 bg-[#1a1d27] border-r border-[#2d3148] flex flex-col py-4 gap-0 overflow-y-auto">
      <div className="px-4 mb-4">
        <h1 className="font-bold text-sm tracking-tight">
          CLI<span className="text-[#6c63ff]">Proxy</span>API
        </h1>
        <p className="text-[0.68rem] text-[#64748b] mt-0.5">扩展管理面板</p>
      </div>

      {navGroups.map(group => {
        const isOpen = openGroups[group.id] ?? group.defaultOpen
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => toggle(group.id)}
              className="w-full flex items-center justify-between px-4 py-1.5 text-[0.7rem] font-semibold text-[#4a5568] hover:text-[#64748b] uppercase tracking-wider transition-colors"
            >
              <span>{group.label}</span>
              <ChevronDown
                size={12}
                className={cn("transition-transform duration-200", isOpen ? "rotate-0" : "-rotate-90")}
              />
            </button>

            {isOpen && (
              <div className="mb-1">
                {group.items.map(({ to, icon: Icon, label, end }) => (
                  <NavLink
                    key={to} to={to} end={end}
                    className={({ isActive }) => cn(
                      "flex items-center gap-2.5 px-4 py-1.5 mx-2 rounded-[7px] text-[0.82rem] transition-all",
                      isActive
                        ? "bg-[#6c63ff]/20 text-[#6c63ff] font-semibold"
                        : "text-[#94a3b8] hover:bg-[#22263a] hover:text-[#e2e8f0]"
                    )}
                  >
                    <Icon size={14} />
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
