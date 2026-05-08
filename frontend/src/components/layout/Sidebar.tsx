import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard, FileKey2, Zap, BarChart3, History,
  MessageSquareCode, ScrollText, Copy, Settings, CircleAlert,
  Bell, LineChart, KeyRound, BriefcaseBusiness, Monitor, Boxes, Wrench, Webhook,
  HeartPulse, Wand2, Shield, Receipt,
  Gauge, Compass, Sparkles,
  Archive, Stethoscope, DollarSign,
} from "lucide-react"

const navItems = [
  { to: "/",           icon: LayoutDashboard,  label: "仪表盘",     end: true  },
  { to: "/accounts",   icon: FileKey2,          label: "授权文件",   end: false },
  { to: "/quota",      icon: Zap,               label: "Codex 配额",  end: false },
  { to: "/models",     icon: Boxes,             label: "模型池",      end: false },
  { to: "/system",     icon: Wrench,            label: "系统/更新",   end: false },
  { to: "/system-diagnostics", icon: Stethoscope, label: "系统诊断",  end: false },
  { to: "/backups",    icon: Archive,           label: "备份与恢复",  end: false },
  { to: "/tokens",     icon: BarChart3,         label: "Token 统计",  end: false },
  { to: "/token-reports", icon: Receipt,        label: "Token 报表",  end: false },
  { to: "/pricing",    icon: DollarSign,        label: "定价表",      end: false },
  { to: "/history",    icon: History,           label: "请求历史",    end: false },
  { to: "/account-health", icon: HeartPulse,    label: "账号健康",    end: false },
  { to: "/maintenance-rules", icon: Wand2,      label: "维护规则",    end: false },
  { to: "/audit-log",  icon: Shield,            label: "审计日志",    end: false },
  { to: "/issues",     icon: CircleAlert,       label: "问题中心",    end: false },
  { to: "/alerts",     icon: Bell,              label: "告警",        end: false },
  { to: "/analytics",  icon: LineChart,         label: "分析",        end: false },
  { to: "/oauth",      icon: MessageSquareCode, label: "OAuth 登录",  end: false },
  { to: "/api-keys",   icon: KeyRound,          label: "API Keys",    end: false },
  { to: "/api-key-limits", icon: KeyRound,      label: "API Key 限额", end: false },
  { to: "/api-key-insights", icon: Sparkles,    label: "API Key 画像", end: false },
  { to: "/routing-lab", icon: Compass,          label: "路由实验台",  end: false },
  { to: "/capacity-forecast", icon: Gauge,      label: "容量预测",    end: false },
  { to: "/webhooks",   icon: Webhook,           label: "Webhook 推送", end: false },
  { to: "/jobs",       icon: BriefcaseBusiness, label: "任务",        end: false },
  { to: "/logs",       icon: ScrollText,        label: "日志",        end: false },
  { to: "/duplicates", icon: Copy,              label: "重复检测",    end: false },
  { to: "/desktop",    icon: Monitor,           label: "桌面/回退",   end: false },
  { to: "/settings",   icon: Settings,          label: "设置",        end: false },
]

export function Sidebar() {
  return (
    <nav className="w-52 shrink-0 bg-[#1a1d27] border-r border-[#2d3148] flex flex-col py-4 gap-0.5 overflow-y-auto">
      <div className="px-4 mb-5">
        <h1 className="font-bold text-sm tracking-tight">
          CLI<span className="text-[#6c63ff]">Proxy</span>API
        </h1>
        <p className="text-[0.68rem] text-[#64748b] mt-0.5">扩展管理面板</p>
      </div>
      {navItems.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to} to={to} end={end}
          className={({ isActive }) => cn(
            "flex items-center gap-2.5 px-4 py-2 mx-2 rounded-[7px] text-[0.84rem] transition-all",
            isActive
              ? "bg-[#6c63ff]/20 text-[#6c63ff] font-semibold"
              : "text-[#94a3b8] hover:bg-[#22263a] hover:text-[#e2e8f0]"
          )}
        >
          <Icon size={15} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
