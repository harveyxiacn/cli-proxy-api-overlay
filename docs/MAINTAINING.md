# 维护指南：扩展面板与 CPA 上游隔离

本文档描述如何在 CPA (CLIProxyAPI) 上游版本更新时，**保留**我们的扩展（React 管理面板 + 后端新 API），避免被覆盖。

---

## 1. 当前隔离状态

| 组件 | 隔离程度 | 位置 |
|------|---------|------|
| **React 前端源码** | ✅ 完全隔离 | `frontend/` 目录在项目根，独立 Go 模块外 |
| **后端 54 个新文件** | ✅ 物理隔离（已打包） | `overlay/files/` 中保存了完整副本 |
| **后端 13 个修改文件** | ⚠️ 半隔离（patch 形式） | `overlay/patches/` 保存 `git diff` |
| **构建产物 `frontend_dist/`** | ✅ 由 `frontend/` 重新生成 | 不需要保留 |
| **CPA 自身代码** | ⚠️ 已断开 git remote | `CLIProxyAPI/` 是纯文件树（无 `.git/`） |

> **2026-05-08 重要变更**：原本 `CLIProxyAPI/` 是 `git clone https://github.com/router-for-me/CLIProxyAPI` 的工作树，
> 与上游官方仓库直接关联（origin = router-for-me/CLIProxyAPI）。为彻底避免误推、视觉混淆等问题，已 `rm -rf CLIProxyAPI/.git`，
> 现在它就是一份**纯源码副本**。后果：
>
> - ✅ apply-overlay.bat 仍可工作（`git apply` 不需要 git repo）
> - ❌ refresh-overlay.bat / verify-overlay.bat / selftest.bat / update-cpa.bat / detect-removed.bat 全部依赖 git，**已无法直接使用**
> - 上游升级流程改为手动（见 §6）

---

## 2. 文件分类清单

### 2.1 完全是我们的（38 个新文件，gitignore 友好）

```
CLIProxyAPI/internal/api/handlers/management/
  ├── account_maintenance.go             (账号维护汇总 + 安全候选列表)
  ├── account_maintenance_test.go
  ├── analytics.go                       (P1-P3 分析层)
  ├── analytics_desktop_test.go
  ├── api_key_limits.go                  (per-API-Key 软限额：CRUD + 阈值告警)
  ├── api_key_limits_test.go
  ├── auth_files_fields_batch_test.go
  ├── codex_quota.go                     (Code Review 额度解析)  ← 注：这是新文件，因为我们重写了它
  ├── config_basic_test.go
  ├── desktop.go                         (桌面信息)
  ├── events.go                          (SSE 实时事件)
  ├── events_test.go
  ├── issues_alerts.go                   (问题中心 + 告警)
  ├── issues_alerts_test.go
  ├── jobs.go                            (任务管理)
  ├── jobs_test.go
  ├── oauth_repair.go                    (OAuth 修复 + 批量重登 batch 端点)
  ├── oauth_repair_test.go
  ├── pool_models.go                     (模型池聚合)
  ├── pricing_test.go                    (模型定价回归测试)
  ├── request_log_store.go               (请求历史环形缓冲 + 持久化)
  ├── request_log_store_test.go
  ├── startup_snapshot.go                (启动快照 1-RTT API)
  ├── system_update.go                   (VPS/host 一键更新状态与触发)
  ├── token_stats.go                     (Token 计费统计 + 按 API-Key 日累计)
  ├── token_stats_api_key_test.go        (Token stats API key hash 回归)
  ├── usage_persistence.go               (持久化路径配置)
  ├── usage_persistence_test.go
  ├── warmup.go                          (账号验证)
  ├── webhooks.go                        (Discord webhook 派发器 + 60s 去重)
  └── webhooks_test.go

CLIProxyAPI/internal/api/
  ├── frontend_embed.go                  (go:embed 前端 SPA)
  └── frontend_embed_stub.go             (无 embed_frontend 标签时的空实现)
```

### 2.2 上游修改（13 个文件，需要 patch）

```
internal/api/server.go                                          ← React SPA 入口 + extension route registry
internal/api/redis_queue_protocol_integration_test.go           ← Redis AUTH 错误消息适配
internal/api/handlers/management/auth_files.go                  ← 加 label/group/tags 字段、批量端点
internal/api/handlers/management/auth_files_batch_test.go       ← 测试更新
internal/api/handlers/management/api_key_usage.go               ← 小调整
internal/api/handlers/management/config_basic.go                ← 加 disable-cooling 等运维端点
internal/api/handlers/management/handler.go                     ← 加 postAuthHook + 持久化配置
internal/api/handlers/management/handler_test.go                ← localhost 不封禁测试
internal/registry/model_definitions.go                          ← gpt-5.5-instant 常量注释/保留
internal/registry/model_definitions_test.go                     ← 移除过时的 gpt-5.5 测试
internal/registry/model_registry.go                             ← 模型池聚合 helper
internal/runtime/executor/antigravity_executor_credits_test.go  ← daily URL 适配
sdk/cliproxy/auth/conductor.go                                  ← (内容待确认)
```

