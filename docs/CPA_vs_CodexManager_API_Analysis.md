# CPA vs Codex-Manager API 全面对比分析

> 基于对两套代码的完整阅读，按功能模块整理对比。  
> **CPA** = CLIProxyAPI（HTTP REST，Base: `/v0/management`）  
> **CM** = Codex-Manager（JSON-RPC 2.0，`POST /rpc`）

---

## 目录

1. [账号 / 授权文件管理](#1-账号--授权文件管理)  
2. [Token 刷新 / OAuth 流程](#2-token-刷新--oauth-流程)  
3. [配额与用量查询](#3-配额与用量查询)  
4. [Token 消耗统计](#4-token-消耗统计)  
5. [API Key 管理](#5-api-key-管理)  
6. [请求日志](#6-请求日志)  
7. [网关与路由配置](#7-网关与路由配置)  
8. [代理 / 上游配置](#8-代理--上游配置)  
9. [模型管理](#9-模型管理)  
10. [后台任务配置](#10-后台任务配置)  
11. [版本检查](#11-版本检查)  
12. [CPA 独有功能](#12-cpa-独有功能)  
13. [CM 独有功能](#13-cm-独有功能)  
14. [设计差异总结](#14-设计差异总结)  

---

## 1. 账号 / 授权文件管理

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **列出所有账号** | `GET /auth-files` → `{files:[{id,name,provider,email,status,status_message,disabled,unavailable,success,failed,last_refresh,next_retry_after,label,group,tags,...}]}`；前端本地过滤分组/标签 | `account/list` → `{items:[AccountSummary],total,page,pageSize}` 支持分页/搜索/分组过滤 |
| **上传/导入账号** | `POST /auth-files?name=xxx.json` — 发送原始 JSON 文件体 | `account/import` — 传 `{contents:[string]}` 字符串数组或目录路径 |
| **删除单个账号** | `DELETE /auth-files?name=xxx` | `account/delete` → `{accountId}` |
| **批量删除** | `POST /auth-files/delete-batch` → `{names:[]}` | `account/deleteMany` → `{accountIds:[]}` |
| **删除不可用 Free 账号** | 无直接删除端点；`GET /auth-files/maintenance-summary` 返回 `candidates.unavailable_free`，前端先选择再走批量删除 | `account/deleteUnavailableFree` — 一键清理 |
| **修改账号元数据** | `PATCH /auth-files/fields` → `{name,prefix,proxy_url,headers,priority,note,label,group,tags}`；`POST /auth-files/fields-batch` 支持批量 group/tags | `account/update` → `{accountId,sort,preferred,status,label,note,tags}` |
| **启用/禁用账号** | `PATCH /auth-files/status` → `{name,disabled:bool}` | `account/update` → `{status:"disabled"\|"active"}` |
| **下载账号文件** | `GET /auth-files/download?name=xxx` | `account/exportData` — 导出多个账号数据 |
| **账号暖机测试** | `POST /auth-files/warmup` → `{names:[]}`，返回每账号 ok/message/latency | `account/warmup` → `{accountIds,message}` 发送测试请求验证账号可用性 |
| **账号维护汇总** | `GET /auth-files/maintenance-summary` → summary/counts/candidates，统计需重登录、不可用 Free、问题账号、providers/groups/tags/plans | 无完全等价；CM 的清理/分组能力分散在 account RPC 和本地 DB 查询中 |
| **账号标签/分组** | `PATCH /auth-files/fields` + `POST /auth-files/fields-batch` 支持 `label/group/tags` | `account/update` 支持 `tags`、`label`、分组名 |
| **账号排序** | 无 | `account/update` 的 `sort` 字段 |
| **Vertex 导入** | `POST /vertex/import` — 专用端点导入 Vertex 证书 | 无对应 |

**关键差异：**
- CPA 以"文件"为中心（JSON 文件即账号），CM 以"账号记录"为中心（SQLite 存储）
- CPA 已补齐分组、标签、暖机、批量删除和安全维护候选列表；CM 仍有服务端分页和 SQLite 级账号查询优势
- CPA 的 `status_message` 字段提供服务端错误原因，CM 通过 `statusReason` 字段

---

## 2. Token 刷新 / OAuth 流程

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **刷新全部 Token** | `POST /auth-files/refresh-all-tokens` → `{queued:N,message}` — 后台异步，无法跟踪单账号结果 | `account/chatgptAuthTokens/refreshAll` → `{requested,succeeded,failed,skipped,results:[{accountId,ok,message}]}` — 同步返回每个账号结果 |
| **刷新单个 Token** | 无（只能全量触发） | `account/chatgptAuthTokens/refresh` → `{accountId}` 刷新指定账号 |
| **启动 OAuth 登录** | `GET /codex-auth-url[?is_webui=1]` 返回 `{url,state}` | `account/login/start` → `{type,openBrowser,...}` 支持多种登录方式 |
| **轮询登录状态** | `GET /get-auth-status?state=xxx` → `{status,error}` | `account/login/status` → `{loginId}` |
| **完成 OAuth 回调** | `POST /oauth-callback` — 由浏览器跳转触发 | `account/login/complete` → `{state,code,redirectUri}` |
| **直接注入 Token** | 无 | `account/login/start` 的 `accessToken`/`refreshToken`/`idToken` 参数 |
| **读取当前 Token 账号** | 无 | `account/read` → `CurrentAccessTokenAccountReadResult` |
| **注销** | 无（只能删除文件） | `account/logout` |
| **Anthropic OAuth** | `GET /anthropic-auth-url` | 包含在 `account/login/start` 的 `type="claude"` |
| **Gemini CLI OAuth** | `GET /gemini-cli-auth-url` | 包含在通用登录流程 |
| **Kimi OAuth** | `GET /kimi-auth-url` | 无 |
| **Antigravity OAuth** | `GET /antigravity-auth-url` | 无 |

**关键差异：**
- **CPA** 的刷新是"触发后异步"，无法获取每个账号的结果；**CM** 的刷新是同步的，直接返回每个账号的成功/失败
- CM 支持不打开浏览器的登录方式（device code、直接传 token），CPA 必须走浏览器回调
- CM 有完整的注销和当前账号查看，CPA 只能删文件

---

## 3. 配额与用量查询

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **查询 Codex 配额** | `GET /codex-quota` → `{entries:[{id,email,primary_window:{used_percent,remaining_percent,window_minutes,reset_at},secondary_window?,extra_windows:[{name,primary}]?,raw_meta?}],summary:{...}}` | `account/usage/list` → `[{usedPercent,windowMinutes,resetsAt,secondaryUsedPercent,secondaryWindowMinutes,secondaryResetsAt,creditsJson,availabilityStatus}]` |
| **单账号配额** | 无专用端点（全量查询） | `account/usage/read` → `{accountId}` 查询指定账号 |
| **刷新配额数据** | 重新调用 `GET /codex-quota`（重新请求 wham API） | `account/usage/refresh` → `{accountId?}` 触发后台刷新 |
| **汇总统计** | `/codex-quota` 的 `summary` 字段（avg_remaining, idle_count 等） | `account/usage/aggregate` → `UsageAggregateSummaryResult` 更详细 |
| **Code Review 额度** | 从 wham `additional_rate_limits` 解析，存入 `extra_windows` | 从 `creditsJson` 字段里的 `_codexmanager_extra_rate_limits` 提取 |
| **窗口类型识别（5h vs 7天）** | `window_minutes` 字段，>10080 为长窗口 | `isLongWindow(windowMinutes)` 函数，>1443 分钟为长窗口 |
| **账号可用性计算** | 前端简单判断 `remaining_percent > 0` | `calcAvailability()` 函数，考虑 `availabilityStatus`、禁用、限流、封禁等多种状态 |
| **Subscription/订阅信息** | 无 | `account/subscriptions` 接口，返回 plan_type、active_until、will_renew |
| **请求 wham 的额外头** | `Authorization` + `originator: codex` + `ChatGPT-Account-ID` | `Authorization` + `ChatGPT-Account-ID` + `originator` + `x-openai-internal-codex-residency` |

**关键差异：**
- CM 将配额数据持久化到 SQLite（历史可查），CPA 每次都实时请求 wham API
- CM 的 `creditsJson` 包含完整的额外额度数据（序列化为 JSON 字符串），CPA 在 `extra_windows` 中结构化返回
- CM 有订阅信息（付费计划详情），CPA 没有
- CM 的可用性计算逻辑更复杂（区分 limited/unavailable/banned/inactive），CPA 仅区分 active/ready/error/disabled

---

## 4. Token 消耗统计

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **今日 Token 汇总** | `GET /token-stats` 的 `today` 字段（进程内，每日零点自动清零） | `requestlog/today_summary` → `{inputTokens,outputTokens,cachedInputTokens,reasoningOutputTokens,todayTokens,estimatedCost}` — 从 SQLite 聚合 |
| **历史 Token 统计** | `GET /token-stats` 的 `totals` 字段 + `GET /request-history` 最近 5000 条请求（本地持久化） | `requestlog/summary` + `requestlog/list` — SQLite 持久化，跨重启可查 |
| **按账号统计** | `GET /token-stats` 的 `entries` 字段；`GET /request-history?q=<email/auth/keyhash>` 可查请求明细 | `requestlog/list` 可按 accountId 过滤 |
| **按 API Key 统计** | `GET /token-stats` entry 暴露 `api_key_hash`，前端按 hash 聚合 token/cost/request；`GET /api-key-usage` 仍提供按 `provider\|key` 的 success/failed 近期请求 | `apikey/usageStats` → `{totalTokens,estimatedCostUsd}` |
| **费用估算** | `estimated_usd` 字段，内置模型定价表（o1/o3/gpt-4o/gpt-5.x 等） | `estimatedCostUsd`，定价表更完整（含 gpt-3.5 等旧模型） |
| **缓存 Token 统计** | `cached_tokens` 字段 | `cachedInputTokens` 字段 |
| **推理 Token 统计** | `reasoning_tokens` 字段 | `reasoningOutputTokens` 字段 |
| **重置统计** | `POST /token-stats/reset` | `requestlog/clear` — 清空请求日志（会同时清空请求记录） |
| **数据持久化** | 请求历史/用量快照落本地文件，保留最近窗口；仍不是完整 SQL 历史库 | SQLite 持久化，永久保存直到手动清除 |
| **近期请求趋势** | `auth-stats` 的 `recent_requests` 桶（环形缓冲区，多个时间窗口） | `requestlog/list` 返回完整请求记录，前端自行聚合 |
| **模型级别统计** | `GET /request-history?model=...` 每条记录含 model/alias/provider/token/cost | `requestlog/list` 每条记录含 `model` 字段 |

**关键差异：**
- **持久化深度**仍是最大差异：CM 用 SQLite 保存完整请求历史；CPA 现在保留最近 5000 条请求并落本地文件，定位问题够用但不是长期审计库
- 两边都能看到请求级模型/token/费用；CM 的 accountId 索引更强，CPA 的优势是同时保留 provider/alias/path/status/API key hash
- 两边都支持时间范围查询；CPA 使用 `after_ts` / `before_ts` Unix 秒参数

---

## 5. API Key 管理

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **列出 API Key** | `GET /api-keys` — 通用 key 列表 | `apikey/list` → `[ApiKeySummary]` 含创建时间、模型配置等 |
| **创建 API Key** | 无（只能预配置） | `apikey/create` → 可指定模型、推理强度、服务等级、协议类型、路由策略等 |
| **读取 API Key Secret** | 无 | `apikey/readSecret` → `{id,key}` |
| **更新 API Key 模型** | 无 | `apikey/updateModel` 修改 key 绑定的模型和参数 |
| **删除 API Key** | `DELETE /api-keys` | `apikey/delete` |
| **禁用/启用 API Key** | 无 | `apikey/disable` / `apikey/enable` |
| **Codex API Key** | `GET/PUT/PATCH/DELETE /codex-api-key` — 直连 Codex API 的 key | 包含在通用 `apikey/*` 里（通过 protocolType 区分） |
| **Claude API Key** | `GET/PUT/PATCH/DELETE /claude-api-key` | 包含在通用 `apikey/*` 里 |
| **Gemini API Key** | `GET/PUT/PATCH/DELETE /gemini-api-key` | 包含在通用 `apikey/*` 里 |
| **Vertex API Key** | `GET/PUT/PATCH/DELETE /vertex-api-key` | 无（Vertex 通过账号体系管理） |
| **API Key 聚合接口** | `GET /openai-compatibility` — 第三方兼容层配置 | `aggregateApi/*` — 完整的聚合 API CRUD + 连接测试 |
| **聚合 API 连接测试** | 无 | `aggregateApi/testConnection` → `{ok,latencyMs,statusCode}` |

**关键差异：**
- CPA 将不同 provider 的 key 分成独立端点管理（`/claude-api-key`、`/codex-api-key` 等）；CM 统一用 `apikey/*` + `protocolType` 区分
- CM 支持动态创建 API Key（带模型绑定和路由策略）；CPA 的 key 需要在配置文件中预设
- CM 有聚合 API（AggregateAPI）概念，支持多供应商路由；CPA 通过 `openai-compatibility` 配置兼容层

---

## 6. 请求日志

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **查看主日志** | `GET /logs?limit=N&after=timestamp` — 读取磁盘日志文件 | 无直接等价（CM 日志是系统日志，不通过 RPC 暴露） |
| **清空日志** | `DELETE /logs` — 截断日志文件 | `requestlog/clear` — 清空请求日志（不同于系统日志） |
| **请求记录列表** | `GET /request-history?limit&offset&q&status&model&provider&failed&after_ts&before_ts` — 最近 5000 条结构化请求，支持分页、搜索、状态/时间过滤 | `requestlog/list` → 支持分页、搜索、状态过滤、时间范围 |
| **请求记录详情** | `GET /request-history` 每条直接包含 method/path/status/model/alias/provider/auth/email/key hash/token/cost/latency；文本日志仍可用 `GET /request-log-by-id/:id` | `requestlog/list` 直接包含 token 消耗、模型、耗时等字段 |
| **错误请求日志** | `GET /request-error-logs` — 列出 error-*.log 文件 | `requestlog/error_list` — 列出网关错误记录 |
| **下载错误日志** | `GET /request-error-logs/:name` | 无（CM 错误日志是结构化数据，不是文件） |
| **清空错误日志** | 无专用端点 | `requestlog/error_clear` |
| **今日汇总** | `/token-stats` 的 `today` 字段；`/request-history` response `summary` 会按当前过滤条件聚合 token/cost/成功失败 | `requestlog/today_summary` 从 SQLite 聚合实际 Token 数据 |
| **日志大小配置** | `GET/PUT /logs-max-total-size-mb` | 无（CM 用 SQLite，大小由 DB 文件控制） |
| **错误日志文件数** | `GET/PUT /error-logs-max-files` | 无 |
| **日志写文件开关** | `GET/PUT /logging-to-file` | 无（CM 始终记录） |

**关键差异：**
- CPA 的"日志"仍包含文本系统日志，但 overlay 现在新增了独立的结构化 `request-history`（含 HTTP status、path、模型、token、费用、key hash）
- CM 的请求日志持久化在 SQLite，适合长期审计；CPA 的结构化历史是固定窗口持久化，适合运维排障和前端快速查询
- CM 有完整的错误分析（gateway error kind、CF-Ray、trace ID）；CPA 错误日志是原始 HTTP 日志

---

## 7. 网关与路由配置

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **路由策略** | `GET/PUT /routing/strategy` → `{strategy: "round-robin"\|...}` | `gateway/routeStrategy/get\|set` → `{strategy,options,manualPreferredAccountId}` |
| **手动指定账号** | 无 | `gateway/manualAccount/get\|set\|clear` — 强制路由到特定账号 |
| **配额超限策略** | `GET/PUT /quota-exceeded/switch-project` + `/switch-preview-model` | 包含在路由策略配置里 |
| **限流冷却** | 代码层面（`nextRetryAfter`，30min 间隔），无 API 可配 | 通过 `account/update.status` 和后台任务控制 |
| **传输超时** | `GET/PUT /max-retry-interval` — 重试间隔 | `gateway/transport/get\|set` → `{sseKeepaliveIntervalMs,upstreamStreamTimeoutMs,upstreamTotalTimeoutMs}` |
| **并发配置** | 无 | `gateway/concurrencyRecommendation/get` — 获取建议并发数 |
| **背压/限流** | 无 | 通过 `backgroundTasks.httpWorkerFactor\|Min` 配置 worker 数量 |
| **Keepalive** | `GET /keep-alive` 端点（客户端心跳） | `gateway/backgroundTasks.gatewayKeepaliveEnabled\|IntervalSecs` |
| **请求重试** | `GET/PUT /request-retry` + `/max-retry-interval` | 包含在 `backgroundTasks` 配置中 |
| **WS 认证** | `GET/PUT /ws-auth` | 无单独配置（WebSocket 走同一认证体系） |

---

## 8. 代理 / 上游配置

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **设置上游代理** | `GET/PUT/DELETE /proxy-url` — 全局 HTTP 代理 | `gateway/upstreamProxy/get\|set` — 同功能，额外返回 `envKey` 和 `requiresRestart` |
| **自定义 Headers** | `PATCH /auth-files/fields` 的 `headers` 字段 — 每账号设置 | 无（CM 通过 `aggregateApi` 的 `staticHeadersJson` 设置） |
| **URL 前缀** | `PATCH /auth-files/fields` 的 `prefix` 字段 | 无 |
| **账号级代理** | `PATCH /auth-files/fields` 的 `proxy_url` 字段 — 每账号独立代理 | 无（只有全局代理） |
| **模型前缀强制** | `GET/PUT /force-model-prefix` | 无 |
| **OpenAI 兼容模式** | `GET/PUT/PATCH/DELETE /openai-compatibility` | 包含在 `aggregateApi` 中（`protocolType="openai-compatible"`） |
| **AMP Code 上游** | `/ampcode/upstream-url\|api-key` — 专用的 AMP 上游 | 无 |

**关键差异：**
- CPA 支持"账号级"代理（每个 JSON 文件可有不同的 proxy_url/headers），CM 只有全局代理
- CM 的 `aggregateApi` 提供更完整的多供应商抽象（自定义认证方式、连接测试等）

---

## 9. 模型管理

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **列出可用模型** | `GET /auth-files/models?name=xxx` — 某账号支持的模型 | `apikey/models` — 所有可用模型（含远程刷新） |
| **静态模型定义** | `GET /model-definitions/:channel` | 无 |
| **模型目录管理** | 无 | `apikey/modelCatalogList\|Save\|Delete` — 完整的模型目录 CRUD |
| **OAuth 排除模型** | `GET/PUT/PATCH/DELETE /oauth-excluded-models` | 无 |
| **OAuth 模型别名** | `GET/PUT/PATCH/DELETE /oauth-model-alias` | 无 |
| **AMP 模型映射** | `/ampcode/model-mappings\|force-model-mappings` | 无（CM 在 `apikey/create` 时直接绑定 `modelSlug`） |
| **模型级路由策略** | 无 | `apikey/create` 的 `rotationStrategy\|accountPlanFilter` 字段 |
| **推理强度设置** | 无 | `apikey/create\|updateModel` 的 `reasoningEffort` 字段 |
| **服务等级设置** | 无 | `apikey/create\|updateModel` 的 `serviceTier` 字段 |
| **Codex 最新版本** | `GET /latest-version` | `gateway/codexLatestVersion/get` |

---

## 10. 后台任务配置

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **配额轮询开关** | 无 API（代码硬编码 3h 间隔） | `gateway/backgroundTasks` 的 `usagePollingEnabled\|usagePollIntervalSecs` |
| **配额刷新 Worker 数** | `codexQuotaWorkers = 8`（常量） | `usageRefreshWorkers` 可配置 |
| **Token 刷新轮询** | `service.go` 内 15min 自动刷新（无 API） | `tokenRefreshPollingEnabled\|tokenRefreshPollIntervalSecs` 可配置 |
| **Keepalive 配置** | 无 | `gatewayKeepaliveEnabled\|IntervalSecs` |
| **HTTP Worker 配置** | 无 | `httpWorkerFactor\|Min` + `httpStreamWorkerFactor\|Min` |

---

## 11. 版本检查

| 功能 | CPA | Codex-Manager |
|------|-----|---------------|
| **当前版本** | 响应 Header `X-CPA-VERSION`/`X-CPA-COMMIT`/`X-CPA-BUILD-DATE` | `initialize` RPC 返回 `{version,userAgent}` |
| **最新版本检查** | `GET /latest-version` — 从远端检查 | `gateway/codexLatestVersion/get` |

---

## 12. CPA 独有功能

这些功能在 Codex-Manager 中没有对应实现：

| 功能 | CPA 端点 | 说明 |
|------|----------|------|
| **Kimi OAuth** | `GET /kimi-auth-url` | 支持 Moonshot/Kimi 账号登录 |
| **Antigravity OAuth** | `GET /antigravity-auth-url` | 支持 Google Antigravity 账号 |
| **账号级自定义 Headers** | `PATCH /auth-files/fields` 的 `headers` | 每账号可设置独立 HTTP 头 |
| **账号级代理** | `PATCH /auth-files/fields` 的 `proxy_url` | 每账号独立的 HTTP 代理 |
| **AMP Code 模块** | `/ampcode/*` (15 个端点) | 专用的模型映射/转发层 |
| **OAuth 模型别名** | `/oauth-model-alias` | 将模型名映射到 OAuth 账号 |
| **OAuth 排除模型** | `/oauth-excluded-models` | 某些模型不走 OAuth 路由 |
| **WebSocket 认证开关** | `/ws-auth` | WS 连接是否需要认证 |
| **调试模式** | `GET/PUT /debug` | 运行时切换调试输出 |
| **直接 API 调用** | `POST /api-call` | 通过代理发起任意 API 请求 |
| **多 Provider 支持** | Claude/Gemini/Vertex/Kimi/Antigravity 各自的 key 端点 | CM 目前仅专注 OpenAI/Codex |

---

## 13. CM 独有功能

这些功能在 CPA 中没有对应实现：

| 功能 | CM RPC 方法 | 说明 |
|------|------------|------|
| **SQLite 长期请求日志** | `requestlog/list\|summary\|today_summary` | SQLite 记录每次请求的 token、费用、模型、耗时；CPA 只有固定窗口文件持久化 |
| **服务端账号分页查询** | `account/list` | 账号列表分页/搜索/过滤在服务端完成；CPA 当前仍是全量返回、前端过滤 |
| **直接清理不可用账号** | `account/deleteUnavailableFree` | 一键删除所有不可用 Free 账号；CPA 只提供候选列表，仍需用户确认后批量删除 |
| **手动指定路由账号** | `gateway/manualAccount/set` | 强制所有请求走指定账号 |
| **订阅/计划信息** | Subscription 接口 | 查询账号的付费计划、到期时间、自动续费状态 |
| **聚合 API** | `aggregateApi/*` | 多供应商抽象层（第三方兼容 API），含连接测试 |
| **模型目录管理** | `apikey/modelCatalogList\|Save\|Delete` | 可持久化管理可用模型列表 |
| **动态创建 API Key** | `apikey/create` | 运行时创建新 key 并绑定模型/路由策略 |
| **传输超时配置** | `gateway/transport/get\|set` | SSE/上游超时毫秒级精细配置 |
| **并发度配置** | `gateway/backgroundTasks` | Worker 数量、轮询间隔均可配置 |
| **启动快照（CM 原生）** | `startup/snapshot` | 一次返回所有初始化数据（账号+配额+日志汇总）；CPA overlay 也有 `GET /startup-snapshot`，但字段按 CPA 面板需要裁剪 |

---

## 14. 设计差异总结

### 架构风格

| 维度 | CPA | Codex-Manager |
|------|-----|---------------|
| **API 风格** | REST HTTP（GET/POST/PUT/PATCH/DELETE） | JSON-RPC 2.0 |
| **存储** | 文件系统（JSON 文件 + 内存） | SQLite 数据库 |
| **状态持久化** | 进程内存 + 磁盘 JSON | SQLite（跨重启持久） |
| **部署形态** | 轻量级代理服务（可无头运行） | 带前端 UI 的桌面/服务应用 |
| **多 Provider** | 原生支持（Claude/Gemini/Vertex/Codex/Kimi） | 主要针对 OpenAI/Codex |

### 核心设计理念差异

| 方面 | CPA 思路 | CM 思路 |
|------|----------|---------|
| **账号管理** | "文件即账号"，无状态，JSON 文件是数据源 | 账号记录存 DB，文件只是导入/导出格式 |
| **配额数据** | 实时拉取（每次查询都请求 wham API） | 缓存在 DB，后台轮询更新（configurable） |
| **Token 统计** | 进程内聚合 + 最近 5000 条结构化请求持久化 | SQLite 持久化，可查长期历史 |
| **刷新 Token** | "触发后异步"，不知道单账号结果 | 同步或异步均支持，返回每账号结果 |
| **模型配置** | 模型到 OAuth 账号的映射在 CPA 侧配置 | 模型绑定在 API Key 上，更灵活 |
| **可配置性** | 基础配置（适合稳定运行的代理） | 精细化运维配置（Worker数/超时/轮询间隔均可调） |

### 互补关系

```
  CPA 擅长：                          CM 擅长：
  ┌─────────────────────────────┐    ┌──────────────────────────────┐
  │ • 多 Provider 统一接入       │    │ • 长期 Token 消耗历史追踪     │
  │ • 轻量级无头部署             │    │ • 精细化账号运维（标签/分组）  │
  │ • 账号级自定义配置           │    │ • SQLite 长期历史查询         │
  │ • AMP Code 模型映射          │    │ • 动态 API Key 创建管理       │
  │ • Kimi/Antigravity 支持      │    │ • 聚合 API / 多供应商路由     │
  └─────────────────────────────┘    └──────────────────────────────┘
```

---

## 附录：API 数量统计

### CPA Management API
| 分类 | 端点数 |
|------|--------|
| 配置管理 | 22 |
| API Key 管理（5种Provider） | 24 |
| 授权文件管理 | 9 |
| 配额与Token统计 | 5 |
| 日志与诊断 | 9 |
| OAuth 流程 | 9 |
| 路由与网关 | 10 |
| AMP Code | 15 |
| 其他 | 4 |
| **合计** | **~107** |

### Codex-Manager RPC
| 分类 | 方法数 |
|------|--------|
| 账号管理 | 13 |
| Token刷新/认证 | 7 |
| 配额与用量 | 5 |
| API Key 管理 | 9 |
| 聚合 API | 6 |
| 请求日志 | 6 |
| 网关配置 | 10 |
| 服务配置 | 4 |
| **合计** | **~60** |

---

*文档生成日期：2026-05-04；最新更新：2026-05-07*  
*分析基于 CPA v6 源码 + Codex-Manager main 分支；2026-05-07 更新已纳入 overlay 新增的 request-history 查询与 auth-files maintenance-summary*
