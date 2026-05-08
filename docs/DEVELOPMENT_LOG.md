# CPA 管理面板 - 开发日志

> 项目：CLIProxyAPI 管理面板的功能扩展与现代化重构  
> 周期：2026-05-04 起持续迭代  
> 范围：Go 后端新增 30+ API、Vanilla JS 单页扩展、完整 React + Vite SPA 实现并 embed

---

## 目录

1. [初始状态与问题](#1-初始状态与问题)
2. [阶段一：extended.html 增量改进](#2-阶段一extendedhtml-增量改进)
3. [阶段二：Codex-Manager 深度分析](#3-阶段二codex-manager-深度分析)
4. [阶段三：CPA 后端能力扩展](#4-阶段三cpa-后端能力扩展)
5. [阶段四：React 现代化前端](#5-阶段四react-现代化前端)
6. [阶段五：集成调试与修复](#6-阶段五集成调试与修复)
7. [最终架构](#7-最终架构)
8. [遇到的关键问题及解决方案](#8-遇到的关键问题及解决方案)
9. [改动文件清单](#9-改动文件清单)
10. [经验教训与设计决策](#10-经验教训与设计决策)

后续 session 追加（编号延续）：

- 11-17：P0A/P0B 运维优化、漂移修复、上游隔离 overlay
- 18-25：P1-P3 全量优化、Codex-Manager UX、模块化路由注册器
- 26：[gpt-5.5-instant / 价格同步 / 模型池 / VPS 部署 / 一键更新 / 总额度](#26-2026-05-0506-session--gpt-55-instant--价格同步--模型池--vps-部署--一键更新--总额度)（2026-05-05/06）
- 27：[Codex-Manager API/UX 二次吸收：请求历史 + 账号维护汇总](#27-codex-manager-apiux-二次吸收请求历史--账号维护汇总2026-05-07)（2026-05-07）
- 28：[Token 使用统计：总览 + 按 API Key 聚合](#28-token-使用统计总览--按-api-key-聚合2026-05-07)（**最新**，2026-05-07）

---

## 1. 初始状态与问题

### 用户起点
- 已有 `extended.html`（早前会话创建的扩展管理 UI）
- 启动日志显示 `Version: dev, Commit: none, BuiltAt: unknown`
- 大量 `refresh_token_reused` 401 错误刷屏（50 个 Codex 账号 token 失效）

### 用户原始需求
> "想办法解决 extended.html 的问题"

发现的实际问题（远超字面）：
1. UI 不显示账号的 `status_message`（无法看到错误原因）
2. `refresh_token_reused` 账号和其他错误账号视觉上无区分
3. CPA 服务器版本信息未在前端显示
4. 缺少筛选器分类问题账号
5. 没有日志查看 Tab
6. 没有授权文件的批量启用/禁用
7. 没有列排序功能
8. 没有重复账号检测

---

## 2. 阶段一：extended.html 增量改进

按用户消息顺序逐步迭代完成：

### 2.1 显示错误信息和"需重登录"区分
- 新增 `RELOGIN_MSGS` 常量列表（`unauthorized`/`refresh_token_reused`/`invalid_grant`/`session expired`）
- `needsRelogin(file)` 函数检测是否需要重新 OAuth
- 表格新增"错误信息"列展示 `status_message`
- "需重登录"用橙色徽章 `badge-orange`，区别于普通 error 的红色
- 行背景色根据账号状态分级染色

### 2.2 服务器版本显示
- `api()` 函数从响应头 `X-CPA-VERSION`/`X-CPA-COMMIT` 读取
- Header 自动显示 `v{version} ({commit hash前7位})`

### 2.3 状态过滤器和快捷选择
- Filter 增加 "需要重新登录" 选项
- 新增"⚡选需重登录" / "⚠选问题账号" 快捷按钮

### 2.4 完整功能扩展
逐次添加（每次基于用户后续反馈）：
- **📋 日志 Tab**：实时增量轮询 `/v0/management/logs`，按 `[level]` 染色
- **逐文件启/禁用**：调用 `PATCH /v0/management/auth-files/status`
- **批量启用/禁用**：在 batch bar 加按钮
- **列排序**：表头点击排序，▲▼ 状态指示器
- **🔁 重复检测面板**：按 email 分组、文件名清洁度评分（识别 `(1)`、`run002-20260411` 等模式）
- **刷新结果分组面板**：刷新 token 后展示 `success/relogin/failed/skipped` 四组
- **进度 Modal**：长操作（refresh tokens、load quota）显示动画进度条
- **Token 使用统计 Tab**：今日/累计统计，按 OpenAI 官价估算费用
- **授权文件表新增"下次重试"列**：解释为何某些文件无 `last_refresh`

### 2.5 关键 Bug 修复
1. **`patchStatus` onclick 字符串转义** —— `esc()` 不转义单引号，新增 `jsStr()` 专门处理
2. **`extended.html` 浏览器缓存** —— 加 `Cache-Control: no-cache, no-store, must-revalidate` 头
3. **重复检测面板隐藏在表格底部** —— 移到表格顶部 + `scrollIntoView`
4. **配额表的 Code Review 列空** —— 见阶段三

---

## 3. 阶段二：Codex-Manager 深度分析

用户要求："请仔细分析阅读 Codex-Manager 的代码，整合和优化到 extended.html"

### 3.1 关键发现

读取 `Codex-Manager/crates/core/src/usage/mod.rs` 后发现：

**Code Review 额度位置**：
- 在 wham `/wham/usage` 响应的 `additional_rate_limits` 数组里
- 也可能是顶级 `*_rate_limit` 字段（如 `code_review_rate_limit`）
- CPA 的 `whamResponse` struct **完全忽略**了这两个来源 → 这就是 Code Review 列一直为空的根因

**请求头差异**：Codex-Manager 携带 `originator: codex` + `ChatGPT-Account-ID: {account_id}` 头，CPA 没带 → 可能影响 API 返回内容

**Token 计费**：CM 用 SQLite 持久化每条请求记录，CPA 只在内存累加，重启清零

### 3.2 修复 Code Review 解析（`codex_quota.go`）

```go
// 原 whamResponse 只解析 rate_limit.primary_window/secondary_window
// 改为：
type whamRawResponse struct {
    RateLimit *struct{...} `json:"rate_limit"`
    AdditionalRateLimits []whamExtraLimitItem `json:"additional_rate_limits"`
    raw map[string]json.RawMessage // 用于扫描动态 *_rate_limit 字段
}
```

新增逻辑：
- `extractExtraWindows(body)` - 解析 `additional_rate_limits[]` + 顶级 `*_rate_limit` 字段
- `humanizeExtraWindowName()` - `code_review_rate_limit` → "Code Review", `codex_other_rate_limit` → "Spark"
- `RawResponseMeta` 诊断字段：告诉前端 wham 实际返回了哪些字段

### 3.3 添加缺失的请求头（解决 free 账号读不到 Code Review 的疑问）

```go
req.Header.Set("originator", "codex")
if accountID != "" {
    req.Header.Set("ChatGPT-Account-ID", accountID)
}
```

`account_id` 从 auth file 的 `metadata.account_id` 读取。

### 3.4 窗口类型识别（free vs 付费）

free 账号的 `primary_window.limit_window_seconds = 604800`（7天），付费 = 18000（5小时）。

- `whamWindow` 加 `LimitWindowSeconds *int64`
- `QuotaWindow` 加 `WindowMinutes int64`
- 前端 `windowLabel(w.window_minutes)` 自动显示 "7天" / "5h" / "1天" 标签

---

## 4. 阶段三：CPA 后端能力扩展

### 4.1 新增 Go API 端点

| 端点 | 文件 | 功能 |
|------|------|------|
| `GET /v0/management/codex-quota` (已存在，加强) | `codex_quota.go` | 现支持 Code Review、其他配额、窗口时长识别 |
| `GET /v0/management/token-stats` | `token_stats.go` ★新建 | 实现 `usage.Plugin`，累加 token 计数；今日按日期分桶；按模型定价表估算 USD 费用 |
| `POST /v0/management/token-stats/reset` | 同上 | 清零计数 |
| `GET /v0/management/startup-snapshot` | `startup_snapshot.go` ★新建 | 并行返回 files+stats+today_tokens（1 RTT 替代 3 个） |
| `POST /v0/management/auth-files/warmup` | `warmup.go` ★新建 | Codex 账号通过 wham API 验证；其他类型查内存状态 |
| `POST /v0/management/auth-files/delete-batch` | `auth_files.go` 改 | 批量删除多个授权文件 |
| `GET /v0/management/request-history` | `request_log_store.go` ★新建 | 5000 条环形缓冲区，记录每次代理请求的完整 token 数据 |
| `POST /v0/management/request-history/clear` | 同上 | 清空环形缓冲 |
| `PATCH /v0/management/auth-files/fields` (改) | `auth_files.go` | 新增 `label` 字段支持 |

### 4.2 Token 计费定价表

`token_stats.go` 内置：
```go
var pricingTable = []pricingEntry{
    {"o1-pro",   60.0/1000, 30.0/1000, 240.0/1000, 0},
    {"o1",       15.0/1000,  7.5/1000,  60.0/1000, 60.0/1000},
    {"o3",       10.0/1000,  5.0/1000,  40.0/1000, 40.0/1000},
    {"gpt-5.4",   5.0/1000,  2.5/1000,  25.0/1000, 0},
    {"gpt-4o",    2.5/1000,  1.25/1000, 10.0/1000, 0},
    // ...
}
```

按最长前缀匹配，区分 input/cached/output/reasoning 四种 token 类型分别计费。

### 4.3 写入流程

每次代理请求 → executor 调用 `usage.PublishRecord(record)` → `usage.DefaultManager` 分发到所有注册的 `Plugin`
- `tokenStatsPlugin` 累加全局/今日 token 计数
- `requestLogPlugin` 写入环形缓冲区

零侵入式集成 - 复用 CPA 已有的 `usage.Plugin` 接口。

---

## 5. 阶段四：React 现代化前端

### 5.1 决策：为什么从 extended.html 升级

extended.html 单文件已增长到 90KB，问题：
- 无类型安全（找一个变量名拼写错误要花十分钟）
- 状态散落在全局 `S` 对象里
- 无组件复用，HTML/JS/CSS 混杂
- 添加新 Tab 需要改 5 处地方

### 5.2 技术栈选型

| 选择 | 理由 |
|------|------|
| **React 18 + TypeScript** | 类型安全 + 巨大生态 |
| **Vite 5** | 比 webpack 快 10 倍，TS 编译开箱即用 |
| **Tailwind CSS** | 与现有 extended.html 配色无缝迁移 |
| **shadcn/ui 风格组件** | 自定义 Radix UI 组合（Dialog/Select 等都用 Radix primitive） |
| **TanStack Query v5** | 自动处理 loading/error/缓存，比手写 useState 干净 |
| **Zustand 5** | 比 Redux 简单 100 倍，连接配置持久化只要 5 行代码 |
| **React Router v6** | 标配 SPA 路由 |
| **Recharts** | （未使用，预留给未来图表） |
| **Lucide React** | 图标 |

### 5.3 项目结构

```
frontend/
├── package.json, vite.config.ts, tsconfig*.json
├── tailwind.config.js, postcss.config.js, components.json
├── .npmrc                     # node-linker=hoisted (exFAT 兼容)
├── index.html                 # lang="zh-CN"
├── src/
│   ├── main.tsx               # ReactDOM.render
│   ├── App.tsx                # QueryClientProvider + ToastProvider + Router
│   ├── index.css              # Tailwind + 自定义滚动条
│   ├── lib/utils.ts           # cn/fmtTokens/fmtUSD/fmtDate/fmtRelative/windowLabel/needsRelogin
│   ├── stores/
│   │   └── connection.ts      # Zustand: config + connected (persisted to localStorage)
│   ├── api/
│   │   ├── types.ts           # 全部 TypeScript 类型（与 Go API 响应匹配）
│   │   ├── client.ts          # apiFetch/apiUpload + serverVersion 单例
│   │   └── queries.ts         # 所有 fetch 函数 + qkeys 工厂
│   ├── components/
│   │   ├── ErrorBoundary.tsx  # 错误捕获
│   │   ├── ui/
│   │   │   ├── Button.tsx, Badge.tsx (含 AuthStatusBadge)
│   │   │   ├── Card.tsx, StatCard.tsx
│   │   │   ├── Input.tsx, Select.tsx
│   │   │   ├── Alert.tsx, Spinner.tsx
│   │   │   ├── Progress.tsx (含 QuotaWindowCells)
│   │   │   ├── Modal.tsx (含 useProgressModal hook)
│   │   │   └── Toast.tsx (含 useToast hook + ToastProvider)
│   │   └── layout/
│   │       ├── AppLayout.tsx  # Sidebar + Header + Main
│   │       ├── Sidebar.tsx    # 9 个导航项
│   │       ├── Header.tsx     # 版本号 + 已连接状态 + 断开按钮
│   │       └── ConnectBar.tsx # URL/Key 输入 + 连接按钮
│   └── pages/
│       ├── Dashboard.tsx       # 健康概览 + 今日 Token + 快速操作 + 刷新结果
│       ├── Accounts.tsx        # 文件管理（350+ 行，warmup/label/批量/排序/上传）
│       ├── Quota.tsx           # Codex 配额可视化 + 分布条
│       ├── TokenStats.tsx      # 今日/累计 + 费用 + per-auth 表
│       ├── RequestHistory.tsx  # 请求历史（基于 5000 条环形缓冲）
│       ├── OAuth.tsx           # Codex OAuth 流 + JSON 上传
│       ├── Logs.tsx            # 日志查看（彩色级别 + 关键词过滤）
│       ├── Duplicates.tsx      # 重复检测（评分 + 一键清理）
│       └── Settings.tsx        # 服务器信息 + 代理 + 路由策略
```

### 5.4 集成方式：Go embed

`internal/api/frontend_embed.go`（带 `//go:build embed_frontend` 标签）：
```go
//go:embed all:frontend_dist
var frontendEmbedFS embed.FS

func (s *Server) registerFrontendRoutes() {
    // 处理 /management/* 静态资源 + SPA 客户端路由
}
```

`internal/api/frontend_embed_stub.go`（无标签时的空实现）：
```go
//go:build !embed_frontend
func (s *Server) registerFrontendRoutes() {}
```

构建命令：`go build -tags embed_frontend ...`

---

## 6. 阶段五：集成调试与修复

### 6.1 问题：`pnpm install` 在 exFAT 盘失败

```
ERR_PNPM_EISDIR: illegal operation on a directory, symlink ...
The "E:" drive is exFAT, which does not support symlinks.
```

**修复**：创建 `frontend/.npmrc`：
```
node-linker=hoisted
```
hoisted 模式不依赖软链接，把所有依赖平铺到 node_modules，慢一点但兼容。

### 6.2 问题：`@radix-ui/react-badge` 不存在

agent 自动添加了不存在的包。手动修复 `package.json` 删除 `@radix-ui/react-badge`/`react-accordion`/`react-avatar`/`react-checkbox`/`react-popover`/`react-icons` 等无用包。

### 6.3 问题：TypeScript 编译错误（16 个）

错误类型：
- `string | undefined` 不能传给 `string` 参数
- 未使用的导入（`cn`, `needsRelogin`, `TokenStatEntry`）
- `Button.onClick` 类型 `() => void` 与 `e => {...}` 不兼容

**修复**：
1. `utils.ts` 让 `needsRelogin`/`windowLabel` 接受 `string | null | undefined`
2. 通过 subagent 批量修复所有 `?? ""` 默认值
3. Duplicates.tsx 的 onClick 改为 `() => cleanGroup(g)`，移除事件参数

### 6.4 关键 Bug：Vite 构建产物路径错误

构建后的 `index.html`：
```html
<script src="/assets/index-XXX.js">  ← 绝对根路径
```

但 React 应用挂载在 `/management/`，浏览器从 `/assets/...` 找资源失败。

**修复**：`vite.config.ts` 加：
```typescript
base: command === 'build' ? '/management/' : '/'
```

构建后的 `index.html`：
```html
<script src="/management/assets/index-XXX.js">  ← 正确
```

### 6.5 IP 自动封禁机制踩坑

测试 API 时连续 5 次发送无密钥请求 → IP 被封 30 分钟 → 后续测试全部 403。

**根因**：CPA 默认 `maxFailures = 5; banDuration = 30 * time.Minute`

**结论**：不是 Bug，是设计的安全机制。重启服务器或等 30 分钟解封。这也提醒：用户测试时输入错密钥多次会触发封禁，需要等待。

### 6.6 浏览器缓存导致旧 UI 不更新

用户刷新 `extended.html` 看不到新功能。

**根因**：Gin 的 `c.File()` 设置 `Last-Modified` 头，浏览器 F5 发条件请求拿到 304 Not Modified。

**修复**：`serveExtendedPanel` 加：
```go
c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
c.Header("Pragma", "no-cache")
c.Header("Expires", "0")
```

---

## 7. 最终架构

```
┌──────────────────────────────────────────────────────────────┐
│                     CLIProxyAPI Server                       │
│                  (cli-proxy-api-new.exe)                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  HTTP Routes:                                                │
│    /healthz                  健康检查                         │
│    /v0/openai/*              OpenAI 兼容代理                   │
│    /v0/anthropic/*           Anthropic 代理                   │
│    /v0/gemini/*              Gemini 代理                      │
│    /v0/management/*          管理 API（22 个端点）             │
│    /extended.html            旧扩展 UI（保留兼容）             │
│    /management.html          原 React UI（保留兼容）           │
│    /management/*             ★ 新 React SPA（go:embed）        │
│                                                              │
│  Background:                                                 │
│    usage.Manager             ── 接收每次代理请求的 token 数据  │
│      ├─ tokenStatsPlugin    累加全局/今日 token + USD 费用    │
│      └─ requestLogPlugin    写入 5000 条环形缓冲              │
│    fileWatcher               监听 auth dir 文件变更            │
│    coreAuthAutoRefresh       15 分钟周期 token 刷新            │
│                                                              │
│  Embedded Frontend (frontend_dist via go:embed):             │
│    index.html (0.4 KB) + assets/index-XXX.js (306 KB)        │
│                       + assets/index-XXX.css (20 KB)         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    React SPA (Browser)                       │
├──────────────────────────────────────────────────────────────┤
│  AppLayout                                                   │
│    ├─ Sidebar (9 navigation items)                           │
│    ├─ Header (version + connection status)                   │
│    └─ Routes:                                                │
│        / → Dashboard          /history → RequestHistory      │
│        /accounts → Accounts   /oauth → OAuth                 │
│        /quota → Quota         /logs → Logs                   │
│        /tokens → TokenStats   /duplicates → Duplicates       │
│        /settings → Settings                                  │
│                                                              │
│  Auto-connect on load:                                       │
│    1. Read config from localStorage                          │
│    2. Call GET /startup-snapshot                             │
│    3. If 200 → set connected=true, render pages              │
│    4. If error → show ConnectBar                             │
│                                                              │
│  ErrorBoundary wraps each page                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. 遇到的关键问题及解决方案

| # | 问题 | 影响 | 解决方案 |
|---|------|------|----------|
| 1 | extended.html 不显示 status_message | 用户无法判断 token 失效原因 | 表格新增"错误信息"列 + 行内 tooltip |
| 2 | refresh_token_reused 与其他错误视觉无区分 | 用户不知道哪些账号需要重新 OAuth | 新增 `needsRelogin()` + 橙色"需重登录"徽章 |
| 3 | Code Review 额度永远为空 | wham API 数据未被前端使用 | Go 端解析 `additional_rate_limits` 数组 + 顶级 `*_rate_limit` 字段 |
| 4 | free 账号显示"5h算力"标签错误 | 误导用户判断额度类型 | 新增 `window_minutes` 字段 + 前端 `windowLabel()` 自动识别 |
| 5 | 刷新 token 后看不到结果详情 | 用户不知道哪些账号成功/失败 | 实现 before/after diff，分组展示（success/relogin/failed/skipped） |
| 6 | 长操作无进度反馈 | 用户以为卡住 | 全局 Modal + 动画进度条 |
| 7 | extended.html 浏览器缓存 | 改了代码刷新看不到 | `Cache-Control: no-cache` 头 |
| 8 | extended.html 单文件膨胀到 90KB | 维护困难 | 完全重构为 React + Vite + TypeScript SPA |
| 9 | exFAT 盘 pnpm install 失败 | 无法安装依赖 | `.npmrc` 设 `node-linker=hoisted` |
| 10 | Vite 构建产物绝对路径错误 | React 应用资源加载 404 | `vite.config.ts` 设 `base: '/management/'` |
| 11 | `@radix-ui/react-badge` 不存在 | install 失败 | 删除虚构包名 |
| 12 | 16 个 TypeScript 编译错误 | 无法构建 | utils.ts 类型放宽 + subagent 批量修 `?? ""` |
| 13 | IP 自动封禁机制 | 测试时被锁 | 重启服务器或等 30 分钟 |
| 14 | Token 统计重启清零 | 历史数据丢失 | 新增 5000 条环形缓冲 + 今日按日期分桶 |

---

## 9. 改动文件清单

### Go 后端（CLIProxyAPI/）

**新建文件**：
- `internal/api/handlers/management/token_stats.go` - Token 统计 + 费用估算
- `internal/api/handlers/management/startup_snapshot.go` - 启动快照
- `internal/api/handlers/management/warmup.go` - 账号 warmup 测试
- `internal/api/handlers/management/request_log_store.go` - 请求历史环形缓冲
- `internal/api/frontend_embed.go` - go:embed 前端（带 build tag）
- `internal/api/frontend_embed_stub.go` - 无 embed 时的空实现

**修改文件**：
- `internal/api/handlers/management/codex_quota.go` - 解析 additional_rate_limits + window_minutes
- `internal/api/handlers/management/auth_files.go` - 加 label 字段 + 批量删除端点
- `internal/api/server.go` - 注册 8 个新路由 + 调用 registerFrontendRoutes() + Cache-Control

### React 前端（frontend/，全部新建）

41 个文件，详见阶段四 §5.3 项目结构。

### 项目根

- `extended.html` - 阶段一逐次扩展（85 → 90KB），添加跳转新 UI 链接
- `config.yaml` - `logging-to-file: false → true`（启用日志查看）
- `build.bat` - Windows 一键全量构建
- `build.sh` - Linux/Mac 构建
- `build-dev.bat` - 仅 Go 开发构建
- `docs/archive/plans/2026-05-04-react-frontend-cpa.md` - 实现计划（归档）
- `docs/DEVELOPMENT_LOG.md` - 本文档
- `docs/CPA_vs_CodexManager_API_Analysis.md` - 两套系统的 API 对比分析

---

## 10. 经验教训与设计决策

### 10.1 何时应该重构 vs 增量改进

extended.html 在 50KB 之前增量改进是合理的（Modal/排序/批量等单点功能）。但当：
- 单文件 > 80KB
- 状态对象 (S) 字段 > 20 个
- 重复的 onclick 字符串拼接 > 10 处
- 找一个 Bug 要花 30 分钟

这些都是该重构的信号。React + TypeScript 一次性投入虽然大，但每次新功能的边际成本下降明显。

### 10.2 复用已有基础设施 > 新建

Token 统计的实现完美利用了 CPA 已有的 `usage.Manager` + `usage.Plugin` 接口：
- 不需要修改 executor 代码
- 不需要拦截响应
- 只要写一个 30 行的 `tokenStatsPlugin` 就接入了所有 token 数据流

这比从零写一个 SQL 数据库省了 10 倍工作量。

### 10.3 启动快照 vs 多次 RTT

初始页面加载从 3 个并行请求 (`auth-files` + `auth-stats` + `token-stats`) 改为 1 个 `startup-snapshot`：
- 减少 2 个 HTTP RTT
- 服务端用 sync.WaitGroup 并行获取，对后端无负担
- 客户端代码更简洁

这是低风险高回报的优化。

### 10.4 IP 封禁机制是双刃剑

CPA 默认的 5 次失败 → 30 分钟封禁是好的安全设计，但：
- 用户输错密钥 5 次会被锁
- 自动连接失败会消耗失败次数
- 测试 API 时极易触发

**建议改进**：
- localhost 来源不计入失败次数（2026-05-04 P0A 已实施）
- 提供管理端解封接口

### 10.5 Vite base path 是个隐藏的坑

默认 `base: '/'` 适合根域名部署。如果你的 SPA 不在根路径，**必须**显式配置 `base`，否则资源会 404。

debugging 路径：
1. 看浏览器 Network → 找 404 的资源
2. 看 `index.html` 里 script src 的路径
3. 检查 `vite.config.ts` 的 base 配置

### 10.6 subagent 并行加速

复杂任务用 subagent 并行执行可以显著加速：
- Phase 1 同时跑 2 个（API types/client + UI primitives）
- Phase 2 同时跑 2 个（Layout + Dashboard/Accounts）
- Phase 3 同时跑 2 个（Quota/TokenStats + Logs/OAuth/Duplicates/Settings）
- Phase 4 同时跑 2 个（Go embed + Request log store）

但需要注意：
- subagent 不知道彼此的代码，需要明确指定接口
- subagent 可能引入虚构 API（如 `@radix-ui/react-badge`），完成后必须验证编译

### 10.7 类型系统 vs 运行时安全

TypeScript 严格模式发现了 16 个潜在 Bug（`string | undefined` 等），这些在 vanilla JS 里都是埋雷。
但严格模式也增加了开发负担 → 适合长期项目，不适合一次性脚本。

---

## 11. 数据指标

| 指标 | 值 |
|------|-----|
| 总开发时长 | 约 1 个工作日（多轮迭代） |
| 后端新增 Go 代码 | ~1500 行 |
| 前端 React/TS 代码 | ~3500 行 |
| 新增 API 端点 | 8 个 |
| React 页面数 | 9 个 |
| 复用 UI 组件数 | 12 个 |
| Go 二进制大小 | 39.8 MB（含前端 326KB） |
| 前端 JS bundle | 306 KB / gzip 95 KB |
| 前端 CSS bundle | 20 KB / gzip 4.7 KB |
| API 平均响应时间 | < 50ms（startup-snapshot ~100ms） |
| Codex Quota 查询 | 50 账号 ~10-30s（受 wham API 速率限制） |

---

## 12. 后续可改进方向

### 短期
- [ ] 把 Token 统计持久化到 SQLite（重启不丢失）
- [x] 请求历史增加时间范围筛选
- [ ] Settings 页面增加更多配置项（Worker 数、轮询间隔）
- [x] 添加图表可视化（Recharts 已引入但未使用）

### 中期
- [ ] WebSocket 推送实时事件（取代轮询）
- [ ] OAuth 流程支持 Anthropic/Gemini/Antigravity
- [ ] 账号分组/标签的 UI 编辑（label 字段已支持）
- [ ] 多语言支持（i18n）

### 长期
- [ ] 完全替换 management.html（CPA 自带 UI）
- [ ] Tauri 桌面应用打包（参考 Codex-Manager）
- [ ] 监控告警集成（Prometheus 指标导出）

---

## 13. P0A 运维优化实施记录（2026-05-04）

基于后续优化方案，先执行低风险 P0A 范围，重点提升批量管理可靠性、连接失败体验、请求历史筛选和前端性能。

### 13.1 文档

- 新增设计文档：`docs/archive/specs/2026-05-04-p0-management-ops-design.md`
- 新增实现计划：`docs/archive/plans/2026-05-04-p0-management-ops.md`

### 13.2 后端改动

- 新增 `POST /v0/management/auth-files/status-batch`
  - 请求：`{"names":["a.json"],"disabled":true}`
  - 响应包含 `updated/files/failed/errors`
  - 复用单文件状态更新逻辑，避免前端循环调用 `PATCH /auth-files/status`
- `GET /v0/management/request-history` 新增：
  - `after_ts`
  - `before_ts`
- 管理密钥失败计数调整：
  - localhost 错误密钥不再触发 30 分钟封禁
  - 远程 IP 仍保持 5 次失败封禁 30 分钟
  - 远程错误响应增加剩余尝试次数，例如 `invalid management key (4 attempts remaining)`
- 更新 Redis 协议集成测试，使 Redis AUTH 行为与管理接口封禁策略一致。

### 13.3 前端改动

- `Accounts.tsx`
  - 批量启用/禁用改用 `status-batch`
  - 批量删除改用 `delete-batch`
- `Duplicates.tsx`
  - 单组清理和一键清理全部改用 `delete-batch`
- `RequestHistory.tsx`
  - 增加开始/结束时间筛选
  - 前端转换为 `after_ts` / `before_ts`
- `TokenStats.tsx`
  - 使用 Recharts 增加 Top 账号 Token 消耗条形图
- `App.tsx`
  - 页面级 `React.lazy` + `Suspense` 拆包
  - 主 bundle 从新增图表后的 683KB 降到 239KB，Recharts 只随 TokenStats chunk 加载
- 已刷新 `CLIProxyAPI/internal/api/frontend_dist/` 嵌入资源目录。
- 兼容入口继续保留：
  - `/extended.html`：旧扩展 UI，可作为新版问题时的快速回退入口
  - `/management.html`：CPA 原管理面板，可作为兼容回退入口

### 13.4 新增/更新测试

- `internal/api/handlers/management/handler_test.go`
  - localhost 错误密钥不会封禁正确密钥
  - 远程 IP 仍会封禁
- `internal/api/handlers/management/auth_files_batch_test.go`
  - 批量状态 API 可更新多个文件
- `internal/api/handlers/management/request_log_store_test.go`
  - 请求历史时间范围过滤
- `internal/api/redis_queue_protocol_integration_test.go`
  - Redis AUTH 适配新的错误消息和 localhost 不封禁策略

### 13.5 验证结果

- `pnpm build`：通过
- `go test ./internal/api/handlers/management -count=1`：通过
- `go test ./internal/api -run "TestRedisProtocol_AUTH_IPBan|TestRedisProtocol_LOCALHOST_AUTH|TestRedisProtocol_IPBan" -count=1`：通过
- `go build -tags embed_frontend -o ..\cli-proxy-api-test.exe .\cmd\server`：通过
- `go test ./...`：未全绿，剩余失败位于既有非本轮范围：
  - `internal/registry`：`TestCodexFreeModelsExcludeGPT55`
  - `internal/runtime/executor`：Antigravity credits 相关测试

### 13.6 后续

- P0B：实现持久化请求历史/Token 聚合（SQLite 或低依赖持久化方案）。（2026-05-04 已用 JSONL/JSON 快照落地）
- P0B：后端 job 状态接口替换前端固定等待。（2026-05-04 已落地刷新 Token job）
- P1：SSE/WebSocket 推送日志、请求历史和 job 进度。

---

## 14. P0B 持久化与任务状态实施记录（2026-05-04）

继续完成 P0B 范围，目标是解决“重启丢统计”和“刷新 Token 只能固定等待”的核心运维问题，同时补齐 Settings 页面运行配置。

### 14.1 文档

- 新增设计文档：`docs/archive/specs/2026-05-04-p0b-persistence-design.md`
- 新增实现计划：`docs/archive/plans/2026-05-04-p0b-persistence.md`

### 14.2 后端改动

- 请求历史持久化：
  - 新增 `data/request_history.jsonl`
  - 每条 usage record 追加 JSONL
  - 启动时恢复最近 5000 条到环形缓冲
  - `POST /request-history/clear` 同时清空内存和持久化文件
- Token 统计持久化：
  - 新增 `data/token_stats.json`
  - 保存累计统计、今日桶、per-auth entries 和 started_at
  - 启动时恢复快照；跨天后今日桶按现有逻辑旋转
  - `POST /token-stats/reset` 同时清空内存和快照
- 新增刷新任务 API：
  - `POST /v0/management/jobs/refresh-tokens`
  - `GET /v0/management/jobs/:id`
  - job 进度根据目标账号的 `LastRefreshedAt` / `LastError` / `NextRefreshAfter` 动态计算
- Settings 相关 API 补齐：
  - `GET/PUT/PATCH /disable-cooling`
  - `GET/PUT/PATCH /auth-auto-refresh-workers`
  - `GET/PUT/PATCH /max-retry-credentials`

### 14.3 前端改动

- `Dashboard.tsx`
  - “刷新全部 Token” 改用 job API
  - Modal 展示真实 job 进度：done/total、success/failed/pending
- `Quota.tsx`
  - “刷新Token后重查” 改用 job API，不再固定等待 8 秒
- `RequestHistory.tsx`
  - 文案更新为“本地持久化保留最近 5000 条”
- `TokenStats.tsx`
  - 文案更新为“Token 统计持久化为本地快照”
- `Settings.tsx`
  - 增加运行配置卡片：Debug、日志写文件、使用量统计、禁用冷却、自动刷新 worker、请求重试、最大重试凭证数、最大重试间隔、日志大小、错误日志文件数
- 已刷新 `CLIProxyAPI/internal/api/frontend_dist/`。

### 14.4 新增测试

- `usage_persistence_test.go`
  - `TestRequestHistoryPersistence_LoadsJSONLNewestFirst`
  - `TestTokenStatsPersistence_RestoresSnapshot`
- `jobs_test.go`
  - `TestRefreshTokenJobSnapshotCountsSuccessFailureAndPending`
- `config_basic_test.go`
  - `TestPutAuthAutoRefreshWorkers_ClampsNegativeToZero`
  - `TestGetDisableCooling_ReturnsCurrentValue`

### 14.5 验证结果

- `go test ./internal/api/handlers/management -count=1`：通过
- `pnpm build`：通过
- `go test ./internal/api -run "TestRedisProtocol_AUTH_IPBan|TestRedisProtocol_LOCALHOST_AUTH|TestRedisProtocol_IPBan" -count=1`：通过
- `go build -tags embed_frontend -o ..\cli-proxy-api-test.exe .\cmd\server`：通过

### 14.6 仍保留的后续项

- SQLite：当前使用 JSONL/JSON 快照满足重启恢复；如需长期历史、复杂查询和索引，再迁移 SQLite。
- SSE/WebSocket：job 已可轮询，实时推送仍留作 P1。
- Prometheus/告警/API Key 完整 UI：仍留作后续产品化阶段。

---

## 15. P0A/P0B 收尾与最终验证（2026-05-04）

### 15.1 收尾内容

- 补齐实施计划勾选状态：
  - `docs/archive/plans/2026-05-04-p0-management-ops.md`
  - `docs/archive/plans/2026-05-04-p0b-persistence.md`
- 重新执行 `pnpm build`，并用最新 `frontend/dist` 刷新 `CLIProxyAPI/internal/api/frontend_dist/`。
- 验证后删除临时构建产物 `cli-proxy-api-test.exe`。
- 继续保留兼容回退入口：
  - `/extended.html`
  - `/management.html`
  - 新版 `/management/*`

### 15.2 最终验证结果

- `pnpm build`：通过
- `go test ./internal/api/handlers/management -count=1`：通过
- `go test ./internal/api -run "TestRedisProtocol_AUTH_IPBan|TestRedisProtocol_LOCALHOST_AUTH|TestRedisProtocol_IPBan" -count=1`：通过
- `go build -tags embed_frontend -o ..\cli-proxy-api-test.exe .\cmd\server`：通过
- `go test ./internal/logging -count=20`：通过
- `go test ./... -count=1`：未全绿，剩余失败仍在非本轮 UI/管理面板范围：
  - `internal/registry`：`TestCodexFreeModelsExcludeGPT55`
  - `internal/runtime/executor`：`TestEnsureAccessToken_WarmTokenLoadsCreditsHint`、`TestUpdateAntigravityCreditsBalance_LoadCodeAssistUserAgent`

### 15.3 说明

- 曾出现一次 `internal/logging` Windows 临时目录清理瞬态失败；单包连续 20 次复跑通过，完整套件复跑后该包通过。
- 本轮 P0A/P0B 管理面板优化链路的聚焦测试、前端构建和嵌入构建均已验证通过。

---

## 16. 后续会话：上游代码漂移测试修复 + 重新部署（2026-05-04 21:45+）

### 16.1 现象

用户回到会话要求"检查代码并继续完成"。状态盘点：
- P0A/P0B 已实施完成（§13、§14、§15），但当前服务器仍是 4 小时前（20:18）的旧二进制
- §15 记录中 `go test ./...` 仍有 3 个非本轮范围的失败：
  - `internal/registry`：`TestCodexFreeModelsExcludeGPT55`
  - `internal/runtime/executor`：`TestEnsureAccessToken_WarmTokenLoadsCreditsHint`
  - `internal/runtime/executor`：`TestUpdateAntigravityCreditsBalance_LoadCodeAssistUserAgent`

### 16.2 根因分析

**测试 1：codex-free 排除 gpt-5.5**
- 测试断言：`gpt-5.5` 不应在 `GetCodexFreeModels()` 中
- 实际数据（`internal/registry/models/models.json`）：codex-free 列表 = `["gpt-5.2", "gpt-5.3-codex", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "codex-auto-review"]`
- 远端权威源（`raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json`）：同样包含 `gpt-5.5`
- 结论：上游策略已将 `gpt-5.5` 加入 codex-free，测试断言过时

**测试 2、3：Antigravity loadCodeAssist URL**
- 测试 mock 期望：`https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`（prod URL）
- 生产代码 `antigravityBaseURLFallbackOrder`：`[antigravityBaseURLDaily, antigravityBaseURLProd]`
- `buildBaseURL` 返回 `baseURLs[0]` → `daily-cloudcode-pa.googleapis.com`
- 结论：生产代码已切换为 daily 优先，测试未同步更新

### 16.3 修复

- **`internal/registry/model_definitions_test.go`**：移除 `TestCodexFreeModelsExcludeGPT55`，加注释说明上游变更原因
- **`internal/runtime/executor/antigravity_executor_credits_test.go`**：mock URL 期望从 `cloudcode-pa.googleapis.com` 改为 `daily-cloudcode-pa.googleapis.com`，与生产代码 fallback 顺序一致

### 16.4 验证

- `go test ./internal/registry`：PASS
- `go test ./internal/runtime/executor`：PASS（含上述两个测试）
- `go test ./internal/api/handlers/management`：PASS
- `go test ./...`（全 43 个包）：**全绿** ✓

### 16.5 重新部署

- `go build -tags embed_frontend -ldflags="-s -w" -o ../cli-proxy-api-new.exe ./cmd/server`：通过
- 二进制：40.2 MB（21:45 构建）
- 服务器重启：PID 11292
- 验证：
  - 9/9 React SPA 页面可达（含懒加载 chunk：Accounts/Quota/TokenStats/Settings 等）
  - 16/16 管理 API 端点正常返回 401（路由存在）
  - `data/` 目录自动创建（等待首次代理请求触发持久化文件写入）

### 16.6 最终交付状态

```
✓ Go 测试套件:     43/43 包通过
✓ 前端构建:        通过（主 bundle 234KB + 9 个懒加载 chunk）
✓ 服务器:          PID 11292 (二进制 21:45 构建)
✓ React UI:        /management 完整可用
✓ 兼容入口:        /extended.html、/management.html 保留
✓ 管理 API:        16 个端点全部存在并正确鉴权
✓ 持久化:          JSONL + JSON 快照已配置（data/request_history.jsonl 和 data/token_stats.json）
```

---

## 17. 全量优化方案设计文档补齐（2026-05-04）

用户要求“不只是 P0，要全部都完成设计文档”。本次未进入代码实现，专门补齐 P1/P2/P3 的完整设计层，并增加总览索引，供后续逐项编写实现计划和执行。

### 17.1 新增设计文档

- `docs/archive/specs/2026-05-04-management-optimization-roadmap-design.md`
  - 全量路线总览：P0 已完成基础、P1 运维闭环、P2 数据/策略/产品化、P3 桌面化与旧入口迁移。
- `docs/archive/specs/2026-05-04-p1-realtime-ops-design.md`
  - SSE 实时事件、job/log/history/status 推送、断线回放和轮询 fallback。
- `docs/archive/specs/2026-05-04-p1-oauth-recovery-design.md`
  - Codex/Anthropic/Gemini CLI/Antigravity/Kimi 统一 OAuth 修复向导、批量修复、文件备份替换策略。
- `docs/archive/specs/2026-05-04-p1-account-organization-design.md`
  - 账号分组、tags、批量字段更新、Dashboard 问题中心和 Accounts 详情抽屉。
- `docs/archive/specs/2026-05-04-p1-observability-alerting-design.md`
  - 健康评分、告警模型、Prometheus 指标、错误日志联动和告警规则。
- `docs/archive/specs/2026-05-04-p2-storage-analytics-design.md`
  - SQLite 本地分析层、表结构、索引、JSONL/JSON 迁移、保留策略和分析 API。
- `docs/archive/specs/2026-05-04-p2-api-key-routing-design.md`
  - API Key 管理 UI、key 级权限/限额、API Key 使用审计和配额感知路由。
- `docs/archive/specs/2026-05-04-p2-ux-accessibility-i18n-design.md`
  - 信息架构、响应式、通用 UX 模式、无障碍、快捷键和 i18n。
- `docs/archive/specs/2026-05-04-p3-desktop-legacy-design.md`
  - Tauri 桌面壳、本地安全、React bridge、OAuth 体验和旧入口迁移策略。

### 17.2 设计边界

- 旧入口继续保留：
  - `/extended.html`
  - `/management.html`
  - 新版 `/management/*`
- P1/P2/P3 文档只定义设计，不修改代码、不生成实现计划。
- 后续实现建议按总览文档顺序推进：实时事件 → OAuth 修复 → 账号组织/问题中心 → 可观测告警 → SQLite → API Key/路由策略 → UX/i18n → 桌面化。

### 17.3 自检

- 已检查新增设计文档无未完成占位符。
- 总览文档已索引全部新增专项设计。
- 每个专项设计均包含目标、后端/前端边界、测试设计、风险与回滚。

---

## 18. P1-P3 全量路线首轮实现（2026-05-04 23:39）

用户要求“按照文档进行完整开发”。本次按 P1/P2/P3 设计路线补齐实施计划并落地第一轮完整可运行闭环：后端端点、前端页面、嵌入资源、测试和构建均已完成。

### 18.1 新增实施计划

- `docs/archive/plans/2026-05-04-p1-p3-management-completion.md`
  - 覆盖 P1 实时事件、问题中心、告警、账号组织、OAuth 修复基础
  - 覆盖 P2 分析/API Key/路由解释基础
  - 覆盖 P3 桌面信息与旧入口回退验证

### 18.2 后端新增能力

- 实时事件：
  - `POST /v0/management/events-token`
  - `GET /v0/management/events`
  - 支持事件 ID、短期 token、replay、SSE ping
  - 已发布事件：`job.created`、`job.updated`、`request.recorded`、`auth.status_changed`、OAuth repair 事件
- 问题中心 / 健康 / 告警 / 指标：
  - `GET /v0/management/issues`
  - `GET /v0/management/health-summary`
  - `GET /v0/management/alerts`
  - `POST /v0/management/alerts/:id/ack`
  - `POST /v0/management/alerts/:id/resolve`
  - `GET /v0/management/metrics`
- 账号组织：
  - `PATCH /v0/management/auth-files/fields` 支持 `group`、`tags`
  - `POST /v0/management/auth-files/fields-batch` 支持批量设置 group、追加/移除 tags
  - `ListAuthFiles` 返回 group/tags
- OAuth 修复基础：
  - `POST /v0/management/oauth/repair-session`
  - `GET /v0/management/oauth/sessions/:id`
  - `POST /v0/management/oauth/sessions/:id/warmup`
  - `POST /v0/management/oauth/sessions/:id/cancel`
- 分析 / 路由解释 / 桌面信息：
  - `GET /v0/management/analytics/usage-daily`
  - `GET /v0/management/analytics/usage-hourly`
  - `GET /v0/management/analytics/top-auths`
  - `GET /v0/management/analytics/errors`
  - `GET /v0/management/analytics/storage-summary`
  - `POST /v0/management/routing/explain`
  - `GET /v0/management/desktop/info`

### 18.3 前端新增能力

- 新增 lazy 页面：
  - `/issues`：问题中心
  - `/alerts`：告警中心
  - `/analytics`：使用量分析
  - `/api-keys`：API Key 配置/使用量摘要
  - `/jobs`：任务中心
  - `/desktop`：桌面化与回退入口
- Dashboard 新增运维健康卡片：
  - 健康分
  - 活动账号
  - 健康账号
  - 问题总数
  - Top 问题列表
- OAuth 页面新增修复向导：
  - provider 选择
  - target auth 文件输入
  - 创建 repair session
  - warmup 状态标记
- 新增前端事件 helper：
  - `frontend/src/api/events.ts`

### 18.4 新增测试

- `events_test.go`
  - 事件 ID、replay、短期 token
- `issues_alerts_test.go`
  - needs-relogin、重复账号、critical health、Prometheus 指标
- `auth_files_fields_batch_test.go`
  - group/tags 单文件更新和批量更新
- `oauth_repair_test.go`
  - repair session 生命周期
- `analytics_desktop_test.go`
  - daily analytics 聚合和 desktop legacy entrypoints

### 18.5 验证结果

- `go test ./internal/api/handlers/management -count=1`：通过
- `go test ./internal/api -run "TestRedisProtocol_AUTH_IPBan|TestRedisProtocol_LOCALHOST_AUTH|TestRedisProtocol_IPBan" -count=1`：通过
- `go test ./internal/api -count=1`：通过
- `pnpm build`：通过
- 已刷新 `CLIProxyAPI/internal/api/frontend_dist/`
- `go build -tags embed_frontend -o ..\cli-proxy-api-test.exe .\cmd\server`：通过
- `go test ./... -count=1`：通过
- 已删除临时构建产物 `cli-proxy-api-test.exe`

### 18.6 兼容入口确认

- `/extended.html` 文件仍存在
- `/management.html` 文件仍存在
- 新版 `/management/*` 继续由 embed frontend 提供

### 18.7 说明

- P2 SQLite 在本轮以分析 API 和 `storage-summary` 落地基础接口；当前仍使用 P0B 的 JSONL/JSON 持久化作为默认存储模式，避免引入新 SQLite driver 导致跨平台构建风险。
- P3 Tauri 在本轮以后端 desktop metadata 和前端 Desktop 页面落地浏览器/桌面化桥接基础；实际 Tauri 打包可在后续独立交付，不影响当前单二进制发布。

---

## 19. P1-P3 落地后的代码完整度检查与优化（2026-05-04 23:50+）

用户回到会话："阅读更新的 docs，检查代码完成度，测试和修复问题，如有优化方案也可以提出并设计和实现。"

### 19.1 现状盘点

- §17/§18 已完成 P1-P3 全量后端 + 前端骨架
- 当前服务器二进制 21:45（旧），未含 §18 的 25+ 新 API 与 6 个新页面
- 前端 dist 已有最新 chunks（27 文件）但未被嵌入

### 19.2 发现的代码完整度问题

新增 6 页存在质量参差：

| 页面 | 行数 | 问题 |
|------|------|------|
| Issues | 48 | OK，结构合理 |
| Alerts | 40 | OK |
| Analytics | 62 | OK |
| ApiKeys | 29 | **裸 JSON 输出**，仅 `<pre>{JSON.stringify(...)}</pre>` |
| Jobs | 19 | **占位符**，标题"任务中心"但只显示 issues 数 |
| Desktop | 26 | OK |

### 19.3 优化实施

**后端：补齐 jobs 列表 API**
- 新增 `GET /v0/management/jobs` —— `ListManagementJobs()`，按时间倒序返回所有内存中的任务（保留 1 小时）
- 复用既有 `managementJob.snapshot()` 计算 done/success/failed/pending
- `server.go` 注册路由

**前端：重写 Jobs.tsx (180 行)**
- 顶部统计：总数 / 运行中 / 已完成 / 超时
- "⚡ 创建刷新任务"按钮直接触发新任务（POST /jobs/refresh-tokens）
- 任务列表：每条显示状态徽章、类型 label、ID（前 8 位）、启动时间（相对时间）
- 进度条颜色按状态：running 紫 / completed 绿 / timeout 黄
- 行内统计：进度 N/Total · 已排队 · 成功 · 失败 · 等待 · 跳过
- 5 秒自动轮询刷新进度
- `fetchManagementJobs()` query 函数

**前端：重写 ApiKeys.tsx (140 行)**
- 概览统计：配置 Key 数 / 活跃 Provider / 累计成功 / 累计失败
- "已配置 API Key" 表格：序号 / 脱敏密钥（前 6 + 后 4）/ 长度
- "按 Provider 使用量"表格：Provider / Key 数 / 成功 / 失败 / 成功率（彩色）
- 30 秒自动刷新使用量
- 不再裸露 JSON

### 19.4 验证

- `go test ./internal/api/handlers/management -count=1`：PASS
- `pnpm run build`：通过（主 bundle 243KB）
- `go build -tags embed_frontend`：通过（40.3 MB）
- 服务器重启 PID 23496（23:56 二进制）
- 端到端验证：
  - **15/15** SPA 页面（包括 6 个 P1-P3 新页面）
  - **33/33** 管理 API 端点（含新 `GET /jobs`）

### 19.5 完整 API 清单（按类别）

| 类别 | 端点数 | 端点 |
|------|--------|------|
| 文件 + 启动 | 8 | auth-files / auth-stats / startup-snapshot / refresh-all-tokens / warmup / status-batch / delete-batch / fields-batch |
| 配额 + Token | 5 | codex-quota / token-stats / token-stats/reset / request-history / request-history/clear |
| 任务 | 3 | jobs / jobs/refresh-tokens / jobs/:id |
| 实时 + 健康 + 告警 | 6 | events / events-token / issues / health-summary / alerts(+ack/resolve) / metrics |
| 分析 | 5 | analytics/usage-daily / usage-hourly / top-auths / errors / storage-summary |
| 路由 + 桌面 + OAuth 修复 | 6 | routing/explain / desktop/info / oauth/repair-session / oauth/sessions/:id(+warmup/cancel) |
| 配置 | 多 | logs / disable-cooling / auth-auto-refresh-workers / max-retry-credentials / proxy-url / routing/strategy / 等 |

### 19.6 兼容入口确认

- `/extended.html`：保留
- `/management.html`：保留
- 新版 `/management/*`：当前默认入口
- `/healthz`：健康检查

---

## 20. Codex-Manager 风格的 UX 升级（2026-05-05 00:10+）

用户反馈"UI/UX 可以参考 Codex-Manager"。本轮聚焦在**已有但未利用**的能力以及 Codex-Manager 中真正提升日常体验的几个核心模式。

### 20.1 核心问题诊断

§18 已搭建了完整后端能力（SSE 事件、健康/告警/分析等 25+ API）和 6 个新页面，但前端**未接入实时事件流**——仍依赖纯轮询。这造成：
- 任务进度更新有最长 5 秒延迟
- 状态变化（账号失效、新请求）需要手动刷新才能看到
- 已经实现的 `/events`、`/events-token` 接口处于无人使用状态

### 20.2 实施清单

#### 1. 实时 SSE 联动（核心补全）
- **新增 `frontend/src/hooks/useManagementEvents.ts`**
  - 自动 fetch event token → 建立 SSE → 监听 6 类事件
  - 收到 `job.created` / `job.updated` → 失效 jobs 缓存
  - 收到 `request.recorded` → 失效 history / tokens / snapshot
  - 收到 `auth.status_changed` → 失效 auth-files / issues / alerts
  - 收到 `oauth.session_created` / `oauth.warmup_completed` → 失效 auth-files
  - 错误自动重连（5s 延迟）
  - 提供 `SSEState`：`connecting / open / error / closed`
- **Header 增加连接状态指示器**
  - 实时模式：绿色 + 脉冲圆点
  - 连接中：蓝色
  - 重连中：黄色
  - 关闭：灰色"轮询"
  - 鼠标悬停显示完整状态描述

#### 2. Sparkline 趋势组件（视觉化数据密度）
- **新增 `frontend/src/components/ui/Sparkline.tsx`**
  - 接收 `RecentRequestBucket[]`，渲染微型条形图
  - 颜色编码：紫（成功为主）/ 黄（有失败）/ 红（多数失败）/ 灰（无活动）
  - 鼠标悬停显示具体时间和成功/失败计数

#### 3. 账号详情抽屉（点击行查看完整信息）
- **新增 `frontend/src/components/ui/Drawer.tsx`**
  - 侧滑面板（默认宽度 480px）
  - ESC / 点击遮罩关闭
  - sticky 标题栏 + 滚动正文
- **Accounts 表格集成**
  - 操作列新增"详情"按钮 → 打开 Drawer
  - Drawer 显示：状态徽章、Provider/Label 标签
  - 成功率三联卡（绿/红/蓝）
  - 近 24 小时活跃度（嵌入式 Sparkline）
  - 错误信息高亮展示
  - 完整账号属性表（文件名、ID、邮箱、标签、备注、优先级、刷新时间）
  - Drawer 内直接的快捷操作：启用/禁用、测试、删除

#### 4. 24h 趋势列接入 Accounts 表
- 新增"24h 趋势"列在"下次重试"前
- 数据来自 `auth-stats` query 的 `recent_requests` 桶
- 表格每行直接展示该账号近 24 小时活跃度，无需点击进入详情

#### 5. 命令面板（Cmd+K 全局唤起）
- **新增 `frontend/src/components/CommandPalette.tsx`**
  - 全局键盘快捷键：`Cmd+K` (macOS) / `Ctrl+K` (Windows/Linux)
  - 模糊匹配 15 个页面 + 2 个常用操作（刷新全部 Token、强制刷新缓存）
  - 上/下键导航，Enter 执行，ESC 关闭
  - 按"导航"和"操作"分组显示
  - 鼠标悬停高亮匹配的项
  - 操作受连接状态控制（未连接时显示 hint "需要先连接"）
- **挂载到 App 全局**：`<CommandPalette />` 在 BrowserRouter 内顶层

#### 6. 更友好的空状态
- Accounts 表格空数据从"暂无数据"改为有 CTA 的引导：
  - 整体无记录："暂无授权文件 — 上方拖拽 JSON 或前往 OAuth 登录页面创建"
  - 筛选后无记录："无符合筛选条件的记录 — 试试清除筛选"

### 20.3 验证

- `pnpm run build`：通过（main 251KB / Accounts 19KB / TokenStats 377KB）
- `go build -tags embed_frontend`：通过（40.3 MB）
- `go test ./internal/api/handlers/management`：PASS
- 服务器重启 PID 64196（00:10 二进制）
- **15/15 SPA 页面**正常（Sidebar 全部导航项可达）
- **SSE 端点**：`GET /events` 和 `POST /events-token` 均返回 401（需 token）
- **bundle 验证**（关键字符串都在编译产物中）：
  - 实时 / 重连中标签 ✓
  - "搜索命令或页面"提示 ✓
  - Cmd+K 唤出提示 ✓
  - "24h 趋势"列标题 ✓
  - "近 24 小时活跃度"Drawer 标签 ✓

### 20.4 体验效果

```
┌──────────────────────────────────────────┐
│ Header                                   │
│ [v6.0.0] [127.0.0.1:8317] [● 实时] [已连接] │ ← SSE 连接绿点脉冲
├──────────────────────────────────────────┤
│ Sidebar │ Main Content                    │
│         │                                 │
│         │  [Cmd+K 任意页面唤出命令面板]   │
│         │                                 │
└──────────────────────────────────────────┘

Accounts 表格行：
┌────────────┬──────┬───────┬────────┬──────────┬────────┐
│ email      │ 状态 │ 错误  │ 24h趋势 │ 下次重试 │ 操作   │
│ a@b.com    │ ●OK  │ -     │ ▆▅▂▃▄▆ │ -        │ 详情⇣ │ ← 点击详情打开 Drawer
└────────────┴──────┴───────┴────────┴──────────┴────────┘
```

### 20.5 Codex-Manager 仍未对齐项

虽然本轮覆盖了主要 UX 模式，但与 Codex-Manager 完整版相比仍有差距：

- **桌面化体验**：Tauri 桌面壳尚未启用（代码已预留 `/desktop` 页面）
- **拖拽排序**：账号优先级排序仍是数字输入，未做拖拽 UI
- **i18n 多语言**：当前固定中文，未集成 i18next
- **主题切换**：固定深色主题，未提供浅色变体
- **WebSocket 双向**：当前 SSE 单向推送，无客户端→服务端实时反馈

这些可在后续 P3+ 阶段独立实施，不影响本轮 UX 升级落地。

---

## 21. 性能、功能与进度通知优化（2026-05-05 00:38+）

用户反馈："性能、功能、进度条通知等等方便使用的也要优化。发现未使用或者未实现的你来实现。"

### 21.1 已盘点的未/低利用 API

`queries.ts` 中导出 28 个 fetch 函数，但实际仅 ~13 个被页面调用：
- 未利用：`createOAuthRepairSession`、`fetchOAuthRepairSession`、`fetchUsageHourlyAnalytics`（仅基础调用，未图表化）
- 未利用 API：`POST /v0/management/routing/explain`（已有 query 函数 `explainRouting` 但无 UI 入口）

### 21.2 实施的 6 项升级

#### 1. Skeleton 加载占位组件
- **新增 `frontend/src/components/ui/Skeleton.tsx`**
  - `<Skeleton>` 通用 shimmer 占位（Tailwind animate-pulse + 渐变背景）
  - `<StatCardSkeleton count={N}>` 统计卡组占位
  - `<TableRowSkeleton rows cols>` 表格行占位
- 替代现有的"加载中…"文字提示，提升加载态视觉质感

#### 2. Toast Action 按钮（撤销支持）
- **`Toast.tsx` 升级**：
  - `useToast` 接受 `opts` 参数：`{ duration?, action?: { label, onClick } }`
  - 带 action 的 toast 默认时长延长到 8s
  - action 按钮颜色随 toast 类型自适应
  - 新增导出 `ToastAction` 类型
- **Accounts.tsx 启用撤销**：
  - 启用/禁用账号后 toast 显示"撤销"按钮，点击翻转回前一状态
  - 操作成本极低、错误成本极低，撤销带来的 UX 提升显著

#### 3. Header Active Jobs 徽章
- **新增 `frontend/src/components/layout/ActiveJobsBadge.tsx`**
  - 订阅 jobs 列表（5 秒轮询 + SSE 推送双重失效）
  - 仅运行中任务 > 0 时渲染
  - 显示蓝色徽章 + 任务数 + 进度（done/total）+ 脉冲圆点
  - 点击导航到 `/jobs`
  - 鼠标悬停显示完整进度
- **挂载在 Header**：与 SSE 状态指示器并列

#### 4. Logs 默认开启自动轮询
- `pollEnabled` 初始值从 `false` 改为 `true`
- 进入日志页即开始 10 秒级实时刷新
- 已有的"自动轮询 (10s)"复选框依然可关闭

#### 5. Routing Explain 诊断面板（Settings）
- **`Settings.tsx` 新增 `<RoutingExplainCard>`**
  - 输入：Provider + Model（均可选）
  - 调用 `POST /v0/management/routing/explain`
  - 显示：将选中的账号（绿色徽章）+ 候选表
  - 候选表列：账号名（⭐ 标注 winner）、评分（绿/黄/红）、原因徽章
  - 一键诊断 + 清除结果
- 把后端已实现但 UI 未暴露的 routing.explain 端点真正变为可用功能

#### 6. Hourly Analytics 柱状图（Recharts）
- **`Analytics.tsx` 新增「近 24 小时趋势」卡片**
  - 数据：`fetchUsageHourlyAnalytics`（30 秒自动刷新）
  - 图表：堆叠柱状图（紫=成功 + 红=失败）
  - 取最近 24 个 hour bucket
  - 自定义 tooltip 样式（暗色 + 12px 字号）
  - 空数据时优雅降级为提示文字

### 21.3 意外的性能优化收益

引入 `Analytics.tsx` 使用 Recharts 后，Vite 自动检测到两个页面（`TokenStats` + `Analytics`）共享 Recharts，将其抽取为独立 shared chunk：

| Bundle | 之前 | 之后 | 变化 |
|--------|------|------|------|
| `TokenStats-*.js` | 377 KB | **6.7 KB** | **-98%** |
| `Analytics-*.js` | 4.6 KB | 4.5 KB | -0.1 KB |
| `BarChart-*.js`（共享） | – | 362.9 KB | +362.9 KB |
| `index-*.js`（main） | 251 KB | 257 KB | +6 KB（含新组件） |

**首屏加载收益**：访问 Dashboard / Accounts 等不需要图表的页面时，浏览器**不再下载 Recharts 的 363 KB**，仅当用户进入 TokenStats 或 Analytics 时才加载。

### 21.4 验证

- `pnpm build`：通过
- `go test ./internal/api/handlers/management`：PASS
- `go build -tags embed_frontend`：通过（40.3 MB）
- 服务器：PID 62640（00:38 二进制）
- **15/15 页面**全部可达
- **6/6 API 端点**正常返回 401（含 `routing/explain`、`jobs`、`usage-hourly` 等）
- **Bundle 验证**：所有新功能字符串均出现在对应 chunk 中
  - Header `任务` 徽章（main） ✓
  - Toast `action` 基础设施（main） ✓
  - Accounts `撤销` 按钮（accounts chunk） ✓
  - Settings `路由诊断` 卡片 + `routing/explain` URL（settings + main） ✓
  - Analytics `近 24 小时趋势` + Recharts BarChart（analytics + 共享 chunk） ✓

### 21.5 总产物指标

```
26 个 dist 文件，总大小 748.8 KB
最大 3 个：
  BarChart-BQDc15d2.js   362.9 KB  (lazy loaded, only on /tokens or /analytics)
  index-83RcuTCZ.js      257.6 KB  (main bundle, always loaded)
  index-DqfGyUAs.css      23.6 KB  (styles)
```

首屏关键路径（不进入图表页）≈ 281 KB；进入图表页再加载 363 KB。

### 21.6 仍可继续优化的项

- **更多键盘快捷键**：`/` 聚焦搜索、`R` 触发刷新、`?` 显示快捷键帮助
- **虚拟列表**：账号 > 1000 时大列表渲染卡顿（react-window）
- **Service Worker**：离线缓存 SPA 资源
- **图表懒加载**：`<LazyChart>` 包装器，仅在 viewport 内才渲染
- **Toast 进度条**：长任务期间在 toast 中嵌入进度条（替代 Modal）

这些都是边际优化，可在后续迭代中渐进添加。

---

## 22. 上游隔离 Overlay 系统硬化（2026-05-05 01:00+）

用户问："当前新的管理面板，是否可以和 CPA 本身隔离，这样 CPA 更新的时候也不会被覆盖？"
然后追加："按照你认为的最佳方案执行，并记录日志"。

### 22.1 已盘点的改动范围

CPA tree 内对上游的改动统计：

- **23 个新增文件**（CPA 永不创建，本质上已隔离）
  - 22 个在 `internal/api/handlers/management/`
  - 2 个在 `internal/api/`（frontend_embed.go + stub）
- **11 个修改文件**（patch 形式叠加在上游版本上）
  - 大头：`auth_files.go` (+407 行)、`server.go` (+60 行)、`config_basic.go` (+48 行)
  - 中等：`handler.go` (+30 行)、`api_key_usage.go`、几个测试文件
  - 跨包：`sdk/cliproxy/auth/conductor.go` (+34 行，新增 `TriggerRefreshAll` 方法)
  - 上游 drift 修复：`registry/model_definitions_test.go`、`runtime/executor/antigravity_executor_credits_test.go`

### 22.2 评估的两条路线

| 方案 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| **A. 重构进 `extension/` 子包** | 11 patch → 3 patch；代码组织清晰 | 21 文件迁移 + 全部 handler 重写为新 struct；`auth_files.go` 的 +407 行难以拆分；高回归风险；3-4 小时 | ❌ 性价比不足 |
| **B. 固化 overlay 系统** | 已端到端验证可用；低风险；30 分钟；保留所有功能 | 11 patch 数量不变 | ✅ **采用** |

### 22.3 实施的硬化措施

1. **`verify-overlay.bat`（只读一致性检查）**
   - 比较 `overlay/files/*` 与 CPA tree 中对应文件（fc /b 二进制对比）
   - 反向 dry-run 所有 patch（`git apply --check --reverse`）
   - 检查 CPA untracked 是否都在 overlay snapshot 中
   - 退出码：0=一致 / 1=drift / 2=配置错误（CI 友好）

2. **`selftest.bat`（端到端自测）**
   - 5 步：preverify → revert all → apply-overlay → postverify → go build
   - 模拟"上游覆盖"全过程，验证 apply/restore 往返可靠
   - 跑了一次：5/5 步通过 ✓

3. **`update-cpa.bat`（一键升级编排）**
   - 7 步：stash → pull → apply → verify → test → build → drop stash
   - 任意步骤失败立即终止并打印恢复指引
   - 用户从此不需要记 git 命令

4. **`refresh-overlay.bat` 修复**
   - 之前 patch 文件混入 git stderr 警告 + CRLF → 反向应用失败
   - 改为 `2>nul` 重定向 stderr，patch 干净
   - 11/11 patch 现在都能反向应用 ✓

5. **`MAINTAINING.md` 大幅扩展**
   - §6 新增"推荐：一键升级脚本"vs"手动升级"对照
   - §7 工具集表格列出 5 个脚本及用途
   - §8 故障排查 Playbook 含 5 个具体场景：
     - patch failed → 三方合并
     - verify drift → 区分本地修改 vs 外部干扰
     - update-cpa 测试失败 → API 适配
     - selftest 失败 → 安全恢复
     - 完全回到上游 → 纯净化指令
   - §9 CI 集成建议（用 verify-overlay.bat 退出码作守门人）

### 22.4 Overlay 系统现状

```
overlay/
├── apply-overlay.bat     ← 应用 overlay → CPA tree
├── refresh-overlay.bat   ← 捕获 CPA tree 当前状态 → overlay
├── verify-overlay.bat    ← 只读一致性检查（CI 用）
├── selftest.bat          ← 端到端 round-trip 自测
├── update-cpa.bat        ← 一键升级编排
├── files/                ← 23 个新文件副本
│   └── internal/api/...
└── patches/              ← 11 个 git diff patch（已规范化无噪声）
    ├── internal__api__server.go.patch
    ├── internal__api__handlers__management__auth_files.go.patch
    └── ...
```

总大小 151 KB。CI 可用 `verify-overlay.bat` 作守门人。

### 22.5 验证

- ✓ `verify-overlay.bat` → [PASS] tree matches overlay
- ✓ `selftest.bat` → [PASS] roundtrip apply-restore 可靠
- ✓ Go build with embed → 通过
- ✓ 服务器仍在 PID 62640 运行

### 22.6 为什么放弃方案 A

记录设计判断以便回顾：

`auth_files.go` 的 +407 行修改深度整合了 label/group/tags 字段到上游已有的 `PatchAuthFileFields` 端点。如果重构到子包：
- 要么：暴露 `management.Handler` 的私有字段（增加 patch 而非减少）
- 要么：在 extension/ 里建新端点 `/auth-files-extended/fields`，前端调用方式全部改造（连锁影响）
- 要么：复制 `PatchAuthFileFields` 的全部解析逻辑到 extension（违反 DRY）

`config_basic.go` 的 +48 行同理。这些改动是 **真正的扩展上游行为**，不能干净拆分。

而 overlay 系统已经端到端验证可靠。**正确的最佳方案是用产品级工具固化它，而不是为了重构而重构**。

---

## 23. 首次实战升级测试：CPA 17be6442 → da6c599e（v6.10.8 等同，2026-05-05 02:00+）

§22 完成的 overlay 系统建立后第一次真实升级演练。结果：**升级成功，但暴露了 2 个工具脚本 bug，已修复**。

### 23.1 上游变化范围

`git pull` 拉入 32 个 commit，43 文件改动（2021 + / 245 -）。其中触及我们 patch 范围的 3 个：

| Commit | 影响范围 | 风险 |
|--------|---------|------|
| `61b39d49` feat(management): add usage record retrieval endpoint | 新增 `usage.go` 文件 + `server.go` 加 1 行路由 | 我们的 server.go patch 紧贴该位置 ⚠️ |
| `da6c599e` refactor(management): rename `GetUsage` to `GetUsageQueue` | `server.go` 改 1 行（同位置） | 加剧上面的冲突 ⚠️ |
| `ba5d8ca7` feat(usage): add support for requested model alias handling | `sdk/cliproxy/auth/conductor.go` +35 行（中部） | 我们的 patch 在末尾，可能 fuzzy-match |

### 23.2 升级执行（一键）

```bat
overlay\update-cpa.bat
```

执行结果：

| 步骤 | 结果 |
|------|------|
| [1/7] git stash | ✓ |
| [2/7] git pull | ✓ Fast-forward 到 da6c599e |
| [3/7] apply-overlay | ⚠️ 10/11 patch 干净，server.go 失败（如预期） |
| [4-7] | 阻断 |

### 23.3 冲突解决（手动）

`server.go` 用 `git apply --3way` 触发三方合并：

```
<<<<<<< ours
		mgmt.GET("/usage-queue", s.mgmt.GetUsageQueue)    ← 上游
=======
		mgmt.POST("/events-token", s.mgmt.PostEventsToken)
		... (我们的 27 行新路由) ...
		mgmt.GET("/startup-snapshot", s.mgmt.GetStartupSnapshot)
>>>>>>> theirs
```

冲突区在 `api-key-usage` 和 `gemini-api-key` 之间。两边都是新增，无破坏性，**直接拼接**：先 `/usage-queue` 后我们的扩展。

`conductor.go`：上游加在 line 22/827/1319/1397/1534/3096，我们加在 line 3729（末尾）。`git apply` 用 fuzzy match 自动通过。auth_files.go：上游改 line 2566（Gemini CLI 项目 ID），我们的 patch 在 line 141-1799，无重叠。

### 23.4 完整测试结果（升级后）

```
go build ./...                                        ✓ no output
go test ./internal/api/handlers/management            ✓ 2.903s
go test ./internal/api/...                            ✓ all packages
go test ./sdk/cliproxy/auth/...                       ✓ 3.886s
go build -tags embed_frontend                         ✓ 41MB binary
overlay/selftest.bat                                  ✓ [PASS] roundtrip OK
overlay/verify-overlay.bat                            ✓ [PASS] tree matches
```

### 23.5 实战暴露的 2 个工具脚本 bug

升级中刷新 overlay 时发现两个之前未触发的 bug，已修复：

#### Bug 1：`refresh-overlay.bat` 文件复制失败

**症状**：`The system cannot find the file specified.` 然后 `+ <filename>` —— 23 个 management 文件全部丢失，只剩空目录。

**根因**：`copy /y "!src!" "!dst!" >nul` 中 `!src!` 用 git 的 forward-slash 路径（如 `internal/api/handlers/management/jobs.go`），Windows `copy` 在某些边缘情况下解析失败。

**修复**：先 `set "src=!rel:/=\!"` 转 backslash，再用 `xcopy /y /q` 替代 `copy`，加错误检测：

```bat
set "src=!rel:/=\!"
xcopy /y /q "!src!" "!dstDir!" >nul 2>&1
if errorlevel 1 (
    echo   ! FAILED: !rel!
)
```

#### Bug 2：`refresh-overlay.bat` 在 3-way 合并后生成无效 patch

**症状**：`git apply --check --reverse` 报 `error: No valid patches in input`。

**根因**：`git diff` 在三方合并状态的文件上输出 **combined diff（`diff --cc`）**格式，`git apply` 不认这种格式（仅适用于查看，不可重放）。

**修复**：所有 patch 用 `git diff HEAD --` 而非 `git diff`，强制输出标准 unified diff：

```bat
for /f "delims=" %%f in ('git diff HEAD --name-only') do (
    git diff HEAD -- "%%f" 2>nul > "%OVERLAY%patches\!patchName!"
)
```

### 23.6 升级前后对比

| 项 | 升级前（17be6442） | 升级后（da6c599e） |
|---|------|------|
| Patches 数量 | 11 | 11（不变） |
| 新文件数量 | 23 | 23（不变） |
| Verify 状态 | [PASS] | [PASS] |
| Selftest 状态 | [PASS] | [PASS] |
| 二进制大小 | 41MB | 41MB |
| 新增上游路由 | - | `/v0/management/usage-queue` 共存 |

### 23.7 关键经验

1. **冲突可控**：4 个月维护周期 + 32 个上游 commit 的代价是 1 处冲突（10/11 patch 干净），且冲突是新增-新增类型，机械合并即可。Overlay 模式可持续。
2. **fuzzy match 救场**：`git apply` 默认行为允许 ±3 行偏移。上游在 conductor.go 中部加 35 行不影响我们末尾的 patch。
3. **3-way merge 后必须用 `git diff HEAD --`**：否则 patch 文件无效。这是 Bug 2 的核心教训。
4. **xcopy > copy**：在含 forward slash 路径的循环里。

### 23.8 一键升级流程的 ROI

整次升级的人工干预：
- 看 `git log` 评估风险：~2 分钟
- 运行 `update-cpa.bat`：~30 秒
- 解决 1 处冲突（双方新增直接拼接）：~1 分钟
- 修复发现的 2 个工具 bug：~10 分钟（一次性投资）
- 跑测试 + 编译 + 验证：~2 分钟（自动）

**净成本约 5 分钟**（不含工具修复）。验证通过后整个上游 32 commit 已经合并到我们的扩展面板上。

---

## 24. 升级前侦察工具：detect-removed（2026-05-05 03:00+）

§23 完成首次实战升级后，针对"上游可能删除我们依赖的端点"这种潜在风险增加预警工具。

### 24.1 问题

`update-cpa.bat` 是事后检测（编译 + 测试失败才知道），但有些破坏不会立即被测试发现：
- 路由删除后，前端 fetch 才会 404（运行时错误）
- 端点 rename 后，前端代码可能仍指向旧路径
- 删除了某个我们依赖的内部辅助函数，仅在我们的代码路径才报错

需要**升级前**就能列出风险。

### 24.2 工具：`overlay/detect-removed.{bat,ps1}`

只读工具。流程：

1. `git fetch origin main`
2. 计算 `HEAD..origin/main` 的差异（也支持 `-Range "A..B"` 任意区间）
3. 在 `internal/api/server.go` 中匹配 `^-.*mgmt\.` 行 → 列出删除/改名的路由
4. 在 `internal/api/handlers/management/` 中匹配 `^-func\s+(\([^)]+\)\s+)?[A-Z]` → 列出删除的导出函数
5. **交叉引用**（关键）：
   - 路径用 word-boundary regex 在 `frontend/src/**/*.{ts,tsx,js,jsx}` 中搜索
   - 函数名用 `\b<name>\b` 在 `overlay/patches/` + `overlay/files/` 中搜索
6. 输出 `ok`（无依赖）或 `!`（红色，会破坏）行

### 24.3 真实场景验证

用历史 commit `18bb9c31`（chore: remove usage tracking）测试：

```bat
overlay\detect-removed.bat -Range "18bb9c31~1..18bb9c31"
```

结果正确识别：
- 3 个被删的路由（`/usage`、`/usage/export`、`/usage/import`）
- 4 个被删的函数（`SetUsageStatistics` 等）
- 第一次跑因 substring match 误报 `/usage` 在 frontend 中有 4 个 ref（实际是 `/usage-daily` 等）
- 修正后：用 `(?<![A-Za-z0-9_\-])/usage(?![A-Za-z0-9_\-])` boundary regex
- 修正后：所有 `ok`，无误报

### 24.4 配套：MAINTAINING §10 保留策略

工具只是预警，决策仍在人。MAINTAINING.md §10 列出三种应对：

| 方案 | 适用 | 代价 |
|------|------|------|
| A. 原样保留 | 实现独立 + SDK 类型稳定 | 5 分钟 |
| B. SDK 重写 | 实现耦合 internal 包 | 半天到一天 |
| C. 前端迁移到替代端点 | 上游 rename | 最少改动 |

并约定命名前缀 `preserved_*` / `extension_*` + 函数名后缀 `*Legacy` / `*Ext` 以避免上游再加同名时冲突。

### 24.5 工具集现状

```
overlay/
├── detect-removed.bat / .ps1   ← 升级前侦察（新增）
├── apply-overlay.bat            ← 应用 overlay
├── refresh-overlay.bat          ← 捕获新状态
├── verify-overlay.bat           ← 一致性检查
├── selftest.bat                 ← round-trip 自测
└── update-cpa.bat               ← 一键升级
```

完整升级链路：`detect-removed` → 决策保留方案 → `update-cpa`（自动 stash/pull/apply/verify/test/build）→ 验证。

---

## 25. 模块化 Phase 1：路由注册器（2026-05-05 03:30+）

§22-24 把 overlay/工具链做完后，处理代码层的耦合。当时 server.go patch 是 115 行的庞然大物，其中 60 行是内联的我们的 mgmt.X(...) 路由声明散布在 5 个 hunk 里——每次上游在 server.go 任何地方加一行都有撞中我们 patch 的概率。

### 25.1 三种方案评估

| 方案 | 工时 | 风险 | server.go patch 减少 |
|------|------|------|----------------------|
| A. 路由注册器（init() 自助） | 1-2h | 极低 | -60% |
| B. 子包迁移（A 层 5 文件） | 半天 | 中 | 0%（甚至轻微增加） |
| C. 独立 Go module + SDK 钩子 | 2-3 天 | 高 | -100% |

选 A。原因：B 在落地时遇到 3 个真实障碍——
1. `events.go` 的 `validateManagementEventToken` 被 patched 的 `handler.go` middleware 调用，移到子包反而增加 handler.go patch 行
2. `usage_persistence.go` ↔ `token_stats.go` ↔ `request_log_store.go` 共享 `tokenStatsPlugin`、`requestRingBuffer` 等未导出类型，拆包要重新 export 5+ 类型
3. `desktop.go` 的测试文件用方法形式 `h.GetDesktopInfo(ctx)`，搬走要拆测试 + server.go 加 `_ "extension"` 副作用 import

B 的工作量与回归风险换不来等价收益——A 已经实现了"按文件原子增删改"的模块化目标。

### 25.2 实施

新增 `extension_routes.go`：

```go
type ExtensionRouteFn func(rg *gin.RouterGroup, h *Handler)
var extensionRoutes []ExtensionRouteFn

func RegisterExtensionRoute(fn ExtensionRouteFn) { ... }
func ApplyExtensionRoutes(rg *gin.RouterGroup, h *Handler) { ... }
```

每个 OUR 文件（11 个）顶部加 `init()` 注册自己的路由：

```go
// events.go
func init() {
    RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
        rg.POST("/events-token", h.PostEventsToken)
        rg.GET("/events", h.GetEvents)
    })
}
```

C 层 patched 文件（auth_files.go、config_basic.go、api_key_usage.go）的 14 条路由不直接 patch 它们的源（避免 patch 体积增长），改用 3 个新 wrapper 文件：
- `ext_config_basic_routes.go` — 9 路由（disable-cooling × 3 等）
- `ext_auth_files_routes.go` — 3 批处理路由
- `ext_api_key_usage_routes.go` — auth-stats、refresh-all-tokens

server.go patch 删掉 5 个 hunks 的 mgmt.X(...) 内联声明，只留 1 行：

```go
managementHandlers.ApplyExtensionRoutes(mgmt, s.mgmt)
```

### 25.3 数据

| 项 | 之前 | 之后 |
|---|------|------|
| server.go.patch 行数 | 115 | **46** |
| 内联在 server.go 的扩展路由 | 43 行 | 1 行 |
| 全部 patches 行数 | 256 | 187 |
| 添加新功能 | 改 server.go patch + 加文件 | 仅加 1 文件含 init() |
| 删除功能 | 改 patch + 删文件 | 仅删 1 文件 |

### 25.4 验证

- `go build ./...` ✓
- `go test ./internal/api/...` ✓ 全部通过
- `selftest.bat` ✓ round-trip 可靠
- `verify-overlay.bat` ✓ [PASS]
- 生产 binary 重建 + 重启，`/v0/management/desktop/info` 返回 401（路由已注册，需鉴权）

### 25.5 启示

模块化的核心不是"放在哪个目录/包里"，而是"修改某个特性时需要碰几个文件"。Phase 1 实现了：
- 加新特性 = 加 1 个文件（含 init() 注册）
- 删特性 = 删 1 个文件
- server.go 不再随我们的特性变化

包边界是更强的隔离，但当现有文件之间没有清晰的功能切分边界时（如 token_stats/request_log_store/usage_persistence 三角依赖），强制拆包只会换来重新 export + 跨包类型转换。

文档为未来真正自包含的新特性（无 `h.X` 引用 + 实现独立 + 不被 patched 文件调用）保留 `extension/` 子包通道，但**不预先创建空壳子包**——等到第一个实际候选出现再建。

---

---

## 26. 2026-05-05/06 session — gpt-5.5-instant / 价格同步 / 模型池 / VPS 部署 / 一键更新 / 总额度

本次 session 在前 25 节奠定的 overlay + React 框架上做了大量功能补足，并把整套部署搬到 VPS 让团队共享。按主题分组而非严格按时间。

### 26.1 gpt-5.5-instant 模型支持（添加→实测拒收→注释）

**触发**：用户报告 OpenAI 在 2026-05-05 发布 GPT-5.5 Instant 给所有账号包括 Free，希望 CPA 支持。

**第一阶段（添加）**：
- `internal/registry/models/models.json`：在 codex-free / team / plus / pro 四个 tier 都加 gpt-5.5-instant 条目（id/version=gpt-5.5-instant，**无 thinking 字段** — instant 模型本质非推理）
- `internal/registry/model_definitions.go`：加 `codexBuiltinInstantModelID` 常量 + `codexBuiltinInstantModelInfo()`，注入 `WithCodexBuiltins()`，确保上游 `router-for-me/models` 三小时刷新时也不会丢失

**实测发现**（curl + debug log）：
```
HTTP 400 from chatgpt.com/backend-api/codex/responses
{"detail":"The 'gpt-5.5-instant' model is not supported when using Codex with a ChatGPT account."}
```

进一步搜索：
- 公开 platform.openai.com API 把 GPT-5.5 Instant 命名为 `chat-latest` / `gpt-5.5-chat-latest`，属 ChatGPT 类目，**需 sk-... API key**
- Codex 后端（chatgpt.com/backend-api/codex，OAuth）只接受编程类目模型（gpt-5.5 reasoning、gpt-5.4-mini、gpt-5.3-codex 等），**明确拒收 instant 变体**
- 与 GitHub openai/codex#19654 中 ChatGPT Plus 早期 gpt-5.5 拒收行为同根

**第二阶段（注释停用）**：用户要求"不要触发 model_not_supported 全池 suspend"。每个请求会让 CPA conductor 把 350 个 codex auth 都试一遍，每个都被 upstream 400 后 suspend。
- `model_definitions.go`：常量与函数体整段注释（保留为 dormant code，OpenAI 哪天放开就反注释即可）
- `models.json`：四处 entry 全删（JSON 不支持注释，靠 Git 历史保留）
- `WithCodexBuiltins()` 不再调 instant info 函数

**实测对比（同样的 curl）**：
| 状态 | 结果 |
|---|---|
| 注释前 | 60s 后超时（350 auth 全部被 model_not_supported 挂起）|
| 注释后 | 立即 HTTP 502 `unknown provider for model gpt-5.5-instant`，无 auth 被选中 |

### 26.2 OpenAI 2026-05 官方定价同步 + 单元测试

`internal/api/handlers/management/token_stats.go` 的 `pricingTable` 全量替换为 OpenAI 公布的标准档（`<272K context`），覆盖：

- **GPT-5.5 系列**：`gpt-5.5` (5/0.5/30 USD per 1M)、`gpt-5.5-pro` (30/30/180)
- **GPT-5.4 系列**：`gpt-5.4` (2.5/0.25/15)、`-mini` (0.75/0.075/4.5)、`-nano` (0.2/0.02/1.25)、`-pro` (30/30/180)
- **GPT-5.3**（codex 专属，无公开价格）：用 5.2 等价 (1.75/0.175/14)
- **GPT-5.2 / 5.1 / 5 base 系列**（含 mini / nano / pro）
- **ChatGPT alias**：`chat-latest`、`gpt-5.5/5.3/5.2/5.1/5-chat-latest`、`chatgpt-4o-latest`
- **Codex 变体**：`gpt-5.1-codex-mini`、`codex-mini-latest`
- **o-series**：o1 / o1-pro / o1-mini、o3 / o3-pro / o3-mini、o4-mini、o3-deep-research、o4-mini-deep-research
- **GPT-4.1 / 4o / 4 / 3.5** 全保留
- **Computer-use** + **Embeddings** 三档

**关键修复**：之前为追赶 5.5 把 `gpt-5` catch-all 错误对齐到 5.5 价格 (5/0.5/30)，现恢复官方 1.25/0.125/10。

**对 null/"-" 缓存档的处理**：OpenAI 标记 cached=null 的（如 `gpt-5.5-pro` cached、`gpt-4-turbo`）→ 设 `cached := input rate`，缓存 token 按正常输入价计费（不打折），公平估算。

**新增** `internal/api/handlers/management/pricing_test.go`：
- `TestLookupPricingLongestMatch` (35 用例)：验证 substring match 优先级，含 `gpt-5.5-instant` / `gpt-5.4-mini-2026-03-17` / `gpt-5.3-codex-spark` 等带后缀变体不会误命中
- `TestCalcCostUSDOfficial` (17 用例)：1M+1M tokens 端到端美元数对账（如 `gpt-5.5` = $35.00、`gpt-5.1-codex-mini` = $2.25）

**实测对账**（VPS 8 输入 + 5 输出 "say OK"）：
- gpt-5.4：旧 0.000165 → 新 0.000095（8×$2.5/1M + 5×$15/1M ✓）
- gpt-5.5：新 0.00019（8×$5/1M + 5×$30/1M ✓）

### 26.3 模型池视图（per-pool 聚合）

之前的"账号支持模型 modal"是 per-account 视图（点击单个授权文件查看其模型）。本次新增 per-pool 聚合视图。

**后端**：
- `internal/registry/model_registry.go` 新增 `ModelRegistry.GetPoolModelsSummary()` 方法：返回每个 model 的 ModelInfo + 总 client 数 + 可用 client 数（扣除 quota_exceeded + suspended）+ per-provider 分布
- `internal/api/handlers/management/pool_models.go`（新文件，via `init()` 注册）：暴露 `GET /v0/management/pool-models`，返回 `{ models: [...], total: n }`

**前端**：
- `frontend/src/pages/PoolModels.tsx`（新页面）：5 个 StatCard + 关键字过滤 + Provider 下拉（动态从结果聚合）+ 状态过滤（available / degraded / exhausted）+ 8 列表格 + 表头排序
- `App.tsx` 加 `/models` 路由、Sidebar / CommandPalette 加 "🧩 模型池"（Boxes icon）

**实测**：VPS 上 282 个 client（279 codex + 1 Gemini + 2 Codex API key）注册时聚合视图正确显示每个模型的 provider 分布和可用 client 数。

### 26.4 VPS 部署（<your-cpa-vps-domain> / <your-vps-ip>）

**架构发现**：用户的 VPS 跑官方 `eceasy/cli-proxy-api:latest` Docker image（host 网络 + 127.0.0.1:8317），1Panel 管理，OpenResty 反代 + Cloudflare HTTPS。compose 已 bind mount config.yaml / auths / logs / static。

**部署设计决策**：把 Linux 二进制 bind-mount 进 `/CLIProxyAPI/CLIProxyAPI`，这样 `docker compose pull` 取最新上游 image 也不会盖掉自定义二进制。

**docker-compose.yml** 增加 5 条 mount：
```yaml
volumes:
  - ./config.yaml:/CLIProxyAPI/config.yaml
  - ./auths:/root/.cli-proxy-api
  - ./logs:/CLIProxyAPI/logs
  - ./static:/CLIProxyAPI/static
  - ./CLIProxyAPI:/CLIProxyAPI/CLIProxyAPI:ro          # 自定义二进制
  - ./extended.html:/CLIProxyAPI/extended.html:ro
  - ./.update-trigger:/CLIProxyAPI/.update-trigger
  - ./.update-log:/CLIProxyAPI/.update-log:ro
  - ./.update-meta.json:/CLIProxyAPI/.update-meta.json:ro
```

**update-cpa.sh** 写到 `/opt/cliproxyapi/`：`docker compose pull` + `up -d --force-recreate`，子命令 `--binary <path>`、`--rollback`、`--no-pull`、`--help`。Smoke test 用 `(echo > /dev/tcp/127.0.0.1/8317)` TCP 探测代替 HTTP 401 噪声。

**OpenResty 路由现状**：
- `/management.html` → 1Panel 静态面板（不动）
- `/management` → 302 → `/management.html`（导致 React 入口被劫持）
- `/v0/management/*` 和 `/` (catch-all) → proxy_pass http://127.0.0.1:8317

**SSH 障碍**：本地 sing-box TUN 拦截直连 22；最终走 xshell 内置端口转发隧道（本机 2222 → VPS 22），ssh `-p 2222 root@127.0.0.1`。

### 26.5 React 路径改名 /management → /cpa-management

**触发**：26.4 中发现 OpenResty 把 `/management` 锁给了 1Panel 静态面板，React SPA 入口被劫持。

**改动**：
- `frontend/vite.config.ts`：`base: '/cpa-management/'`
- `frontend/src/App.tsx`：`<BrowserRouter basename="/cpa-management">`
- `internal/api/frontend_embed.go`：所有路由前缀 `/management` → `/cpa-management`（NoRoute / explicit GET / assets）
- `internal/api/handlers/management/desktop.go`：`entrypoints.modern` → `/cpa-management/`

**结果**：
- `https://<your-cpa-vps-domain>/cpa-management` → 我的 React 面板 ✓
- `https://<your-cpa-vps-domain>/management.html` → 1Panel 原面板（保留不变）
- `https://<your-cpa-vps-domain>/extended.html` → 扩展面板 ✓

### 26.6 一键更新 CPA（系统页 + host watcher + systemd timer）

**架构**（避开"在容器内动 host 服务"的陷阱）：

```
[React 面板按钮] → POST /v0/management/system/update
                 ↓
       backend 写 /CLIProxyAPI/.update-trigger（mount from host）
                 ↓
       systemd timer 每 30s 检查 → 发现非空就跑 /opt/cliproxyapi/update-watcher.sh
                 ↓
       watcher 跑 update-cpa.sh、记 stdout 到 .update-log、写元数据 .update-meta.json
                 ↓
       前端轮询 GET /v0/management/system/status 看进度（每 5s 刷新当 pending=true）
```

**后端**（`internal/api/handlers/management/system_update.go`，新文件）：
- `GET /system/status` — 版本/commit/build_date/uptime/binary mtime/binary_size/update_pending/last_update meta
- `POST /system/update` — 写 trigger 文件排队（idempotent），返回 202 + queued_at
- `GET /system/update-log` — 读 host watcher 日志（最后 64 KB）

**前端**：
- `frontend/src/pages/System.tsx`（新页面）：版本卡 6 个 + 一键更新按钮（带确认）+ 最近一次更新结果（含镜像 SHA before/after）+ 可折叠 host watcher 日志查看，update_pending 时 5s 轮询
- `App.tsx` 加 `/system` 路由、Sidebar / CommandPalette 加 "系统/更新"（Wrench icon）

**VPS host 端**：
- `/opt/cliproxyapi/.update-trigger`、`.update-log`、`.update-meta.json` —— 三个 state 文件预创建（`touch` 必须先于 mount，否则 docker 当目录处理）
- `/opt/cliproxyapi/update-watcher.sh` —— 检查 trigger 非空就跑 update-cpa.sh，把元数据写到 .update-meta.json
- `/etc/systemd/system/cpa-update-watcher.{service,timer}` —— 已 enabled，每 30s 一次

**实测端到端**：
```
1) GET  /system/status              → 200
2) POST /system/update              → 202 queued
3) update_pending=true 持续 ~25s
4) update_pending=false 之后：
   - last_update.duration_sec = 17
   - success = true, exit_code = 0
   - image_changed = false (已是最新)
   - container uptime_sec = 19
5) GET  /system/update-log          → 完整 host watcher 日志
```

### 26.7 默认连接 URL 智能化

**问题**：`stores/connection.ts` 写死 `url: "http://127.0.0.1:8317"`，团队成员从 VPS 打开面板默认却试图连本地（无 CPA 跑），连成功只有自己电脑跑了一份的人。用户实测：浏览器显示 349 池子（本地）而不是 279 池子（VPS）。

**修复**：
- `defaultCpaUrl()` 函数用 `window.location.origin` —— VPS 部署面板默认填 `https://<your-cpa-vps-domain>`，本地填 `http://127.0.0.1:8317`
- `onRehydrateStorage` 钩子：检测 localStorage 残留的 `http://127.0.0.1:8317` 若来自非 localhost 页面则**自动迁移**到当前 origin（一次性，不影响刻意选 localhost 的用户）
- ConnectBar 当输入 URL ≠ 当前站点时显示 "📍 当前站点" 重置按钮

### 26.8 总额度统计（参考 Codex-Manager + 用户提议的"%汇总"框架）

**调研**：Explore agent 深读 `Codex-Manager/crates/service/src/usage/usage_aggregate.rs`：
- "总额度" 实质是**全账号平均剩余百分比**（非 token 数 / 美元数）
- 关键的 free-plan 窗口 reroute 规则：账号若只有 primary 窗口 + 是 free OR window>1440min（>1天）→ 归到 secondary 桶
- bucket count 跟着账号"有效窗口"

**后端**（`codex_quota.go` summary 扩展）：
- 加 `avg_secondary_used` / `avg_secondary_remaining`（之前只有 primary）
- 加 `primary_capacity_*` / `secondary_capacity_*` —— **账号当量 (Account-Equivalent, AE)**：1 AE = 1 个账号的完整窗口容量。比纯百分比直观（"还剩 243 AE 可用" vs "平均剩余 97.1%"）
- 实现 free-plan reroute（quotaJob 增加 `planType` 字段从 `auth.Attributes["plan_type"]` 取值）
- bucket count 跟着账号有效窗口

**前端**（`Dashboard.tsx`）：
- 新增 "⚡ Codex 池总额度" 卡片，**默认不自动加载**（10-30s 慢调用），点按钮才查
- **第一层 AE 框架**：5h / 7d 池子剩余 AE + 平均剩余% + idle/>50%/<20% bucket
- **第二层 %汇总框架**（用户提议）：Σ(剩余%) / (N×100%)，例 251 个账号 → "24376% / 25100% = 97.1% 剩"。数学上 = AE × 100%（等价），但读起来是 "整池剩 97.1%" 而不是 "243 AE / 251 AE"，给团队同事不同视角

**排除规则**（用户后续要求"出错/需重登录不算入"）：
- 之前只过滤 `disabled` + `e.Error != ""`（fetch 失败）
- 加：`status == "error"` 或 `status_message` 含 reloginKeywords (`unauthorized` / `refresh_token_reused` / `invalid_grant` / `session expired` / `sign in again`) → `needs_relogin` 计数，不进总额度
- summary 多一个 `needs_relogin` 字段；前端"可用账号"卡副标题加 "X 需重登录（不计入额度）"

**VPS 实测**：
```json
{
  "total": 281, "success": 251, "failed": 30, "disabled": 0, "needs_relogin": 0,
  "secondary_capacity_total": 251,
  "secondary_capacity_used": 8.65,
  "secondary_capacity_remaining": 242.35,
  "avg_secondary_remaining": 96.6,
  "idle_count": 157, "above_50pct_count": 250, "below_20pct_count": 0
}
```

整池 251 个 free 账号全部 reroute 到 secondary 7d 桶；用了 8.65 AE，剩 242.35 AE，约 97% 容量。

### 26.9 数据汇总（这次 session 的总改动）

**新文件**：
- `internal/api/handlers/management/pool_models.go`
- `internal/api/handlers/management/system_update.go`
- `internal/api/handlers/management/pricing_test.go`
- `frontend/src/pages/PoolModels.tsx`
- `frontend/src/pages/System.tsx`
- `frontend/src/stores/connection.ts` 中新 `defaultCpaUrl()` + `onRehydrateStorage` 迁移逻辑
- VPS：`/opt/cliproxyapi/update-cpa.sh`、`/opt/cliproxyapi/update-watcher.sh`、`/etc/systemd/system/cpa-update-watcher.{service,timer}`

**修改文件**：
- `internal/registry/models/models.json`：gpt-5.5-instant 添加→删除
- `internal/registry/model_definitions.go`：codexBuiltinInstantModelID 注释
- `internal/registry/model_registry.go`：`GetPoolModelsSummary()`
- `internal/api/handlers/management/codex_quota.go`：summary 扩展 + 排除规则
- `internal/api/handlers/management/token_stats.go`：pricingTable 全量同步 + 35+10+17 测试
- `internal/api/handlers/management/desktop.go`：modern 入口
- `internal/api/frontend_embed.go`：路径前缀 `/cpa-management`
- `frontend/vite.config.ts`、`frontend/src/App.tsx`、`Sidebar.tsx`、`CommandPalette.tsx`、`Dashboard.tsx`、`stores/connection.ts`、`api/types.ts`、`api/queries.ts`、`components/layout/ConnectBar.tsx`
- VPS：`/opt/cliproxyapi/docker-compose.yml`（5 条新 mount）

**新增 API 端点**（`/v0/management/`）：
- `GET /pool-models` — 全池模型聚合
- `GET /system/status` — 系统状态 + 最后一次更新元数据
- `POST /system/update` — 一键触发 host 端 update-cpa.sh
- `GET /system/update-log` — 读 host watcher 日志
- `codex-quota` summary 扩展：`avg_secondary_*` / `*_capacity_*` / `needs_relogin`

**测试**：
- `go test ./internal/registry/... ./internal/api/handlers/management/... ./internal/runtime/executor/...` 全过
- `pricing_test.go` 52 个 case 全通

### 26.10 启示

1. **Docker bind-mount 是覆盖镜像内文件的最干净方式** —— 比 Dockerfile FROM + COPY 还省事，对方 `docker compose pull` 取上游也盖不掉，前提是 host 文件先存在（state 文件需 `touch` 预创建）。

2. **从容器内驱动 host 操作的最简模式 = trigger 文件 + systemd timer**。比挂载 docker.sock + 容器内装 docker CLI 安全得多；比 webhook 守护进程也简单。代价是有 ≤30s 的延迟，对于"按钮触发的更新"这是可接受的 UX。

3. **测试 prefix-match pricing 表必须包含带后缀的真实 id**（如 `gpt-5.4-mini-2026-03-17`），否则覆盖不全 prefix 之间的相互蚕食。`gpt-5.5-instant` 误命中 `gpt-5.5` 是验证后才发现的。

4. **跨 origin 的 React 面板必须用 `window.location.origin` 作为 connect URL 默认**，不能写死 localhost。zustand-persist 的 `onRehydrateStorage` 钩子是迁移老用户的好钩子。

5. **OpenAI 的 codex OAuth 后端 ≠ platform.openai.com API**：模型白名单不同（codex 拒收 instant），鉴权方式不同（OAuth vs sk-...）。同一个 model id 在两条入口的可用性不能假设一致。

---

## 27. Codex-Manager API/UX 二次吸收：请求历史 + 账号维护汇总（2026-05-07）

本次按用户要求重新阅读 `docs/`、overlay、Codex-Manager 和 CLIProxy API，挑选已经证明有运维价值、且适合 CPA 架构的能力继续吸收到 overlay。重点不是照搬 CM 的 SQLite/RPC，而是把它的"可查询、可筛选、可批量维护"体验落到 CPA 的 REST + 文件账号体系里。

### 27.1 后端新增/增强

**请求历史 `/v0/management/request-history`：**
- `RequestRecord` 新增 `method/path/status_code/alias/auth_index/auth_type/source/api_key_hash`，从 `usage.Manager` 的 Gin context 和 usage record 中提取；API key 只存 SHA256 前 16 位，避免泄漏原始 key。
- 查询参数补齐 CM 风格能力：`limit`、`offset`、`q`、`status`、`model`、`provider`、`failed`、`after_ts`、`before_ts`。
- response 增加 `total/limit/offset`，`summary` 改为按完整过滤结果汇总，而不是只汇总当前页。

**账号维护汇总 `/v0/management/auth-files/maintenance-summary`（新文件 `account_maintenance.go`）：**
- 返回 `summary`：total/active/ready/disabled/unavailable/error/needs_relogin/unavailable_free/problem。
- 返回 `counts`：providers/groups/tags/plans，供前端构建过滤器和维护概览。
- 返回 `candidates`：needs_relogin/unavailable_free/problem 的文件名列表。这里刻意只提供候选，不新增"直接删除不可用账号"端点，避免 Codex-Manager 的一键清理在 CPA 文件账号体系里误删。

### 27.2 前端 UX 调整

**Request History 页面：**
- 增加搜索框、状态过滤（success/failed/2xx/4xx/5xx）、模型/provider、时间范围、分页。
- 表格显示 HTTP status badge、method/path、alias、source/key hash 等定位信息。
- 顶部汇总卡按当前过滤条件展示成功/失败、tokens、缓存命中和预估费用。

**Accounts 页面：**
- 接入 `fetchAuthMaintenanceSummary`，顶部显示总账号、需重登录、不可用 Free、问题账号、分组/标签数量。
- 分组和标签过滤器来自后端 counts，避免前端猜测。
- 维护类 tile 可点击，直接选择服务端返回的候选账号，再由用户决定禁用/删除/测试，批量操作后会同时刷新账号列表和 maintenance summary。

### 27.3 Overlay 与脚本

- `overlay/refresh-overlay.bat` 与 `overlay/verify-overlay.bat` 增加对 Windows 保留设备名 `NUL` 的显式跳过，防止无法读取/删除的 untracked 条目进入 overlay。
- 已刷新 overlay 快照：当前为 33 个 CPA 新文件、13 个 patch。
- `frontend/dist` 已重新构建并同步到 `CLIProxyAPI/internal/api/frontend_dist/`，用于 `embed_frontend` 构建。

### 27.4 新增测试

- `TestRequestLogPlugin_EnrichesHTTPContextAndHashesAPIKey`
- `TestGetRequestHistory_SearchStatusAndPagination`
- `TestGetRequestHistory_TimeRangeFilters`
- `TestGetAuthFilesMaintenanceSummary_CountsAndCandidates`

### 27.5 验证

本节改动完成后执行：

```powershell
cd CLIProxyAPI
go test ./internal/api/handlers/management -count=1
go test ./internal/registry/... ./internal/api/handlers/management/... ./internal/runtime/executor/... -count=1
go build -tags embed_frontend -o $env:TEMP\cli-proxy-api-verify.exe .\cmd\server\

cd ..\frontend
pnpm run build

cd ..
overlay\verify-overlay.bat
```

结果：
- management 包测试通过。
- registry / management / runtime executor 相关测试通过。
- React `pnpm run build` 通过。
- `embed_frontend` Go build 通过，临时产物 54,325,248 bytes。
- `overlay\verify-overlay.bat` 通过，overlay 与 CPA tree 一致。

### 27.6 设计取舍

1. **吸收查询体验，不搬 SQLite。** CPA 当前的部署优势是轻量文件化，`request-history` 用固定窗口持久化已经覆盖排障主场景；长期审计库仍是 CM 的强项。
2. **维护候选由服务端算，破坏性动作仍由用户确认。** `maintenance-summary` 给前端准确的候选集合，但不提供不可逆的一键删除端点。
3. **新后端功能继续走 route registry。** `account_maintenance.go` 用 `init() { RegisterExtensionRoute(...) }` 注册，避免再扩大 `server.go` patch。

---

## 28. Token 使用统计：总览 + 按 API Key 聚合（2026-05-07）

### 28.1 需求

用户要求在 Token 使用统计页加入：
- **总览**：快速看今日、累计、Top 账号、Top API Key、失败率。
- **按 API Key 计算**：不是只看账号文件，而是能按 API Key 维度汇总 token、费用和请求数。

### 28.2 后端改动

- `token_stats.go` 的 per-entry JSON 新增 `api_key_hash`，来源为 usage record 中的 API key，经 SHA256 后取前 16 位；不返回原始 key。
- token stats 持久化快照 `token_stats.json` 的 entry 同步新增 `api_key_hash`，旧快照兼容为空。
- `GetTokenStats` 在 auth manager 可用时，会从 API key auth 的 `AccountInfo()` / `Attributes["api_key"]` 补齐旧 entry 的 hash。

新增回归测试：
- `TestGetTokenStats_IncludesAPIKeyHash`：先确认旧实现缺失 `api_key_hash` 会失败，再实现通过，确保前端 API Key 聚合有可靠字段且不泄漏原 key。

### 28.3 前端改动

`frontend/src/pages/TokenStats.tsx` 新增三种视图：
- **总览**：今日统计、累计统计、账号条目数、API Key 数、Top 账号、Top API Key、失败率。
- **按账号**：保留原有 Top 账号图表和账号明细表。
- **按 API Key**：按 `api_key_hash` 聚合 `TokenStatEntry`，显示 provider、关联账号数、输入/输出/缓存/推理/总 token、预估费用、成功/失败请求、最后使用时间。

`frontend/src/api/types.ts` 的 `TokenStatEntry` 新增 `api_key_hash?: string`。

### 28.4 Overlay

- 已重新运行 `overlay\refresh-overlay.bat`。
- overlay 新增文件数从 33 → 34（新增 `token_stats_api_key_test.go`），patch 数仍为 13。
- 最新 `frontend/dist` 已同步到 `CLIProxyAPI/internal/api/frontend_dist/`。

### 28.5 验证

已执行：

```powershell
go test ./internal/api/handlers/management -run TestGetTokenStats_IncludesAPIKeyHash -count=1
go test ./internal/api/handlers/management -count=1
pnpm run build
```

结果：
- API key hash 回归测试通过。
- management 包测试通过。
- React/TypeScript/Vite 构建通过。

## 29. 三件运维提效功能：批量重登 / API Key 限额 / Discord webhook（2026-05-07）

### 29.1 背景

实测发现池中 282 个 codex 授权里有 28 个状态为 needs_relogin（access_token 还能用、refresh_token 已废）。手工一个个走 OAuth 太慢；同时担心未来某个泄漏的 API key 会把整池 token 烧光，目前没有任何按 key 维度的限额或告警。本节是 1.5 个工作日内顺序落地的三件功能。

### 29.2 批量 OAuth 重登

**后端**（`internal/api/handlers/management/oauth_repair.go`）

- 新增 `POST /v0/management/oauth/repair-session-batch`
- Request body：`{ provider?, mode?, targets: [{provider?, target_name, mode?}, ...] }`
- 单次调用最多 200 个 target；缺 provider/缺 target_name 的 slot 标 `error` 但不 abort 整个 batch
- Response：`{ sessions: [{target_name, provider, session?, error?}, ...], total, succeeded, failed }`
- 同时发布 `oauth.session_created`（每个 session）和 `oauth.batch_created`（批次摘要）两类事件供 webhook 派发器订阅
- 测试：`TestOAuthRepairSessionBatch`（4-target 含 2 valid + 2 error）+ `TestOAuthRepairSessionBatchValidation`（空 targets 数组返 400）

**前端**（`frontend/src/components/BatchReloginDialog.tsx` 新文件 + `Accounts.tsx` 加按钮）

UI 三阶段：
1. **Review**：列出 needs_relogin 候选 + 全选/清空 + 「开始」
2. **Running**：调 batch 端点拿 N 个 session 元数据 → 进入循环：mint 当前 session 的真实 OAuth URL → `window.open(url, "cpa-oauth")` 复用同一 tab → 每 4s 拉 `auth-files/maintenance-summary` 检测目标是否离开 needs_relogin 列表 → 自动推进 / 用户「我已完成」/ 用户「跳过」
3. **Summary**：✅完成 / ⏭跳过 / ❌失败 三栏统计 + 未完成清单

进入按钮：`Accounts.tsx` 的快速选择栏新增 primary 按钮 `🔁 批量重登 (N)`，N 来自 maintenance-summary.needs_relogin。

### 29.3 per-API-Key 软限额

**设计权衡**：v1 选择"软限额"（展示 + 告警，不拦截）。硬 middleware 429 拦截需要 patch CPA 上游 server.go，会破坏 overlay 增量升级；软限额完全在 overlay 内，零侵入。后续如需硬拦截作为 v1.1 再考虑加 patch。

**后端**

- 新文件 `api_key_limits.go`：
  - 持久化：`<auth-dir>/api-key-limits.json` 数组
  - `APIKeyLimit` 字段：`id, key_hash, name, key_preview, daily_token_limit, enabled, note, created_at, updated_at`
  - 端点：`GET /api-key-limits`（列表 + 当日用量 + status: ok/warn/exceeded/disabled/unused）/ `PUT /api-key-limits`（按 hash 或 key 创建/更新）/ `DELETE /api-key-limits/:hash`
  - PUT 接受 `{ key }` 时服务器侧 SHA256 hash 后只存 hash + preview，不持久化原 key
  - Response 同时返回 orphans（活跃但未配限额的 hash）
- `token_stats.go` 扩展：
  - 加 `apiKeyDaily map[string]*apiKeyDailyBucket`（按日重置）
  - `recordAPIKeyDaily()` 在每次 HandleUsage 时累加
  - `notifyAPIKeyQuotaIfNeeded()` 检测跨过 80% / 100% 时发布 `alert.api_key_quota_warn` / `alert.api_key_quota_exceeded`，每天每 hash 每 level 只发一次（防刷）

**前端**（`frontend/src/pages/ApiKeyLimits.tsx` 新文件 + Sidebar 入口）

- 概览栏：配置数 / 启用中 / Warn (≥80%) / Exceeded / 今日累计 tokens / 未管理 (orphan)
- 限额表：Status pill（5 种颜色）+ name + hash + preview + Used/Limit + 进度条 + 编辑/删除
- Orphans 表：未管理但今日有流量的 hash 列表，「+ 添加限额」一键预填 hash 进入编辑对话框
- 编辑对话框：原始 key 输入框（可选，自动 hash） + 5 个常用上限快捷按钮 (100K / 500K / 1M / 5M / 10M) + enabled 开关

测试：`TestAPIKeyLimitsCRUD`（创建/更新/列表/删除）+ `TestAPIKeyLimitsValidation`（缺 hash/负数限额）+ `TestAPIKeyLimitsThresholdNotification`（验证 80% 和 100% 跨线各发一次，重复推送被去重）。

### 29.4 Discord webhook 派发器

**后端**（`internal/api/handlers/management/webhooks.go` 新文件）

- 持久化：`<auth-dir>/webhooks.json`
- `Webhook` 字段：`id, name, url, provider="discord", events[], enabled, last_error, last_sent_at`
- 端点：`GET /webhooks` / `PUT /webhooks` / `DELETE /webhooks/:id` / `POST /webhooks/:id/test`（手动触发）/ `GET /webhooks/:id/deliveries`（最近 50 条投递记录）
- URL 校验：必须以 `https://discord.com/api/webhooks/` 等四种 Discord 域名前缀开头
- 派发器：
  - 启动时（lazy on first ensureLoaded）`subscribe()` 全局 event bus，goroutine 长跑
  - 每个 event 检查所有 enabled webhook 的 `events[]` 订阅
  - 60 秒 dedup window：相同 webhook + event_type + payload-hash 的事件不重复发
  - 单次 POST 超时 8s
- Discord embed 格式化：5 种事件类型分别配色（warn 橙 / exceeded 红 / batch 蓝 / update 绿 / test 紫），payload map 字段自动转 inline fields

**已订阅的事件类型**（`KnownWebhookEvents`）：
- `alert.api_key_quota_warn` / `alert.api_key_quota_exceeded`（来自 §29.3）
- `oauth.batch_created`（来自 §29.2）
- `system_update.completed`（v1.1 加：目前 system_update.go 不直接 publish，需 host watcher 改写 meta 后由后端轮询发出）

**前端**（`frontend/src/pages/Webhooks.tsx` 新文件 + Sidebar 入口）

- Webhook 卡片网格（双列）：名称 + enabled badge + URL preview + 订阅事件 chips + last_sent_at + last_error + 4 个操作按钮（🚀测试 / 📋投递记录 / 编辑 / 删除）
- 编辑对话框：name + Discord URL（带占位符提示路径）+ 事件勾选列表（带中文标签）+ enabled 开关
- 投递记录对话框：5s 自动刷新，按状态着色（ok 绿 / error 红 / skipped 灰），含 HTTP code、耗时、错误截断显示

测试：4 个测试 — `TestWebhooksCRUD` + `TestWebhooksValidation` + `TestWebhooksTestEndpointHitsURL`（用 `httptest.NewServer` 真实抓 POST 验证 Discord 格式）+ `TestWebhooksDispatchOnEvent`（验证 60s 去重：同 hash 重复发一次仅推一次）+ `TestIsValidDiscordWebhookURL`。

### 29.5 部署

```powershell
# 1. 前端编译 + 同步到 embed 目录
cd frontend; pnpm run build

# 2. Linux 二进制（CGO=0、-trimpath、-ldflags='-s -w'）
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
go build -tags embed_frontend -trimpath -ldflags='-s -w' -o ../artifacts/CLIProxyAPI-linux ./cmd/server

# 3. SCP via xshell port forward 2222 → VPS:22
scp -i ~/.ssh/dmit_id_rsa -P 2222 artifacts/CLIProxyAPI-linux root@127.0.0.1:/opt/cliproxyapi/CLIProxyAPI.new

# 4. 部署 + 自动备份
./update-cpa.sh --no-pull --binary /opt/cliproxyapi/CLIProxyAPI.new
```

二进制：40,898,722 bytes / SHA256 `1759E693D507E6EDDCA62801FC56FDF4317D5E2F619B2C13ABB3040D46E8A911`，备份为 `CLIProxyAPI.bak.20260507-102629`。

**端点冒烟（全过 Cloudflare → OpenResty → CPA）**

| 端点 | 状态 |
|---|---|
| `POST /oauth/repair-session-batch` | 200，单 target 返回 `{succeeded:1, failed:0}` |
| `GET /api-key-limits` | 200，`note` 字段含中文软限额说明 |
| `GET /webhooks` | 200，`known_events` 含 4 个事件 |
| `PUT/DELETE` 两组 CRUD round-trip | 全部 200，写入 `auths/api-key-limits.json` 和 `auths/webhooks.json` |
| 既有 6 个端点 | 全部 200（无回归） |

前端嵌入产物：
- `ApiKeyLimits-Bn1Je1Lj.js` 9.99 kB / 3.76 kB gzip
- `Webhooks-9YDLhOX1.js` 9.56 kB / 3.50 kB gzip

### 29.6 Overlay

- 新增文件：`api_key_limits.go` / `api_key_limits_test.go` / `webhooks.go` / `webhooks_test.go`
- 修改文件（保持不变的 patch list）：`oauth_repair.go` / `oauth_repair_test.go` / `token_stats.go` 由 refresh-overlay 直接覆盖（这些原本就是 overlay 文件不需要 patch）
- overlay 文件总数：34 → 38（+4）
- patch 数：13（不变）
- 已运行 `overlay/refresh-overlay.bat` 同步

### 29.7 经验

- **零侵入优先**：API Key 限额最初考虑硬 middleware 拦截，但会要求 patch server.go 中间件链。改成软限额后，全部 logic 都在 overlay 文件里，未来 CPA 上游升级不用顾虑这块。
- **事件总线复用**：现有 `globalManagementEvents` SSE 事件总线已经具备发布/订阅能力，webhook 派发器只需 `bus.subscribe()` 拿到 channel 就完成接入，没多写一行新基础设施。
- **dedup window 必备**：第一次实现没加 60s 去重，单元测试就重现了高频事件被刷屏的场景。dedup key 由 `webhook_id + event_type + payload_id_field`（hash 或 target）组成，确保不同主体的事件分别能透出。
- **Discord webhook URL 校验偏严**：只接受 4 种官方域名前缀，避免误打到任意 endpoint。如果未来支持 Slack / Lark，再走 `provider` 字段分支。
- **批量 OAuth 单 tab 复用**：`window.open(url, "cpa-oauth")` 第二个参数同名 → 浏览器会刷新已有 tab 而不是新开，这是 28 账号一气呵成的关键 trick。

---

## §30. 12 模块运维层全量实施 + 部署修复（2026-05-07 → 2026-05-08）

按 `docs/OVERLAY_FEATURE_MODULES_DESIGN.md` 实施 12 个 P0/P1/P2/P3 模块，并完成版本注入、UI 假象修复、bulk-refresh 限流等三轮 VPS 部署迭代。

### 30.1 设计文档审查与改写

实施前对 `OVERLAY_FEATURE_MODULES_DESIGN.md` 做了完整审查，发现并修复 20 个问题。

**严重 / 与现状直接冲突**
1. §1.2 路径错误：原文说"在 `internal/api/handlers/management/` 新建文件"，但 overlay 模型下应是 `overlay/files/internal/api/handlers/management/`。新人按字面意义建文件会写到 CPA 上游 tree 上，下次 `update-cpa.bat` 被覆盖。
2. §7.2 `POST /routing/explain` 已存在且语义不兼容设计：现有实现不读 body、直接遍历 `manager.List()`，文档把它写成接受 `{provider, model, ...}` 入参的 simulator。改为：保留 `/explain` 不变，新增 `POST /routing/simulate` 承担入参/模拟职责。
3. §8 "AE" 单位未定义：response 用 `secondary_capacity_remaining_ae` 但全文没解释。补：1 AE = 一个账号 7d secondary 满额，5h primary 不参与 AE 聚合，单独以 `primary_pressure_pct` 报告。

**概念 / 一致性问题**
4. §3.3 vs §8.4 风险词复用：`level=healthy/warning/critical` 与池容量 `risk` 同名易混淆。改为池容量用 `green/amber/red/unknown`。
5. §4.5 apply 凭据缺字段：要求"apply 必须带 dry-run 返回的 action IDs"，但 §4.2 dry-run 响应没 `id`。补：dry-run 返回 `dry_run_token` (TTL 10 min) + 每 action 稳定 `id`。
6. §3.3 reason 重复扣分：oauth 失效场景下 `status_error + needs_relogin + unavailable` 同时触发会被扣三次。补：reason 归并组（`oauth_broken / failure_rate / quota`），同组只保留 severity 最高者。

**API / 持久化层细节**
7. §10.2 备份目录前缀语义不清（`auths/` vs `<auth-dir>` 占位）；备份依赖未实现的 `audit_log.jsonl`，需"缺失文件静默跳过"。
8. §6.4 `unused_30d` 在没有 SQLite 时无法计算（ring buffer 远小于 30 天）；改为 `unused_within_window` + `window_seconds` 自描述。
9. §11.3 `/diagnostics.zip` URL 风格与 §15.1 不一致；改为 `/system/diagnostics/export.zip`。
10. §14.3 SQL 缺索引（千万级数据没 ts/auth_id/api_key_hash 索引会拖死）；补 `idx_*` + retention 策略。
11. §14.4 配置项 `overlay:` 命名空间会污染上游 `config.yaml` schema；改为独立文件 `<config-dir>/overlay.yaml`。

后续每条修复都落到改写后的文档。详情见审改写的 20 个问题清单。

### 30.2 包 A：账号运维核心（P0 + audit log 提前）

**§3 Account Health Diagnostic Center**

文件：
- `overlay/files/internal/api/handlers/management/account_health.go` (+_test.go) — 8 个测试用例覆盖 healthy/relogin/disabled-only/reason-merging/quota/api-key-skip/failure-rate/get-by-name
- `frontend/src/pages/AccountHealth.tsx` — sidebar/command palette 入口

后端逻辑：
- `mergeReasons()` 实现 reason 归并组（oauth_broken / failure_rate / quota），同组只保留 severity 最高者
- `computeAccountLevel()` 强制覆盖：`needs_relogin → critical`、`disabled-only → warning`、API Key auth 不扣 quota 分（无 quota 快照即跳过）
- quota 数据走 `loadCodexQuotaSnapshotFor(auth.ID)` 内存缓存，由 `GetCodexQuota` 末尾 `saveCodexQuotaSnapshot(entries)` 注入；账号健康端点本身**不调用 wham API**
- 5 个 candidate buckets：`relogin / disable / warmup / delete_review`

前端：summary cards / 筛选 / 行链接到详情页 / 批量候选区一键 warmup / 复制清单到剪贴板。

**§4 Maintenance Rules dry-run**

文件：`maintenance_rules.go` (+_test.go) — 5 个测试覆盖 CRUD / 字段校验 / dry-run 匹配 / apply token 校验 / 持久化 reload。

设计要点：
- 持久化 `<auth-dir>/maintenance-rules.json`
- `dry_run_token`（dr_<unix>_<hex8>）TTL 10 min，dry-run 返回 token + 每 action 稳定 id
- apply 必须带 `{dry_run_token, action_ids[], confirmed?}`，过期返 422
- 高风险动作（high）必须 `confirmed=true`
- v1 不引入自动调度执行；apply 必须用户在 UI 显式点击

apply 内部分发：通过 `httptest.NewRecorder` + 合成 gin context，把 apply 翻译成对现有 batch endpoint 的调用（status-batch / fields-batch / warmup / oauth/repair-session-batch），既不重新实现也保留 audit hook。

支持的条件字段（13 个）：level / score / needs_relogin / unavailable / disabled / failure_rate_24h / requests_24h / quota_primary_remaining / quota_secondary_remaining / last_success_age_hours / provider / group / tag。

支持的动作（9 种）：select / warmup / disable / enable / move_group / add_tag / lower_priority / relogin / delete（v1 不执行，仅入 delete_review 候选）。

**§9 Audit Log 提前实施**（按设计文档建议从 P2 提前到 P0 之后）

文件：`audit_log.go` (+_test.go) — 4 个测试覆盖追加查询 / no-secret-leak / handler 包装 body 重注入 / action filter。

核心设计：
- 持久化 `<config-dir>/data/audit_log.jsonl`，10000 条 ring buffer + JSONL append
- bearer token 永不入库，仅记录 SHA256 前 16 字符指纹
- `auditingHandler(action, target, extractIDs, inner)` / `auditingHandlerParam(action, target, paramName, inner)` 包装器，**body 缓冲后 re-inject** 给下游 handler 用
- 已挂在 9 处破坏性端点：status-batch / delete-batch / fields-batch / warmup / token-stats reset / request-history clear / api-key-limits CRUD / webhooks CRUD/test / system update / oauth repair / maintenance rule apply
- `GET /audit-log` 支持 q/action/target/after_ts/before_ts 过滤；`GET /audit-log/export.csv` ISO 时间 + 标准列

前端：`pages/AuditLog.tsx`（sidebar 单独入口，30s 自动刷新）。

**§13 账号详情独立路由**

`/cpa-management/accounts/:encodedName` → `pages/AccountDetail.tsx`，重用 `fetchAccountHealthOne` 端点 + warmup/disable/enable mutations，含跳转到该账号的请求历史/quota/审计日志的快捷链接。

### 30.3 包 B：成本与限额

**§5 Token Reports Center**

`token_reports.go` (+_test.go) — 4 测试覆盖 summary / by-api-key+by-provider / truncated 标志 / CSV 不泄漏 raw key。

5 个聚合维度：summary / by-model / by-provider / by-api-key / by-account；range 24h/7d/30d；当 ring buffer 实际覆盖时间 < 请求 range 时 response 顶层 `truncated:true` + `actual_range_seconds`，前端 alert 提示需启 SQLite。

`GET /token-reports/export.csv` UTF-8 无 BOM、ISO 时间戳、`estimated_usd` 6 位小数、永不输出原始 API key（仅 `api_key_hash`）。

前端 `pages/TokenReports.tsx`：StatsGrid 总览 + 5 个 tab + 显示 Top 50 + CSV 导出链接。

**§6 API Key Insights**

`api_key_insights.go` — 合并 `api-key-limits.json` 配置 + 请求历史 24h/7d/today 分桶；状态 ok/warn/exceeded/unused/high_failure；**`unused_within_window` + `window_seconds`** 取代固定 30d，避免 ring buffer 短窗口下误判。

前端 `pages/ApiKeyInsights.tsx`：summary cards + 表格按 7d tokens 排序，含状态 badge 和 reasons 列。

**§7 Routing Lab simulate**

`routing_lab.go` — `POST /routing/simulate`（**保留旧 /routing/explain 不变**）；`quota_mode` 默认 `cached`（仅读 conductor 内存 + `/codex-quota` 缓存），`fresh` 当前等同 cached（v1 暂不主动重拉 wham）；reason 词表与 skip_reason 词表分离便于前端着色。

前端 `pages/RoutingLab.tsx`：左侧 6 个输入字段 + 右侧候选表格（score / reasons / skip_reasons）。

**§8 Capacity Forecast**

`capacity_forecast.go` — AE 单位明确定义；只用 secondary 7d 窗口算容量；primary 5h 窗口单独以 `primary_pressure_pct` 报告（不参与 AE 聚合）；`pool_risk` 走 `green/amber/red/unknown` 区分账号级 health level。`recommendations` 字段根据风险等级自动给出建议文案。

前端 `pages/CapacityForecast.tsx`：StatsGrid + 分组明细表 + 推荐文案。

### 30.4 包 C：部署治理 + P3

**§10 Backup & Restore**

`backups.go` — auth+config+data 打包成 zip 落到 `<config-dir>/data/backups/<id>.zip` + manifest；缺失文件静默 skip 并记入 manifest.skipped；preview-restore 返回 `preview_id` (TTL 10 min) + will_create/will_update 列表；restore 必须带未过期的 preview_id 才执行，且**自动先做 pre_restore 备份**；保留最近 20 个，超出自动 prune；解压时拒绝 path traversal。

前端 `pages/BackupCenter.tsx`：列表 + 创建按钮 + 预览对话框（will_create / will_update / conflicts 三栏）+ 二次确认 restore。

**§11 System Diagnostics**

`system_diagnostics.go` — `GET /system/diagnostics` 聚合 binary_hash / OS / Go 版本 / uptime / 各目录读写检查 / overlay 特性清单 / update.log tail / 白名单 env 变量；`/system/diagnostics/export.zip` 含脱敏 config.yaml + diagnostics.json + audit_log.json + update.log（Bearer/sk- 模式 mask 后）+ overlay_features.txt + README.txt。

`redactConfigYAML()` 用正则匹配 `key|token|password|secret` 模式覆盖值；`redactText()` 用 `bearerPattern`/`openAIKeyPattern` 模糊匹配。

前端 `pages/SystemDiagnostics.tsx`：常驻显示 + 一键导出 .zip 按钮。

**§14 SQLite 分析库（scaffold）**

`overlay_config.go` — 解析 `<config-dir>/overlay.yaml`（手写极简 YAML 解析器，避免引入新依赖）；`/analytics/storage-summary` 暴露 `sqlite_enabled / sqlite_compiled: false / sqlite_path / sqlite_retention_days`。

v1 不绑 SQLite 驱动（modernc.org/sqlite 是大依赖、go-sqlite3 需 CGO，不应贸然引入）；`overlay.yaml` 配置 + 报告路径已铺好，等团队对 SQLite 选型决策后再补驱动绑定。

### 30.5 部署相关基础设施

**新增端点**

`GET /v0/management/system/check-upstream`（system_update.go）— 调 GitHub API 拉 `router-for-me/CLIProxyAPI` 的 latest release tag，对照本地 `buildinfo.Version` 判断 `update_available`/`version_uncertain`。

`GET /v0/management/pricing`（`pricing_view.go`）— 暴露进程内 `pricingTable`（USD per 1M），按前缀长度排序（与 lookupPricing 的最长子串匹配规则一致），便于在浏览器核对官方定价；`reasoning` 列若与 `output` 相同标 *(继承)*。

前端 `pages/Pricing.tsx`（侧栏「定价表」）+ System.tsx 新增"🔍 上游版本"卡片（手动按钮触发查询）。

**Bulk refresh 限流**

发现 282 个 codex 账号点击"刷新全部 Token"后日志狂刷 `refresh_token_reused`：上游 `Manager.TriggerRefreshAll` 一次 `go m.refreshAuth(...)` × 282，**没有任何并发限制**，瞬时撞 auth.openai.com 触发限流误报。

修复：新增 `overlay/files/sdk/cliproxy/auth/bulk_refresh_throttled.go`，给 `Manager` 加导出方法 `TriggerRefreshAllThrottled(ctx, concurrency)`，用 8 个 worker 串行跑同一个 `m.refreshAuth(id)`（**这是把 overlay 文件首次放到 `sdk/cliproxy/auth/` 包下** —— 同 package 可直接调用 unexported 方法 `refreshAuth`）。

`overlay/files/internal/api/handlers/management/jobs.go` 的 `newRefreshTokensJob` 改为后台 `go manager.TriggerRefreshAllThrottled(ctx, 8)` 触发；前端 `waitForManagementJob` 默认 `maxIterations` 30 → 120，避免 282 账号 × 8 并发 ≈ 35-70s 跑不完就 timeout 误报全失败。

**Frontend bug 修复**

1. `Badge.tsx` AuthStatusBadge：`status === "active"` 检查放在 `needsRelogin(statusMessage)` 之前。原逻辑里 stale `statusMessage` 会盖过当前 active 状态，所有有过 401 历史的账号都误显"需重登录"。
2. `Accounts.tsx` 🔑 重登按钮：加 `status !== "active" && status !== "ready"` 前置条件，与 badge 一致。
3. `account_maintenance.go` `authNeedsRelogin()`：先看 `auth.Status`，active/ready 直接 return false。conductor 在每次成功 op 后会清 `LastError + StatusMessage` 并 set Status=active，此函数应信任 status 优先。
4. `AccountHealth.tsx` 等：`item.reasons.forEach`/`item.reasons.length` 改成 `(item.reasons ?? [])` 防御。Go nil slice 序列化成 JSON `null` 而非 `[]`，前端 useMemo 会爆 `Cannot read properties of null`。后端 `mergeReasons` / `AccountHealthCandidates` 全部改为返回 non-nil `[]HealthReason{}`。

**Build 时版本注入**

发现上游 `cmd/server/main.go:38-41` 有自己的 `Version`/`Commit`/`BuildDate` package-level vars，启动时再 `buildinfo.Version = Version` 复制过去。所以 ldflags 目标是 `main.Version` 而不是 `internal/buildinfo.Version`。

正确的 cross-compile 命令：

```bash
VERSION=$(git describe --tags --always)
COMMIT=$(git rev-parse --short HEAD)
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags embed_frontend \
  -ldflags="-s -w -X main.Version=$VERSION-overlay -X main.Commit=$COMMIT -X main.BuildDate=$BUILD_DATE" \
  -o ../cli-proxy-api-linux ./cmd/server/
```

注 `-overlay` 后缀以区分纯上游构建。

### 30.6 三轮 VPS 部署

通过 xshell 端口转发 (root@127.0.0.1:2222) + `update-cpa.sh --binary <path> --no-pull` 部署。每轮约 ~5s 容器重启。

| 轮次 | sha256 | 内容 | 结果 |
|------|--------|------|------|
| 1 | `8c43fb70…` | 12 模块全量 + 版本注入 | smoke OK，282 clients 加载，9 新端点全 401 |
| 2 | `8c43fb70…` 后续 | AuthStatusBadge / authNeedsRelogin / forEach 修复 | 浏览器 30 个真实需重登 |
| 3 | `6ec62206…` | throttled bulk refresh + frontend polling 120s | 解决"全部 401 假象" |

每轮自动留备份：`CLIProxyAPI.bak.20260508-020214` / `…-022126` / `…-023935` / `…-024355` / `…-034415`。回滚命令：`cd /opt/cliproxyapi && ./update-cpa.sh --rollback`。

### 30.7 Overlay 资产盘点

| 项目 | 之前 | 现在 |
|------|------|------|
| `overlay/files/**/*.go` | 38 | **54** (+16) |
| `overlay/patches/*.patch` | 13 | 13（未变） |

新增的 16 个 .go：

```
overlay/files/internal/api/handlers/management/
├── account_health.go             (§3)
├── account_health_test.go
├── audit_log.go                  (§9)
├── audit_log_test.go
├── maintenance_rules.go          (§4)
├── maintenance_rules_test.go
├── token_reports.go              (§5)
├── token_reports_test.go
├── api_key_insights.go           (§6)
├── routing_lab.go                (§7)
├── capacity_forecast.go          (§8)
├── backups.go                    (§10)
├── system_diagnostics.go         (§11)
├── overlay_config.go             (§14 scaffold)
└── pricing_view.go               (定价核对)

overlay/files/sdk/cliproxy/auth/
└── bulk_refresh_throttled.go     (Manager.TriggerRefreshAllThrottled)
```

修改的现有 overlay 文件（不计入新增）：
- `account_maintenance.go` — `authNeedsRelogin()` 加 status 优先判断
- `analytics.go` — storage-summary 暴露 overlay sqlite 状态
- `api_key_limits.go` / `oauth_repair.go` / `request_log_store.go` / `system_update.go` / `token_stats.go` / `warmup.go` / `webhooks.go` / `ext_auth_files_routes.go` — 加 `auditingHandler` 包装
- `codex_quota.go` — 末尾 `saveCodexQuotaSnapshot(entries)` 注入缓存
- `jobs.go` — `newRefreshTokensJob` 改用 throttled bulk refresh
- `usage_persistence.go` — 增加 audit log + overlay config 加载
- `system_update.go` — 加 `/system/check-upstream` 端点

### 30.8 已观察到的 bulk-refresh 假象（2026-05-08 现场）

**症状**：

> 「在授权文件页面点进去显示正常的只有 30 个需要重新登录，但点击"刷新全部 Token"会显示几乎全部 282 都是 401 需要重新登录。配额刷新（quota poll）只有 30 个账号报错。」

**实测对照表**：

| 操作 | 触发频率 | 实际失败账号数 | UI 报告失败数 |
|------|---------|---------------|---------------|
| 浏览 `/auth-files` 页面（badge 显示） | 静态 | 30 | 30（修复后） |
| 配额刷新 `/codex-quota` | 直接调 wham API | 30（access_token 过期的） | 30 |
| 「刷新全部 Token」（OAuth 刷新） | 282 并发撞 OpenAI auth | ~30 真实失败 | **≈282 全部 401**（假象） |

**原因链**：

1. `Manager.TriggerRefreshAll` 一次 `go m.refreshAuth(...)` × 282，**没有任何并发限制**
2. 282 个 goroutine 同时 POST `auth.openai.com/oauth/token`
3. OpenAI auth 端点对短时间大量同源 IP 请求触发限流，返回类 `refresh_token_reused` 401
4. 真正坏的 30 个账号确实是 token 已被消费；其余 ~250 个是被限流"误伤"
5. 日志层面看不出区别：**所有 401 都是同一种错误信息**，导致用户/开发者都以为"全部坏了"

**为什么 quota 刷新只有 30 个错**：

- `/codex-quota` 端点直接用 access_token 调 wham API，**不走 OAuth 刷新链路**
- 不存在并发限流问题（同一个用户的 access_token 调 wham 不会被 throttle）
- 只有真正 access_token 已过期且无法 refresh 的 30 个账号才报错

**为什么页面 badge 只有 30 个红**（修复后）：

- `AuthStatusBadge` 看 `auth.Status`，conductor 在每次成功 op 后会 reset `Status=active`
- 真正坏的账号 `Status=error` + `StatusMessage` 含 401/invalid_grant → 红色"需重登录"
- 其余账号 `Status=active`（即使有过 stale 401）→ 绿色

**修复**：

§30.5 的 `TriggerRefreshAllThrottled(ctx, 8)` + 前端 polling 30s → 120s。8 个并发 worker 串行跑 282 个 refresh，避开限流；polling 改 120s 等所有 refresh 真跑完。

**修复后预期**：

- 「刷新全部 Token」结果稳定为 `成功 ~250 / 失败 ~30 / 共 282`
- 30 个失败账号为真实需要 OAuth 重登的（由 OpenAI 永久标记 `refresh_token_reused`，CPA 无法自愈）
- 用户走 `/cpa-management/account-health` 选 `level=critical` 批量重登修复这 30 个

**教训**：

- bulk 操作必须看作"对外部 API 的负载测试"。100+ 账号规模下任何 OAuth/auth 端点都不能裸并发。
- 错误日志缺少 auth ID 字段（上游 openai_auth.go:295 的 Warnf 只打 attempt 号 + err.Error()）→ 无法快速分辨真假失败。建议未来给上游提 PR 加 auth ID。
- "全部失败"是高情绪信号，必须先用日志聚合区分真失败与限流假失败再下结论。

### 30.9 经验

- **设计文档先审，再写代码**：审改写的 20 个问题，每条都直接对应到实现层 trade-off。如果照着原文实施会踩满地坑。
- **null vs `[]` 的 JSON 边界**：Go 的 nil slice 序列化为 `null`，前端 `useMemo` 没 null guard 立刻爆。**后端确保 non-nil + 前端 `?? []` 双保险**比单边修补更稳。
- **status 优先于历史信号**：conductor 在每次成功 op 后会清 LastError 并 set Status=active，UI 应信任 status 字段，不是 stale message。`authNeedsRelogin` / `AuthStatusBadge` / 重登按钮可见性条件全部按这个原则重排。
- **bulk 操作必须限流**：`TriggerRefreshAll` 的"282 个 goroutine 同时点 OAuth 刷新端点"是上游遗漏。这种 thundering herd 在 100+ 账号规模下会造成 **OpenAI 限流 → 假 401 → 用户怀疑系统坏了** 的全链路恐慌。新增 `TriggerRefreshAllThrottled` 是在 sdk/cliproxy/auth/ 同 package 加方法（首次扩展该 package），未来同类增强可继续放这里。
- **ldflags 目标变量要看 main 包**：上游 `main.Version` 才是注入点，`buildinfo.Version` 是它的复制目标。`-X github.com/.../buildinfo.Version=…` binary 里 `strings` 能找到值但运行时仍是 "dev"。
- **同步 polling 超时要按数据规模放大**：30s 在 282 账号场景下完全不够。120s 是按 8 worker × 2s/refresh × 282/8 ≈ 70s 留 1.5x 缓冲。
- **OpenAI OAuth `refresh_token_reused` 永久不可恢复**：CPA 自身没有任何代码能把它救回来，OpenAI 设计就是这样。28-30 个真坏的账号必须用户走 `/cpa-management/account-health` → 选 critical → 批量重登。

---

*文档最后更新：2026-05-08*
*作者：基于 Claude Sonnet 4.6 / Opus 4.7 实现*
*许可：MIT（与 CPA 主项目一致）*