---

## 3. 维护工作流

### 场景 A：CPA 上游有新版本要拉取

```bat
:: 1. 切到 CPA 子目录
cd CLIProxyAPI

:: 2. 暂存我们的修改（修改文件被 git 追踪）
git stash --include-untracked

:: 3. 拉取上游
git pull origin main

:: 4. 回到根目录
cd ..

:: 5. 应用 overlay（恢复新文件 + 应用 patch）
overlay\apply-overlay.bat

:: 6. 验证编译 + 测试
cd CLIProxyAPI
go test ./internal/api/handlers/management -count=1
go build -tags embed_frontend -o ../cli-proxy-api-new.exe ./cmd/server

:: 7. 删除暂存
git stash drop
cd ..
```

如果第 5 步报「patch 检查失败」，说明上游修改了我们 patch 触及的代码区域。这时要：
- 进入 CLIProxyAPI/，手动用 `git apply --3way overlay/patches/<name>.patch` 三方合并
- 或：人工编辑冲突文件，再运行 `overlay\refresh-overlay.bat` 重新捕获状态

### 场景 B：你又改了一些 Go 代码，想纳入 overlay

```bat
:: 在 CPA 树里随意编辑你想要的文件
:: 改完后，重新捕获状态：
overlay\refresh-overlay.bat

:: 这会更新 overlay/files/ 和 overlay/patches/
:: 把 overlay/ 提交到你自己的 git 仓库即可
```

### 场景 C：清空 overlay 重置到 CPA 上游纯净状态

```bat
cd CLIProxyAPI
git reset --hard
git clean -fd internal/api/handlers/management/  
::（小心：这会删除所有未 tracked 的我们的新文件！）
::
:: 之后 overlay\apply-overlay.bat 重新应用
```

---

## 4. 长期更彻底的隔离方案（未实施，备选）

现在的 overlay 方案适合**短期维护**。若长期想做到「CPA 上游完全不动」，建议：

### 方案 A：扩展为独立 Go 模块（重构成本中）

```
project-root/
├── CLIProxyAPI/                ← 完全 vanilla 上游，read-only
├── extension/                  ← 独立 Go 模块，导出独立二进制
│   ├── cmd/manager/main.go     ← 用 CPA 的 SDK 启动 + 注入扩展
│   ├── internal/handlers/      ← 我们的所有新 handler
│   └── frontend_dist/          ← 嵌入 React
├── frontend/
└── go.work
```

通过 CPA 已有的 `api.WithEngineConfigurator(...)` / `api.WithRouterConfigurator(...)` / `usage.RegisterPlugin(...)` 这些 SDK 钩子接入。

**优势**：CPA 完全不动，可任意 `git pull`  
**代价**：需要重构现有 23+ 文件，Go 的 `internal/` 包访问规则需要变通

### 方案 B：Sidecar 反向代理二进制（重构成本高）

我们的扩展二进制：
- 听独立端口（如 :8318）
- 嵌入 React SPA
- 把 `/v0/management/*` 反向代理到 vanilla CPA :8317
- 我们独有的端点（jobs/events/analytics）在 sidecar 自己实现

**优势**：进程级隔离，CPA 真正零接触  
**代价**：但 `usage.Plugin` 接入需要 CPA 内进程，无法跨进程实现 → 失去 Token 计费能力

---

## 5. 当前 overlay 内容清单

```
overlay/
├── apply-overlay.bat         ← 把 overlay 应用到 CPA tree
├── refresh-overlay.bat       ← 重新捕获 CPA tree 当前状态
├── files/                    ← 54 个新 .go 文件（mirroring CPA tree 结构）
│   ├── internal/
│   │   └── api/
│   │       ├── frontend_embed.go
│   │       ├── frontend_embed_stub.go
│   │       └── handlers/management/
│   │           └── (47 files — 包括 §30 新增的 12 模块运维层)
│   └── sdk/
│       └── cliproxy/auth/
│           └── bulk_refresh_throttled.go  ← 限流 bulk OAuth 刷新（§30）
└── patches/                  ← 13 个 git diff 产生的 .patch
    ├── internal__api__server.go.patch
    ├── internal__api__handlers__management__auth_files.go.patch
    └── ...
```

> overlay/files 的新放置规则（2026-05-08 起）：除 `internal/api/handlers/management/` 外，**也允许在 `sdk/cliproxy/auth/` 下放新文件以扩展 Manager**（同 package 可访问 unexported 方法 `m.refreshAuth` 等）。已用此模式落地的：`bulk_refresh_throttled.go`（`Manager.TriggerRefreshAllThrottled` 解决 282 账号 thundering-herd）。后续类似 SDK 级增强可继续放这里。

---

## 6. 升级检查清单（2026-05-08 后：手动流程）

> ⚠️ 由于 `CLIProxyAPI/.git` 已被删除，原本的 `update-cpa.bat` 一键升级已不可用。下方流程是**手动版本**。

### 6.1 升级前侦察

无可用自动工具（detect-removed.bat 依赖 git）。手动流程：

1. 浏览 [router-for-me/CLIProxyAPI releases](https://github.com/router-for-me/CLIProxyAPI/releases) 查最新 tag
2. 看 release notes（或 commit log）哪些 management handler / 路由被删/重命名
3. 浏览 `frontend/src/api/queries.ts` 和 `overlay/patches/` 看我们是否依赖被删的端点
4. 如有冲突，先决定保留策略（参考 §11）

### 6.2 升级流程（手动）

```bat
rem 1. 备份当前 CLIProxyAPI/（可选但建议）
xcopy /e /i /y CLIProxyAPI CLIProxyAPI.bak

rem 2. 删除当前 CPA 源码
rmdir /s /q CLIProxyAPI

rem 3. 重新下载新版上游 release
rem    (Windows) 浏览器下载 https://github.com/router-for-me/CLIProxyAPI/archive/refs/tags/<tag>.zip
rem    解压到 CLIProxyAPI/（注意：解压出来的目录名是 CLIProxyAPI-<tag>，需要 rename 为 CLIProxyAPI）
rem    或用 PowerShell：
rem      Invoke-WebRequest -Uri https://github.com/router-for-me/CLIProxyAPI/archive/refs/tags/<tag>.tar.gz -OutFile cpa.tar.gz
rem      tar -xzf cpa.tar.gz
rem      Rename-Item CLIProxyAPI-<tag> CLIProxyAPI

rem 4. 重新应用我们的 overlay
overlay\apply-overlay.bat

rem 5. 验证
cd CLIProxyAPI
go test ./internal/api/handlers/management/... -count=1
go test ./...
cd ..\frontend
pnpm run build
cd ..
overlay\scripts\build.bat
```

### 6.3 手动升级清单

- [ ] 已查清楚目标 release 的删除/重命名（手动比对 release notes）
- [ ] 已备份当前 `CLIProxyAPI/`（万一升级失败可回滚）
- [ ] 新 CPA 源码解压到 `CLIProxyAPI/`
- [ ] `overlay\apply-overlay.bat` 全部 patch 应用成功（无 ! 标记）
- [ ] `cd CLIProxyAPI && go test ./internal/api/handlers/management -count=1` 通过
- [ ] `cd CLIProxyAPI && go test ./...` 通过
- [ ] `cd frontend && pnpm run build` 通过
- [ ] `overlay\scripts\build.bat` 输出新二进制
- [ ] 启动 → 访问 `http://127.0.0.1:8317/cpa-management` → React SPA 页面可达
- [ ] 启动 → 访问 `http://127.0.0.1:8317/extended.html` → 旧入口仍可用（如已部署）

### 6.4 如果你后悔删 .git，想恢复 git 工作流

```bat
cd CLIProxyAPI
git init
git remote add upstream https://github.com/router-for-me/CLIProxyAPI.git
git fetch upstream main
git reset --soft upstream/main      rem 把当前文件视为基于 upstream/main
git checkout -- .                   rem ⚠ 危险：会丢弃所有 overlay-applied 改动
                                    rem    所以一定要先 overlay\refresh-overlay.bat
```

`upstream` 而不是 `origin` 是有意为之 —— 强调"我们不能 push"。

---

## 7. Overlay 工具集

| 脚本 | 用途 | 删 `.git` 后还能用吗？ |
|------|------|---------------------|
| `apply-overlay.bat` | 把 overlay 应用到 CPA tree | ✅ 还能用（用的是 `git apply`，不需要 repo） |
| `detect-removed.bat` | 升级前侦察被删/改名的路由和函数（只读） | ❌ 依赖 `git fetch` |
| `refresh-overlay.bat` | 重新捕获 CPA tree 当前状态 | ❌ 依赖 `git diff` |
| `verify-overlay.bat` | 检查一致性（只读） | ❌ 依赖 `git ls-files` |
| `selftest.bat` | 端到端 apply/restore 自测 | ❌ 依赖 `git ls-files` |
| `update-cpa.bat` | 一键升级编排 | ❌ 依赖 `git pull` |

> 这些破掉的脚本目前保留在 `overlay/` 目录中**只作历史参考**。如果你想恢复它们的能力，按 §6.4 重建 git；
> 否则按 §6.2 走纯手动流程。

`refresh-overlay.bat` 和 `verify-overlay.bat` 会忽略 CPA tree 中大小写任意的 `NUL` untracked 条目。Windows 把 `NUL` 当保留设备名处理，无法按普通文件稳定读取/删除，不能把它捕获进 overlay 快照。

---

## 8. 故障排查 Playbook

### 8.1 `apply-overlay.bat` 报告 "patch failed"

**症状**：
```
[2/3] Applying patches...
  ! check failed: internal__api__server.go.patch
```

**原因**：上游修改了 patch 触及的代码区域，无法干净应用。

**修复**：
```bat
:: 查看哪个 hunk 冲突
cd CLIProxyAPI
git apply --3way ..\overlay\patches\internal__api__server.go.patch

:: 这会用三方合并尝试应用，失败的 hunk 会留 conflict 标记
git status
:: 手动编辑文件解决冲突，然后:
git add .
cd ..
overlay\refresh-overlay.bat   :: 重新捕获新状态
```

### 8.2 `verify-overlay.bat` 报 DRIFT

**症状**：
```
[DRIFT] 3 inconsistencies:
  - file content differs: 2
  - patches won't reverse: 1
```

**原因 A**：你直接改了 CPA 文件但没刷新 overlay。
- 解决：`overlay\refresh-overlay.bat` 捕获当前状态。

**原因 B**：CPA tree 被外部修改（误操作 git 命令、IDE 自动格式化）。
- 检查 `cd CLIProxyAPI && git status` 看具体差异。
- 决定是要保留改动（refresh）还是回退（apply-overlay）。

### 8.3 `update-cpa.bat` 在 [5/7] 测试失败

**症状**：管理包测试在升级后失败。

**原因**：上游 API 行为改变（如 `usage.Manager` 接口）。

**修复**：
```bat
:: 查看具体失败
cd CLIProxyAPI
go test ./internal/api/handlers/management -v -count=1 -run "TestFailingName"

:: 修改我们的代码适配新行为
:: 完成后:
cd ..
overlay\refresh-overlay.bat   :: 把适配后的代码捕获到 overlay
```

### 8.4 `selftest.bat` 任何步骤失败

```bat
:: 自测失败说明 overlay 系统损坏，恢复到稳定状态：
cd CLIProxyAPI
git reset --hard       :: 撤销 staged 修改
git clean -fd          :: 清空 untracked（小心！）
cd ..
overlay\apply-overlay.bat   :: 重新应用 overlay
overlay\verify-overlay.bat  :: 确认通过
```

### 8.5 想要"完全回到上游纯净状态"

```bat
cd CLIProxyAPI
:: 反向应用所有 patch
for %P in (..\overlay\patches\*.patch) do git apply --reverse "%P"
:: 删除我们的新文件
git clean -fd internal/api/handlers/management/
del internal\api\frontend_embed.go internal\api\frontend_embed_stub.go
rmdir /s /q internal\api\frontend_dist
cd ..
:: 此时 CPA tree 与上游 HEAD 完全一致
```

---

## 9. CI 集成建议

如果你把项目放到 CI（GitHub Actions / GitLab CI），添加这一步可在 PR 合并前阻断 overlay drift：

```yaml
- name: Verify overlay consistency
  run: ./overlay/verify-overlay.bat
```

`verify-overlay.bat` 退出码为 1 就会让 CI 失败，迫使提交者跑 `refresh-overlay.bat` 重新捕获状态。

---

## 10. 添加新功能（最佳实践）

CPA 管理面板的扩展走"路由注册器"模式（详见 [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md) §25）。**永远不要**直接改 `server.go` 加路由——会增大 patch 体积，下次升级冲突概率高。

### 10.1 加一个全新功能（推荐流程）

1. 在 `overlay/files/internal/api/handlers/management/` 新建文件，例如 `myfeature.go`：

```go
package management

import (
    "net/http"
    "github.com/gin-gonic/gin"
)

func init() {
    RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
        rg.GET("/myfeature", h.GetMyFeature)
        rg.POST("/myfeature/reset", h.PostMyFeatureReset)
    })
}

func (h *Handler) GetMyFeature(c *gin.Context) {
    // 通过 h.authManager / h.cfg 访问 CPA 状态
    c.JSON(http.StatusOK, gin.H{"hello": "world"})
}

func (h *Handler) PostMyFeatureReset(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
```

2. 跑 `overlay/refresh-overlay.bat` 把新文件捕获到 `overlay/files/`
3. 验证：`overlay/verify-overlay.bat`

完成。**不动 server.go、不动 handler.go、不动任何 patch**。新路由通过 `init()` 自动注册到 management 路由组。

### 10.2 给 patched 上游文件加路由

如果新功能复用上游 patched 文件中的现有 handler 函数（如 `auth_files.go` 已有但未注册路由的方法），新建 `ext_<feature>_routes.go`：

```go
package management

import "github.com/gin-gonic/gin"

func init() {
    RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
        rg.POST("/auth-files/my-action", h.MyExistingMethod)
    })
}
```

参见 `ext_config_basic_routes.go`、`ext_auth_files_routes.go`、`ext_api_key_usage_routes.go` 三个现成例子。

### 10.3 删除功能

直接删除对应 `<feature>.go` 文件。运行 `overlay/refresh-overlay.bat` 即生效。如果功能依赖 patched 文件中的 handler 方法，也要删 `ext_<feature>_routes.go`。

### 10.4 修改功能

直接编辑文件。如果改了路由路径或方法名：
- 直接改 `init()` 中的注册
- 不需要碰 server.go

### 10.5 何时考虑 `extension/` 子包

仅当新功能**完全满足**这些条件时：
- 不引用任何 `h.X` 字段（不需要 authManager / cfg / mu / configFilePath）
- 不被任何 patched 文件中的代码引用（如 middleware 不会调用它的内部函数）
- 实现完全自包含，不与 management 包内其他扩展共享 unexported 类型/变量

满足条件时新建 `internal/api/handlers/management/extension/<feature>.go`，包名 `extension`，并在 `server.go` patch 加一行 `_ "...extension"` 副作用 import。

目前没有满足这些条件的现有文件——`events.go` 被 middleware 调用、`usage_persistence/token_stats/request_log_store` 三角共享 unexported 类型、`desktop.go` 测试以方法形式调用——所以 `extension/` 子包尚未创建。等第一个真正符合条件的功能出现再建。

---

## 11. 处理上游删除的端点

`detect-removed.bat` 报 `!` 时，对每条**我们依赖**的删除项决定方案：

### 10.1 三种保留方案

| 方案 | 适用 | 步骤 | 代价 |
|------|------|------|------|
| **A. 原样保留** | 删除的实现自包含、依赖稳定的 SDK 类型 | ① 升级前从上游捞代码 ② 改名加 `Legacy` 前缀 ③ 放进 `overlay/files/internal/api/handlers/management/preserved_<name>.go` ④ 在 server.go patch 加路由（建议 `/legacy/...` 命名空间） | 5 分钟，长期可能因内部 SDK 类型变更失修 |
| **B. SDK 重写** | 删除的实现依赖太多 internal 包，难以照搬 | 在 `overlay/files/...` 新建 handler，仅用 `sdk/cliproxy/...` 公共接口重写业务 | 半天到一天，长期稳定 |
| **C. 前端迁移** | 上游有等价替代端点（如 rename） | 修改 `frontend/src/api/queries.ts` 等指向新端点，不在后端做任何动作 | 最少改动，遵循上游意图 |

### 10.2 操作示例：原样保留

假设上游要删 `GetUsageStatistics` 和路由 `/usage`：

```bat
:: 1. 升级前从上游 HEAD 捞出代码
cd CLIProxyAPI
git show origin/main:internal/api/handlers/management/usage_statistics.go > ../overlay/files/internal/api/handlers/management/preserved_usage_statistics.go

:: 2. 编辑保留文件，改 package 内函数名
::    GetUsageStatistics       -> GetUsageStatisticsLegacy
::    SetUsageStatistics       -> SetUsageStatisticsLegacy
::    （保持 receiver `(h *Handler)` 不变）

:: 3. 在 overlay/patches/internal__api__server.go.patch 里
::    把路由改成新名字：
::    mgmt.GET("/legacy/usage", s.mgmt.GetUsageStatisticsLegacy)

:: 4. 走完整升级流程
overlay\update-cpa.bat
```

前端如果依赖该端点，同步更新 `frontend/src/api/queries.ts` 把 `'/usage'` 改成 `'/legacy/usage'`。

### 10.3 操作示例：SDK 重写

适合复杂业务逻辑：

1. 在 `overlay/files/internal/api/handlers/management/extension_<name>.go` 新建文件
2. 通过 `usage.PluginManager()` 获取我们已经有的全局 plugin
3. 调用 `sdk/cliproxy/auth/conductor.go` 的公共方法获取数据
4. 自己组装响应

参考已有的 `analytics.go`、`token_stats.go`：它们就是基于 SDK 重写的，从未直接依赖 internal 类型。

### 10.4 命名约定（避免未来冲突）

- 文件名前缀：`preserved_*.go`（原样保留）或 `extension_*.go`（重写）
- 导出函数名后缀：`*Legacy`（保留）或 `*Ext`（重写）
- 路由命名空间：`/v0/management/legacy/*` 或 `/v0/management/ext/*`

这样上游哪天又把同名端点加回来也不会冲突，diff 也清晰。

---

## 12. VPS 远程部署（2026-05-06 新增）

本节描述把改造过的 CPA 部署到 VPS 给团队共享。已实战 deployed 到 `<your-cpa-vps-domain>`（DMIT）。

### 12.1 架构

```
[团队浏览器]
   ↓ HTTPS via Cloudflare
[Cloudflare 代理]
   ↓
[VPS:443] OpenResty 容器
   ├── /management.html      → 1Panel 静态面板（保留，不动）
   ├── /v0/management/*      → proxy_pass 127.0.0.1:8317（CPA 容器）
   ├── /                     → catch-all proxy_pass 127.0.0.1:8317
   └── /cpa-management/...   → catch-all → CPA 的 React SPA

[VPS:127.0.0.1:8317] cli-proxy-api Docker container
   - image: eceasy/cli-proxy-api:latest
   - 我们的二进制通过 bind mount 注入 /CLIProxyAPI/CLIProxyAPI（覆盖镜像内置）
   - 我们的 extended.html 通过 bind mount 注入 /CLIProxyAPI/extended.html
   - state 文件 .update-trigger / .update-log / .update-meta.json 也 mount 进来

[VPS host] systemd timer (cpa-update-watcher)
   - 每 30s 触发 update-watcher.sh
   - 检查 .update-trigger 非空就跑 update-cpa.sh
   - 写元数据到 .update-meta.json
```

### 12.2 一次性部署步骤

#### A. 准备文件

本机交叉编 Linux 二进制：

```bat
cd CLIProxyAPI
set CGO_ENABLED=0
set GOOS=linux
set GOARCH=amd64
go build -tags embed_frontend -ldflags="-s -w" -o ..\cli-proxy-api-linux .\cmd\server\
```

`cli-proxy-api-linux`（约 39 MB，含 React 嵌入）+ `extended.html` 是要传上去的两个东西。

#### B. SSH 上去（注意 sing-box / VPN 拦截）

如果本机有 sing-box / Clash 等 TUN 模式 VPN，**直连 SSH 22 会被劫持**（TCP 握手成功但 banner 出不来）。两种破解：
1. 退掉 sing-box 后再 ssh
2. 用其他 SSH 客户端（如 xshell）搭个本机端口转发，比如 2222 → VPS:22，OpenSSH 走 `ssh -p 2222 root@127.0.0.1` 不经过 TUN

#### C. 改 `/opt/cliproxyapi/docker-compose.yml`

加 5 条 bind mount：

```yaml
services:
  cli-proxy-api:
    image: eceasy/cli-proxy-api:latest
    container_name: cli-proxy-api
    pull_policy: always
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./config.yaml:/CLIProxyAPI/config.yaml
      - ./auths:/root/.cli-proxy-api
      - ./logs:/CLIProxyAPI/logs
      - ./static:/CLIProxyAPI/static
      - ./CLIProxyAPI:/CLIProxyAPI/CLIProxyAPI:ro          # 我们的二进制
      - ./extended.html:/CLIProxyAPI/extended.html:ro
      - ./.update-trigger:/CLIProxyAPI/.update-trigger
      - ./.update-log:/CLIProxyAPI/.update-log:ro
      - ./.update-meta.json:/CLIProxyAPI/.update-meta.json:ro
```

#### D. 预创建 state 文件（critical）

```bash
cd /opt/cliproxyapi
touch .update-trigger .update-log .update-meta.json
```

不预创建会让 docker 把每条 mount 当作"宿主机要挂载的目录"处理，反而在容器内创建了空目录，应用代码 `os.WriteFile(".update-trigger", ...)` 就会"目标是目录"报错。

#### E. 推二进制 + extended.html

```bash
# 从本机
scp cli-proxy-api-linux extended.html root@vps:/opt/cliproxyapi/staging/
# VPS
mv staging/cli-proxy-api-linux /opt/cliproxyapi/CLIProxyAPI
chmod +x /opt/cliproxyapi/CLIProxyAPI
mv staging/extended.html /opt/cliproxyapi/extended.html
rmdir staging
```

#### F. 写 update-cpa.sh / update-watcher.sh / systemd unit

`update-cpa.sh` 见 §12.4。

`update-watcher.sh`：

```bash
#!/usr/bin/env bash
set -e
DIR=/opt/cliproxyapi
TRIGGER="$DIR/.update-trigger"
LOGFILE="$DIR/.update-log"
META="$DIR/.update-meta.json"

[[ -s "$TRIGGER" ]] || exit 0
START=$(date +%s)
TRIG_CONTENT=$(tr -d "\n" < "$TRIGGER" | head -c 64)
: > "$TRIGGER"

IMAGE_BEFORE=$(docker inspect cli-proxy-api --format "{{.Image}}" 2>/dev/null || echo "")
cd "$DIR" && "$DIR/update-cpa.sh" > "$LOGFILE" 2>&1
RESULT=$?
IMAGE_AFTER=$(docker inspect cli-proxy-api --format "{{.Image}}" 2>/dev/null || echo "")
END=$(date +%s)
SUCCESS=$([ $RESULT -eq 0 ] && echo true || echo false)
CHANGED=$([ "$IMAGE_BEFORE" != "$IMAGE_AFTER" ] && echo true || echo false)

cat > "$META" <<JSON
{
  "started_at": $START, "ended_at": $END, "duration_sec": $((END - START)),
  "success": $SUCCESS, "exit_code": $RESULT,
  "image_before": "$IMAGE_BEFORE", "image_after": "$IMAGE_AFTER",
  "image_changed": $CHANGED, "trigger_content": "$TRIG_CONTENT"
}
JSON
exit $RESULT
```

`/etc/systemd/system/cpa-update-watcher.service`：
```ini
[Unit]
Description=CPA update watcher (one-shot)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/cliproxyapi
ExecStart=/opt/cliproxyapi/update-watcher.sh
```

`/etc/systemd/system/cpa-update-watcher.timer`：
```ini
[Unit]
Description=Periodically check CPA update trigger every 30s

[Timer]
OnBootSec=60s
OnUnitActiveSec=30s
AccuracySec=5s
Unit=cpa-update-watcher.service

[Install]
WantedBy=timers.target
```

启用：`systemctl daemon-reload && systemctl enable --now cpa-update-watcher.timer`

#### G. 启动 + 验证

```bash
cd /opt/cliproxyapi && ./update-cpa.sh --no-pull
```

会重启容器，跑 smoke test。

### 12.3 OpenResty 反代配置

在 OpenResty 容器（如 1Panel-openresty-tjHC）的站点 proxy 配置（如 `/www/sites/<your-cpa-vps-domain>/proxy/root.conf`）需要：

```nginx
# 1Panel 旧静态面板（保留）
location = /management.html {
    alias /www/sites/<your-cpa-vps-domain>/index/management.html;
}

# 我们的 React SPA + 所有其它路径都过 CPA
location ^~ /v0/management/ {
    proxy_pass http://127.0.0.1:8317;
    # 标准 proxy headers (Auth / Upgrade / Connection ...)
}

location ^~ / {
    proxy_pass http://127.0.0.1:8317;
}
```

注意我们的 React SPA 路径已改为 `/cpa-management`（避开 1Panel 的 `/management.html` 重定向冲突），见 [DEVELOPMENT_LOG §26.5](DEVELOPMENT_LOG.md#265-react-路径改名-management--cpa-management)。

### 12.4 update-cpa.sh — VPS 端的升级脚本

```bash
#!/usr/bin/env bash
# 用法：
#   ./update-cpa.sh                    # 拉最新上游镜像 + 重启（保留自定义文件）
#   ./update-cpa.sh --binary <path>    # 替换自定义二进制（自动备份）+ 重启
#   ./update-cpa.sh --rollback         # 把最近一次 .bak 还原（仅限自定义二进制）
#   ./update-cpa.sh --no-pull          # 不拉镜像，仅重启容器（用于配置改动后）
```

完整代码已 deploy 到 `/opt/cliproxyapi/update-cpa.sh`。Smoke test 用 `(echo > /dev/tcp/127.0.0.1/8317)` 做 TCP 探测代替 HTTP（避免 401 响应被 `curl -fsS` 当失败重试 13 次产生噪声）。

### 12.5 升级 CPA 上游的工作流

**场景 A：升级 CPA 上游 Docker 镜像**（最常见，比如从 v6.10.8 → v6.10.9）

任意一种触发即可：
1. **从面板点按钮**（团队成员可做）：浏览器进 `/cpa-management/system` → "🚀 立即更新" → 30s 内 systemd watcher 接手 → 容器重启 → 浏览器自动刷新看到新版本
2. **SSH 手动**：`cd /opt/cliproxyapi && ./update-cpa.sh`

两条都会保留 bind-mount 的自定义二进制 + extended.html。

**场景 B：升级我们的自定义二进制**（加新 feature 或修 bug 之后）

1. 本机改代码 + `pnpm run build` + 交叉编 `cli-proxy-api-linux`
2. `scp cli-proxy-api-linux root@vps:/tmp/`
3. SSH 上 VPS：`cd /opt/cliproxyapi && ./update-cpa.sh --no-pull --binary /tmp/cli-proxy-api-linux`

这条流程 **没有** 走面板按钮的 trigger 文件机制 — 因为面板按钮只触发 `update-cpa.sh` 不带参数，不会替换二进制。

**场景 C：纯前端改动（无后端修改）**

仍然要走 §12.4 步骤 1-3 重新交叉编（因为 React dist 通过 `embed_frontend` build tag 内嵌进二进制）。

**场景 D：紧急回滚**

```bash
cd /opt/cliproxyapi && ./update-cpa.sh --rollback
```

会把最近一份 `CLIProxyAPI.bak.YYYYMMDD-HHMMSS` 还原成主二进制再重启。

### 12.6 团队成员连接配置

```
Panel URL:  https://<your-cpa-vps-domain>/cpa-management
连接 URL:    https://<your-cpa-vps-domain>    (面板默认会自动填，window.location.origin)
管理密钥:    <见 cliproxyapi-access.txt 的 Management Secret 字段>
```

**如果团队成员之前用过本地 CPA 且填过 `http://127.0.0.1:8317`** → 浏览器 localStorage 残留这个值。新版面板的 `onRehydrateStorage` 钩子会自动迁移到当前 origin（一次性，无感）。无需任何手动操作。

如果迁移没生效（罕见），ConnectBar 显示 "📍 当前站点" 按钮一键重置。

### 12.7 故障排查

| 症状 | 可能原因 | 解决 |
|---|---|---|
| 面板访问 404 / 500 | 容器没起 | `docker compose ps` 看状态；`docker logs cli-proxy-api --tail 50` |
| 面板加载但所有 API 401 | 管理 key 错 | 看 `cliproxyapi-access.txt` 或重置 secret-key |
| `/v0/management/system/*` 返回 404 | 跑的是上游镜像而不是我们的二进制 | `docker exec cli-proxy-api sha256sum /CLIProxyAPI/CLIProxyAPI` 对比本地 |
| 一键更新点了没反应 | systemd timer 没 enable / `.update-trigger` mount 错 | `systemctl status cpa-update-watcher.timer` + `docker exec cli-proxy-api ls -la /CLIProxyAPI/.update-trigger` |
| 一键更新 30s 后还在 pending | watcher 报错 | `journalctl -u cpa-update-watcher.service --no-pager -n 30` |
| 团队成员显示 349 池子（应该 279） | 面板 URL 还在 `127.0.0.1` | 等 onRehydrateStorage 自动迁移 OR 让用户点 ConnectBar 的 "📍 当前站点" 按钮 |
| Token 大量 `refresh_token_reused` | 多个 CPA 实例并发对同一批 codex auth 操作 | 同一时刻只跑一份 CPA。本地+VPS 都跑会污染 token |

### 12.8 关键文件清单

VPS `/opt/cliproxyapi/`：

```
CLIProxyAPI                    ← 我们的 Linux 二进制（39 MB）
CLIProxyAPI.bak.YYYYMMDD-HHMMSS ← 历史备份（每次 --binary 自动留）
docker-compose.yml             ← bind mount 配置
docker-compose.yml.bak.*       ← 改动备份
extended.html                  ← 扩展面板（独立单文件）
config.yaml                    ← CPA 配置
auths/                         ← codex / antigravity / claude OAuth 文件（279+）
logs/                          ← CPA 内部日志
static/                        ← 上游镜像内的 management.html（保留兼容）
update-cpa.sh                  ← 主升级脚本
update-watcher.sh              ← systemd timer 调用的 wrapper
.update-trigger                ← 面板 POST /system/update 写这个排队
.update-log                    ← watcher 跑 update-cpa.sh 的最近一次 stdout
.update-meta.json              ← watcher 写：success / duration / image SHA before/after
```

VPS host 配置：

```
/etc/systemd/system/cpa-update-watcher.service
/etc/systemd/system/cpa-update-watcher.timer
/etc/systemd/system/timers.target.wants/cpa-update-watcher.timer  ← enable 后的 symlink
```

OpenResty 内部：

```
/usr/local/openresty/nginx/conf/conf.d/<your-cpa-vps-domain>.conf
/www/sites/<your-cpa-vps-domain>/proxy/root.conf
/www/sites/<your-cpa-vps-domain>/ssl/{fullchain,privkey}.pem
/www/sites/<your-cpa-vps-domain>/index/management.html  ← 1Panel 旧静态面板
```

---

*最后更新：2026-05-07*
