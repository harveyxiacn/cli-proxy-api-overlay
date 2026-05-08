# Overlay 后续功能模块设计与开发规范

> 文档：`docs/OVERLAY_FEATURE_MODULES_DESIGN.md`
> 日期：2026-05-07
> 范围：CLIProxyAPI overlay 管理面板的后续功能模块设计、优先级、接口规范、前端 UX 规范、测试与 overlay 维护规范。
> 目标：在不破坏 CPA 上游升级能力的前提下，把 overlay 从"管理面板增强"继续演进为"账号池运维、成本分析、路由诊断、部署治理"的完整运维层。

---

## 1. 总体原则

### 1.1 产品原则

1. **先诊断，后自动化**
   任何可能批量改变账号状态、删除文件、触发 OAuth、重启服务的功能，都必须先提供 dry-run / preview。默认只展示建议，不直接执行破坏性动作。**v1 不引入自动调度执行；所有 apply 动作必须由用户在 UI 上显式确认。** "由规则自动 apply（cron / 后台调度）"留待 v2 评估，且必须独立开关。
2. **服务端给结论，前端给解释**
   健康状态、候选列表、容量预测、限额状态应由后端统一计算，保证团队成员看到一致结果；前端负责解释原因、排序、过滤、确认动作。
3. **固定窗口先行，长期存储可选**
   现有 JSON/JSONL 固定窗口足够支撑运维排障。只有当趋势分析、审计、长期报表确实需要时，再引入 SQLite，且必须可关闭。
4. **显式安全边界**
   原始 API Key、OAuth token、refresh token 不进入前端、不进入日志、不进入 webhook、**不进入任何持久化文件（含 SQLite 的 raw_json 字段）**。需要标识时只使用 hash、preview 或文件名。
5. **团队协作优先**
   功能要方便远程 VPS 部署和多人协作：可分享链接、可导出诊断包、可追踪操作历史、可回滚。

### 1.2 技术原则

1. **新后端能力一律放在 overlay 树**
   所有新文件必须放在：

   ```text
   overlay/files/internal/api/handlers/management/
   ```

   命名遵循现有约定：纯新增功能用 `<feature>.go`（如 `webhooks.go`、`token_stats.go`），需要把若干小路由聚合在一起的用 `ext_<feature>_routes.go`（如 `ext_auth_files_routes.go`）。**不要直接在 CPA 上游目录 `internal/api/handlers/management/` 建文件**，那会破坏 overlay 隔离并在下次 `update-cpa.bat` 时被覆盖。

   通过 `init() + RegisterExtensionRoute` 注册路由：

   ```go
   func init() {
       RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
           rg.GET("/feature", h.GetFeature)
       })
   }
   ```

   不要直接改 `server.go` 加路由。
2. **避免新增 patch**
   除非功能必须进入 CPA 核心请求链或必须修改 CPA struct（如扩展 config schema），否则不得 patch 上游文件。需要影响路由行为时，先评估是否可用 usage plugin、event bus、现有 handler、前端 workflow 达成。
3. **状态文件放在 auth-dir 或 data-dir**
   面板扩展的持久化文件遵循以下规则：

   | 类别                  | 路径                          | 现有示例                                                       |
   | --------------------- | ----------------------------- | -------------------------------------------------------------- |
   | 运行统计 / 历史       | `<config-dir>/data/<file>` | `data/token_stats.json`、`data/request_history.jsonl`      |
   | 账号配置 / 运维策略   | `<auth-dir>/<file>`         | `<auth-dir>/api-key-limits.json`、`<auth-dir>/webhooks.json` |

   文档中出现的 `<auth-dir>/foo.json` 一律是占位符（即 CPA 配置里的 `auth-dir`），**不是字面目录 "auths/"**。Go 端常量命名继续走 `webhooksFilename`、`apiKeyLimitsFilename` 这种 `camelCaseFilename` 风格，文件名用 kebab-case。
4. **所有批量动作必须返回 per-item 结果**

   ```json
   {
     "total": 10,
     "succeeded": 8,
     "failed": 2,
     "results": [
       {"name": "a.json", "ok": true, "message": "queued"},
       {"name": "b.json", "ok": false, "error": "not found"}
     ]
   }
   ```
5. **每个新增模块必须有测试**

   - 后端：至少覆盖成功路径、校验失败、边界输入、持久化读写。
   - 前端：当前项目未配置前端测试框架，最低要求 `pnpm run build` 通过；复杂纯函数应抽出并后续补测试框架。

---

## 2. 模块优先级总览

| 优先级 | 模块                  | 目标                                       | 主要收益           | 侵入性 |
| ------ | --------------------- | ------------------------------------------ | ------------------ | ------ |
| P0     | 账号健康诊断中心      | 统一判断账号是否健康、为什么异常、建议动作 | 降低账号池维护成本 | 低     |
| P0     | 自动维护规则 dry-run  | 把人工维护动作规则化，但先不自动执行       | 减少重复操作       | 中低   |
| P1     | Token 报表中心        | 按时间/模型/provider/API Key 分析消耗      | 成本透明           | 低     |
| P1     | API Key 管理增强      | 把限额、用量、废弃 key、失败率合并         | 控制成本和滥用     | 低     |
| P1     | 路由实验台            | 解释/模拟为什么选中某账号                  | 快速定位路由异常   | 中     |
| P1     | 容量预测              | 预测账号池还能撑多久                       | 提前补池/降载      | 中     |
| P2     | 配置变更审计          | 记录谁改了什么                             | 团队协作与追责     | 低     |
| P2     | 备份与恢复中心        | auth/config/data 备份、下载、恢复          | 降低误删风险       | 中     |
| P2     | System 诊断增强       | 一键导出诊断包与健康检查                   | 部署排障           | 低     |
| P2     | 全局搜索/命令面板增强 | 搜账号/key/请求/错误并快速跳转             | 提升操作效率       | 低     |
| P2     | 账号详情独立路由      | 可分享账号详情页                           | 团队协作           | 中     |
| P3     | SQLite 分析库         | 长期请求/审计/配额历史                     | 长期报表           | 中高   |

推荐实施顺序：

```text
账号健康诊断中心
→ 自动维护 dry-run
→ 配置变更审计（早接入，让后续 apply 都能写 audit）
→ Token 报表中心
→ 路由实验台 / 容量预测
→ 备份 / 系统诊断
→ SQLite 分析库
```

> 把 audit log 提到 P1 之前的实施位置，避免后续每个破坏性动作都要回头补 audit hook。包 A、B、C 的逻辑分组保持不变（见 §20）。

---

## 3. P0：账号健康诊断中心

### 3.1 目标

把分散在以下页面/接口的信息合成单个账号健康视图：

- `GET /auth-files`
- `GET /auth-files/maintenance-summary`
- `GET /auth-stats`
- `GET /codex-quota`
- `GET /request-history`
- `GET /issues`
- `GET /alerts`

输出每个账号的健康分、异常原因、建议动作和可批量选择的候选集合。

### 3.2 后端 API 设计

新增文件：

```text
overlay/files/internal/api/handlers/management/account_health.go
overlay/files/internal/api/handlers/management/account_health_test.go
```

端点：

```http
GET /v0/management/account-health
GET /v0/management/account-health/:name
POST /v0/management/account-health/recompute
```

`GET /account-health` response（说明：`group`、`tags`、`email` 来自 `auth.Metadata`，并非所有 provider 的 auth 都填，前端必须按"可空字段"渲染）：

```json
{
  "summary": {
    "total": 281,
    "healthy": 240,
    "warning": 28,
    "critical": 13,
    "needs_relogin": 4,
    "quota_low": 7,
    "stale": 12
  },
  "items": [
    {
      "name": "codex-001.json",
      "id": "codex-001.json",
      "provider": "codex",
      "email": "user@example.com",
      "group": "free-pool",
      "tags": ["shared"],
      "score": 92,
      "level": "healthy",
      "reasons": [
        {
          "code": "quota_ok",
          "severity": "info",
          "message": "7d remaining 96.5%"
        }
      ],
      "suggested_actions": [
        {
          "type": "none",
          "label": "无需处理",
          "risk": "none"
        }
      ],
      "last_request_at": 1778120000,
      "last_refresh_at": "2026-05-07T10:20:00Z",
      "quota": {
        "primary_remaining": 62.4,
        "secondary_remaining": 96.5
      },
      "request_window": {
        "requests_24h": 45,
        "failed_24h": 1,
        "failure_rate_24h": 0.022
      }
    }
  ],
  "candidates": {
    "relogin": ["a.json"],
    "disable": ["b.json"],
    "warmup": ["c.json"],
    "delete_review": ["d.json"]
  },
  "computed_at": 1778123456
}
```

> 字段约定：`email / group / tags` 可空（auth metadata 里没有就省略）。`quota.primary_remaining`、`quota.secondary_remaining` 仅 OAuth 类账号有，API Key auth 省略。

### 3.3 健康评分规范

#### 3.3.1 reason code 与扣分

每个 reason code 唯一，**同一 root cause 触发的多个 reason code 在最终响应中按优先级归并为一条**（参考 §3.3.3）。表格列出的扣分是"该 reason 单独触发时的扣分基线"。

| reason code              | 触发条件                                                | 扣分 | 默认 severity |
| ------------------------ | ------------------------------------------------------- | ---: | ------------- |
| `disabled`             | `auth.Disabled == true`                              |  -30 | warning       |
| `status_error`         | `auth.Status == "error"`                              |  -45 | critical      |
| `needs_relogin`        | `auth.StatusMessage` 含 reused/invalid_grant/expired  |  -60 | critical      |
| `unavailable`          | `auth.Unavailable == true`                            |  -35 | warning       |
| `failure_rate_high`    | 24h `failure_rate >= 0.30 && requests >= 10`          |  -35 | warning       |
| `failure_rate_severe`  | 24h `failure_rate >= 0.60 && requests >= 10`          |  -60 | critical      |
| `consecutive_failures` | 连续失败 ≥ 5（来自 auth-stats）                        |  -30 | warning       |
| `stale`                | 7 天无成功请求                                          |  -20 | warning       |
| `quota_low`            | primary 或 secondary remaining < 20%                    |  -20 | warning       |
| `quota_critical`       | primary 或 secondary remaining < 5%                     |  -45 | critical      |

#### 3.3.2 reason 互斥与归并组

下列 reason 视为同一根因的不同表征，最终响应中**只保留 severity 最高的一条**（其余在 debug 视图下可见，主响应不重复展示）：

| 归并组         | 包含的 reason                                                          |
| -------------- | ---------------------------------------------------------------------- |
| `oauth_broken` | `status_error`、`needs_relogin`、`unavailable`（仅当 status=error 时） |
| `failure_rate` | `failure_rate_high`、`failure_rate_severe`                             |
| `quota`        | `quota_low`、`quota_critical`                                          |

扣分仍按"组内最大值"计入，避免单一根因被三重扣分。

#### 3.3.3 level 计算（伪代码）

```text
score = clamp(100 - sum(merged_reason_penalties), 0, 100)

if needs_relogin in reasons:
    level = "critical"          # 强制覆盖
elif disabled and no other reasons:
    level = "warning"           # 强制覆盖：单纯 disabled 不算 critical
elif provider has no quota concept and only quota_* reasons would have triggered:
    skip quota reasons          # API Key auth 不扣 quota 分
elif score >= 80:
    level = "healthy"
elif score >= 50:
    level = "warning"
else:
    level = "critical"
```

### 3.4 建议动作规范

动作类型：

| type               | 含义                     | 风险   |
| ------------------ | ------------------------ | ------ |
| `relogin`        | 进入 OAuth 修复/批量重登 | medium |
| `warmup`         | 发起连通性测试           | low    |
| `disable`        | 禁用账号                 | medium |
| `enable`         | 启用账号                 | medium |
| `lower_priority` | 降低优先级               | low    |
| `move_group`     | 移动到隔离 group         | low    |
| `delete_review`  | 加入删除复核候选         | high   |
| `none`           | 无需处理                 | none   |

破坏性动作（disable/delete）不得在诊断接口直接执行。

### 3.5 前端 UX

新增页面：

```text
frontend/src/pages/AccountHealth.tsx
```

入口：

- Sidebar：`账号健康`
- CommandPalette：`账号健康诊断`
- Accounts 页面顶部 tile 可跳转

页面结构：

1. 顶部 summary cards：Healthy / Warning / Critical / Needs Relogin / Quota Low / Stale
2. 筛选栏：level / provider / group / tag / reason code
3. 健康表：
   - 账号
   - score 环形/进度条
   - level badge
   - 主要原因（归并后）
   - 建议动作
   - 最近请求
   - quota remaining
4. 批量候选区：
   - 选需重登
   - 选需 warmup
   - 选建议禁用
   - 选删除复核

### 3.6 测试要求

后端测试：

- healthy 账号 score >= 80。
- needs_relogin 必须进入 critical 和 relogin candidates。
- disabled 账号不应被 delete candidate 默认选中。
- quota low 账号进入 quota_low summary。
- request history 失败率正确计算。
- **同一 root cause 触发多 reason 时，主响应只保留一条**（归并组验证）。
- **API Key auth 不扣 quota 分**。

---

## 4. P0：自动维护规则 Dry-run

### 4.1 目标

把人工重复动作转为规则，但 v1 只做 dry-run 和**手动确认 apply**。**v1 不允许后台自动 apply**（无 cron、无 watcher 触发）；自动调度执行留给 v2，并须独立配置开关。

### 4.2 后端 API

新增文件：

```text
overlay/files/internal/api/handlers/management/maintenance_rules.go
overlay/files/internal/api/handlers/management/maintenance_rules_test.go
```

持久化：

```text
<auth-dir>/maintenance-rules.json
```

Go 端常量命名：`maintenanceRulesFilename = "maintenance-rules.json"`。

端点：

```http
GET    /v0/management/maintenance-rules
PUT    /v0/management/maintenance-rules
DELETE /v0/management/maintenance-rules/:id
POST   /v0/management/maintenance-rules/dry-run
POST   /v0/management/maintenance-rules/apply
```

规则结构：

```json
{
  "id": "disable-high-failure-rate",
  "name": "连续失败自动禁用候选",
  "enabled": true,
  "mode": "dry_run",
  "conditions": [
    {"field": "failure_rate_24h", "op": ">=", "value": 0.6},
    {"field": "requests_24h", "op": ">=", "value": 10}
  ],
  "action": {
    "type": "disable",
    "params": {"reason": "high failure rate"}
  },
  "scope": {
    "providers": ["codex"],
    "groups": ["free-pool"],
    "tags_any": []
  },
  "created_at": 1778123456,
  "updated_at": 1778123456
}
```

Dry-run response：

```json
{
  "dry_run_token": "dr_1778123456_3a9f",
  "computed_at": 1778123456,
  "expires_at": 1778124056,
  "rules": 3,
  "matched_accounts": 8,
  "actions": [
    {
      "id": "act_1",
      "rule_id": "disable-high-failure-rate",
      "target": "a.json",
      "action": "disable",
      "risk": "medium",
      "would_change": true,
      "reason": "failure_rate_24h=0.72"
    }
  ]
}
```

字段说明：

- `dry_run_token`：本次 dry-run 的稳定引用，apply 必须带它，**且必须未过期**（默认 10 分钟）。
- `actions[].id`：本次 dry-run 内每个 action 的稳定 id（建议 `rule_id + target` 的 hash 前缀），apply 时按 id 精确指代。

### 4.3 v1 支持的条件字段

| field                         | 来源                               |
| ----------------------------- | ---------------------------------- |
| `level`                     | account-health                     |
| `score`                     | account-health                     |
| `needs_relogin`             | maintenance-summary/account-health |
| `unavailable`               | auth-files                         |
| `disabled`                  | auth-files                         |
| `failure_rate_24h`          | request-history/auth-stats         |
| `requests_24h`              | request-history/auth-stats         |
| `quota_primary_remaining`   | codex-quota                        |
| `quota_secondary_remaining` | codex-quota                        |
| `last_success_age_hours`    | auth stats/request history         |
| `provider`                  | auth-files                         |
| `group`                     | auth-files (metadata)              |
| `tag`                       | auth-files (metadata)              |

### 4.4 v1 支持动作

| action         | 是否 v1 执行           | 说明                                   |
| -------------- | ---------------------- | -------------------------------------- |
| `select`     | 是                     | 只返回候选                             |
| `warmup`     | 是                     | 调用现有 warmup                        |
| `disable`    | 是，仅手动 apply + 二次确认 | 调用 `auth-files/status-batch`        |
| `enable`     | 是，仅手动 apply + 二次确认 | 调用 `auth-files/status-batch`        |
| `move_group` | 是，仅手动 apply + 二次确认 | 调用 `auth-files/fields-batch`        |
| `add_tag`    | 是，仅手动 apply       | 调用 `auth-files/fields-batch`        |
| `delete`     | v1 不执行              | 只进入 `delete_review` candidates    |
| `relogin`    | v1 只创建 repair batch | 不自动完成 OAuth                       |

> "可执行" ≠ "自动执行"。v1 任何 apply 都必须由用户在 UI 上点击 confirm 才能落地，符合 §1.1.1 "默认只展示建议"。后台自动 apply（cron / event-driven）一律延后到 v2。

### 4.5 安全规范

- 默认所有规则 `mode=dry_run`。
- `apply` 必须携带：`{"dry_run_token": "...", "action_ids": ["act_1", ...]}`。后端在 token 仍有效时按 action_ids 精确执行；**不允许重新隐式计算**。token 过期 → 422 + 提示重新 dry-run。
- `risk == "high"` 的动作必须二次确认（前端 modal + 后端要求 `confirmed: true` 字段）。
- 每次 apply 写入 audit log（依赖 §9 已落地）。

---

## 5. P1：Token 报表中心

### 5.1 目标

把现在的 TokenStats / RequestHistory / Analytics 合成更完整的成本报表。

### 5.2 后端 API

优先复用现有：

- `GET /token-stats`：返回的列表中每条记录已包含 `api_key_hash`（见 `token_stats.go` 中 `APIKeyHash` 字段）；by-API-Key 视图可在前端聚合，或调用下方新接口。
- `GET /request-history`：明细日志。
- `GET /analytics/usage-daily`、`/analytics/usage-hourly`、`/analytics/top-auths`、`/analytics/errors`、`/analytics/storage-summary`。

如现有聚合不够，新增（**后端做聚合，避免前端跨数千条记录二次 reduce**）：

```http
GET /v0/management/token-reports/summary?range=24h|7d|30d
GET /v0/management/token-reports/by-model?range=...
GET /v0/management/token-reports/by-provider?range=...
GET /v0/management/token-reports/by-api-key?range=...
GET /v0/management/token-reports/export.csv?range=...
```

> ⚠️ 30d 范围超出 `request_history.jsonl` 默认 ring buffer 容量（`requestLogCapacity`）时，应在 response 顶层回 `truncated: true` 并附 `actual_range_seconds`，由前端提示用户"启用 SQLite 才能覆盖完整 30d"。

### 5.3 报表维度

| 维度     | 指标                                     |
| -------- | ---------------------------------------- |
| 总览     | tokens、cost、requests、failure rate     |
| 时间     | hourly/daily trend                       |
| 模型     | tokens/cost by model/alias               |
| provider | codex/claude/gemini/vertex               |
| API key  | api_key_hash 聚合                        |
| 账号     | auth_id/email 聚合                       |
| 错误     | failed requests by status/model/provider |

### 5.4 前端页面

新增或升级：

```text
frontend/src/pages/TokenReports.tsx
```

Tabs：

- Overview
- Time
- Model
- Provider
- API Key
- Account
- Errors
- Export

### 5.5 CSV 导出规范

CSV 必须：

- UTF-8 BOM 可选，优先无 BOM。
- 时间使用 ISO 8601。
- 金额统一 `estimated_usd`，保留 6 位小数。
- 不导出原始 API key。

---

## 6. P1：API Key 管理增强

### 6.1 目标

把 API Key 的配置、用量、限额、异常和废弃检测放在同一页面。

### 6.2 已有基础

当前已有：

- API Key 页面
- `GET /api-key-usage`
- `GET /token-stats` 中每条记录的 `api_key_hash`
- per-API-Key 软限额模块

### 6.3 增强项

1. **Key 画像**

   - name
   - provider
   - hash
   - preview
   - daily limit
   - today tokens
   - 7d tokens
   - estimated cost
   - last used
   - failure rate
2. **废弃 key 检测（注意窗口约束）**

   - 配置存在但 N 天无请求。
   - 有请求但失败率长期 100%。
   - key 对应 provider 已无可用模型。

   > 实际可观察窗口受 `request_history.jsonl` ring buffer 限制。**SQLite 未启用前**，后端最多基于 `last_used_at` 做"超出可见窗口即视为 unused"判定，response 字段命名为 `unused_within_window`，并附 `window_seconds` 让前端展示真实跨度（例如 "Unused in last 7d"），而不是固定 30d。SQLite 启用后，字段名升级为 `unused_30d`，使用真实 30 天数据。
3. **风险标记**

   - exceeded
   - warn
   - unused
   - high cost
   - high failure
   - orphan active key

### 6.4 API 建议

```http
GET /v0/management/api-key-insights
```

response（`unused_within_window` 与 `window_seconds` 由后端基于实际可见窗口生成）：

```json
{
  "summary": {
    "configured": 12,
    "active_today": 5,
    "unused_within_window": 3,
    "window_seconds": 604800,
    "over_limit": 1,
    "high_failure": 2
  },
  "items": [
    {
      "hash": "abcdef1234567890",
      "preview": "sk-...abcd",
      "name": "team-a",
      "providers": ["codex"],
      "status": "warn",
      "today_tokens": 450000,
      "daily_limit": 500000,
      "estimated_usd_today": 1.23,
      "failure_rate_24h": 0.04,
      "last_used_at": 1778123456,
      "reasons": ["daily usage >= 80%"]
    }
  ]
}
```

---

## 7. P1：路由实验台

### 7.1 目标

解释"为什么这次请求选中了这个账号 / 为什么没选到预期账号"，并支持模拟一次请求路由的结果（**不发真实 provider 请求**）。

### 7.2 后端 API

> 现状：`POST /v0/management/routing/explain` 已存在（`overlay/files/internal/api/handlers/management/analytics.go:168`），但**当前实现不读 body**，直接遍历 `manager.List()` 返回全表，reasons 仅 `available / healthy / quota exceeded`。本设计**不破坏 explain 现有契约**，而是**新增 simulate**承担入参/模拟职责。

保留现有：

```http
POST /v0/management/routing/explain
```

继续返回当前 manager 的全候选解释。后续允许扩展 reasons 词表（向后兼容地新增 reason code）。

新增 simulation：

```http
POST /v0/management/routing/simulate
```

请求：

```json
{
  "provider": "codex",
  "model": "gpt-5.4",
  "api_key_hash": "abcdef1234567890",
  "group": "free-pool",
  "strategy": "quota-aware",
  "include_disabled": false,
  "quota_mode": "cached"
}
```

response：

```json
{
  "selected": "a.json",
  "strategy": "quota-aware",
  "quota_mode": "cached",
  "candidates": [
    {
      "name": "a.json",
      "score": 98,
      "selected": true,
      "reasons": ["provider match", "quota secondary remaining 96%", "healthy"]
    },
    {
      "name": "b.json",
      "score": 0,
      "selected": false,
      "skip_reasons": ["needs relogin", "disabled"]
    }
  ]
}
```

reason / skip_reason 词表（首版）：

- reasons：`provider match`、`group match`、`api_key match`、`healthy`、`quota primary remaining N%`、`quota secondary remaining N%`、`prefix match`
- skip_reasons：`disabled`、`unavailable`、`needs relogin`、`provider mismatch`、`group mismatch`、`api_key mismatch`、`quota exceeded`、`status error`

### 7.3 UI

页面：

```text
frontend/src/pages/RoutingLab.tsx
```

布局：

- 左侧输入：provider/model/API key/group/strategy/quota_mode
- 右侧结果：selected account + candidate table
- 候选表展示：
  - score
  - matched conditions
  - skip reasons
  - health score
  - quota remaining

### 7.4 规范

- simulate **不发真实 provider 请求**，不修改账号状态。
- `quota_mode` 默认 `cached`，仅读取 conductor 内存里的 `auth.Quota` 与上次 `/codex-quota` 持久化结果，不调用 wham API。
- `quota_mode = fresh` 仅在用户在 UI 上明确点击"重新拉取 quota"时才发送，并复用 `/codex-quota` 现有的并发上限与节流（`codexQuotaWorkers = 8`）。**默认绝不主动发起。**

---

## 8. P1：容量预测

### 8.1 目标

预测当前账号池在现有消耗速度下还能支撑多久。

### 8.2 单位定义（必读）

CPA 现有 quota 数据是百分比（`UsedPercent` / `RemainingPercent`，见 `codex_quota.go:34-40`），且 codex 同时存在多个长度不同的窗口（5h primary、7d secondary、若干 extra window），不能直接相加。本设计统一引入 **AE（Account-Equivalent）**：

> **1 AE** = "一个账号在指定窗口下从 0% 到 100% 的满额"。本预测专注 secondary（7d）窗口，所以默认 1 AE = 一个账号在 7 天内可消耗的全部 secondary 容量。

换算：

```text
remaining_ae(account)            = secondary_remaining_percent / 100
pool_remaining_ae                = sum(remaining_ae(account)) over available accounts
burn_rate_ae_per_day             = sum(used_percent_in_window / 100) / window_days
estimated_days_remaining         = pool_remaining_ae / burn_rate_ae_per_day
```

> primary（5h）窗口不参与 AE 聚合（窗口太短噪声大），只在 response 里附 `primary_pressure_pct = avg(primary_used_percent)` 作为参考。

### 8.3 数据源

- `codex-quota`：每账号 secondary `RemainingPercent`、窗口元数据。
- `request-history` / `token-stats`：最近请求与 token 速率（用于 sanity check，不直接喂入 AE 公式）。
- `account-health`：排除 `disabled / unavailable / needs_relogin` 的账号。

### 8.4 API

```http
GET /v0/management/capacity-forecast?range=1h|6h|24h&group=free-pool
```

response：

```json
{
  "range": "24h",
  "summary": {
    "available_accounts": 251,
    "secondary_capacity_remaining_ae": 242.35,
    "burn_rate_ae_per_day": 8.65,
    "estimated_days_remaining": 28.0,
    "primary_pressure_pct": 12.4,
    "pool_risk": "green"
  },
  "groups": [
    {
      "group": "free-pool",
      "accounts": 251,
      "remaining_ae": 242.35,
      "burn_rate_ae_per_day": 8.65,
      "estimated_days_remaining": 28,
      "pool_risk": "green"
    }
  ],
  "recommendations": [
    "当前 7d 池可支撑约 28 天",
    "无需补账号"
  ]
}
```

### 8.5 风险等级

> 池容量风险使用 `green/amber/red/unknown`，**不复用账号 health 的 `healthy/warning/critical`**，避免前端 badge 组件混淆。

| days remaining | pool_risk |
| -------------: | --------- |
|           >= 7 | green     |
|            2-7 | amber     |
|            < 2 | red       |
|       无法计算 | unknown   |

---

## 9. P2：配置变更审计

### 9.1 目标

记录所有管理面板上的重要操作，便于团队协作、排错、回滚。**建议先于 P2 其他模块落地**（见 §2 实施顺序），避免每个破坏性接口都要回头补 audit hook。

### 9.2 持久化

```text
<config-dir>/data/audit_log.jsonl
```

### 9.3 事件结构

```json
{
  "id": "audit_1778123456_001",
  "ts": 1778123456,
  "actor": {
    "management_key_hash": "abc123",
    "ip": "203.0.113.1",
    "user_agent": "Mozilla/5.0"
  },
  "action": "auth.disable_batch",
  "target": {
    "type": "auth",
    "ids": ["a.json", "b.json"]
  },
  "request": {
    "path": "/v0/management/auth-files/status-batch",
    "method": "POST"
  },
  "result": {
    "ok": true,
    "succeeded": 2,
    "failed": 0
  }
}
```

### 9.4 API

```http
GET /v0/management/audit-log?limit=200&offset=0&q=&action=&target=&after_ts=&before_ts=
GET /v0/management/audit-log/export.csv
```

### 9.5 必审计动作

- auth upload/delete/delete-batch/status-batch/fields-batch
- OAuth repair/batch
- token stats reset
- request history clear
- API key limit CRUD
- webhook CRUD/test
- system update trigger
- backup restore
- maintenance rule apply

---

## 10. P2：备份与恢复中心

### 10.1 目标

降低误删 auth/config/data 的风险。

### 10.2 备份范围

> 路径前缀 `<auth-dir>` / `<config-dir>` 是占位符，对应 CPA 配置中的 `auth-dir` 和 `config-dir`。

默认包含：

```text
<config-file>                                # config.yaml
<auth-dir>/*.json                            # 所有账号文件
<auth-dir>/api-key-limits.json
<auth-dir>/webhooks.json
<auth-dir>/maintenance-rules.json
<config-dir>/data/token_stats.json
<config-dir>/data/request_history.jsonl
<config-dir>/data/audit_log.jsonl
```

**任一文件不存在时静默跳过**，并在备份 manifest 中记录 `skipped: ["maintenance-rules.json"]`，避免依赖未实现模块时报错（例如包 C 的备份功能先于 §9 audit log 落地的场景）。

可选排除：

- request history
- audit log
- token stats

### 10.3 API

```http
GET  /v0/management/backups
POST /v0/management/backups
GET  /v0/management/backups/:id/download
POST /v0/management/backups/:id/preview-restore
POST /v0/management/backups/:id/restore
DELETE /v0/management/backups/:id
```

### 10.4 Restore 规范

- restore 必须先 preview。
- preview 显示：
  - will_create
  - will_update
  - will_delete
  - conflicts
- restore 必须带 `preview_id`，**preview_id 有过期时间**（默认 10 分钟），过期则要求重新 preview，防止用户基于旧计算结果直接恢复。
- restore 前自动创建 pre-restore backup（写入 audit log，target type = `backup.pre_restore`）。

---

## 11. P2：System 诊断增强

### 11.1 目标

让 VPS/本地部署问题一键定位。

### 11.2 增强项

在 System 页面加入：

- binary hash
- frontend build hash
- overlay build/version note
- config path
- auth dir/data dir read/write check
- update trigger read/write check
- watcher log tail
- current process env summary
- endpoint self-check

### 11.3 API

> URL 风格统一遵循 §15.1 "动作放在子路径 + 扩展名"，`.zip` 不作为顶级路径后缀。

```http
GET /v0/management/system/diagnostics
GET /v0/management/system/diagnostics/export.zip
```

`diagnostics/export.zip` 包含：

- redacted config
- system status
- last update log
- recent CPA logs
- overlay feature list
- endpoint self-check result

脱敏规则：

- 所有 key/token/password → masked。
- webhook URL 只保留 host + webhook id 前后片段。
- 日志中匹配 `Bearer\s+\S+`、`sk-[A-Za-z0-9]+` 等模式一律 mask 后再写入 zip。

---

## 12. P2：全局搜索 / Command Palette 增强

### 12.1 目标

一个入口搜账号、API Key、请求、错误、页面和动作。

### 12.2 搜索源

| source   | 字段                                |
| -------- | ----------------------------------- |
| accounts | name/email/id/group/tags/status     |
| api keys | hash/preview/name/provider          |
| requests | path/model/provider/status/key hash |
| issues   | title/detail/auth_name              |
| pages    | route/title                         |
| actions  | warmup/relogin/backup/system update |

### 12.3 UX

Command Palette 分组：

- Pages
- Accounts
- API Keys
- Requests
- Actions

快捷动作：

- `warmup selected`
- `select needs relogin`
- `open account health`
- `open backup center`
- `create backup`
- `system update`

---

## 13. P2：账号详情独立路由

### 13.1 目标

支持团队成员分享某个账号的详情链接：

```text
/cpa-management/accounts/:encodedName
```

### 13.2 页面内容

- 基础信息
- status / health score
- quota
- recent request history
- token stats
- errors
- warmup history
- audit log for this account
- 操作区：
  - warmup
  - disable/enable
  - relogin
  - move group
  - add/remove tags

### 13.3 后端支持

可先前端组合现有 API。若性能不够，再加：

```http
GET /v0/management/account-profile/:name
```

---

## 14. P3：SQLite 分析库

### 14.1 目标

为长期趋势、审计、报表提供查询能力。

### 14.2 非目标

- 不替代 CPA auth 文件。
- 不作为请求链必需组件。
- SQLite 损坏不得影响代理主流程（任何写入失败都要降级回 JSON/JSONL，error log + alert，但不阻塞主调用链）。

### 14.3 表设计

```sql
CREATE TABLE requests (
  id               TEXT PRIMARY KEY,
  ts               INTEGER NOT NULL,
  method           TEXT,
  path             TEXT,
  status_code      INTEGER,
  model            TEXT,
  alias            TEXT,
  provider         TEXT,
  auth_id          TEXT,
  api_key_hash     TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  cached_tokens    INTEGER,
  reasoning_tokens INTEGER,
  total_tokens     INTEGER,
  estimated_usd    REAL,
  latency_ms       INTEGER,
  failed           INTEGER         -- SQLite 没有原生 BOOLEAN，0/1
);
CREATE INDEX idx_requests_ts        ON requests(ts);
CREATE INDEX idx_requests_auth_ts   ON requests(auth_id, ts);
CREATE INDEX idx_requests_key_ts    ON requests(api_key_hash, ts);
CREATE INDEX idx_requests_model_ts  ON requests(model, ts);

CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  actor_hash      TEXT,
  action          TEXT,
  target_type     TEXT,
  target_ids_json TEXT,
  ok              INTEGER,
  payload_json    TEXT
);
CREATE INDEX idx_audit_ts     ON audit_log(ts);
CREATE INDEX idx_audit_action ON audit_log(action, ts);

CREATE TABLE quota_snapshots (
  id                  TEXT PRIMARY KEY,
  ts                  INTEGER NOT NULL,
  auth_id             TEXT,
  provider            TEXT,
  primary_remaining   REAL,
  secondary_remaining REAL,
  raw_json            TEXT       -- 写入前必须 redact，移除 access_token / refresh_token / id_token / email 等敏感字段
);
CREATE INDEX idx_quota_auth_ts ON quota_snapshots(auth_id, ts);

CREATE TABLE account_health_snapshots (
  id           TEXT PRIMARY KEY,
  ts           INTEGER NOT NULL,
  auth_id      TEXT,
  score        INTEGER,
  level        TEXT,
  reasons_json TEXT
);
CREATE INDEX idx_health_auth_ts ON account_health_snapshots(auth_id, ts);
```

### 14.4 配置归属

> CPA 上游 `config.yaml` 有固定 schema，**不要往 root 直接加 `overlay:` 命名空间**——上游升级时容易触发 unknown field。Overlay 配置走独立文件：

```text
<config-dir>/overlay.yaml
```

示例：

```yaml
sqlite-analytics:
  enabled: false
  path: data/overlay_analytics.db
  retention-days: 30
  retention-job-interval: 6h
```

加载时机：与 `usage_persistence.go` 类似，在 `configureUsagePersistence` 之后由 overlay 单独读 `<config-dir>/overlay.yaml`，文件不存在则默认全关。retention 由 overlay 内部 ticker 执行（最低粒度 1h），删除超过保留期的 `requests` / `audit_log` / `quota_snapshots` / `account_health_snapshots` 行，删除前先 `BEGIN IMMEDIATE` 再 `DELETE ... LIMIT 10000` 分批，避免长事务阻塞写入。

默认关闭，避免引入额外运行风险。

---

## 15. 通用 API 规范

### 15.1 路径命名

- Management base：`/v0/management`
- 新功能优先使用名词复数：
  - `/account-health`
  - `/maintenance-rules`
  - `/backups`
  - `/audit-log`
  - `/token-reports`
- 动作使用子路径：
  - `/dry-run`
  - `/apply`
  - `/export.csv`
  - `/export.zip`（不允许在顶级路径直接挂 `.zip`）
  - `/download`
  - `/preview-restore`

### 15.2 Response 规范

列表：

```json
{
  "items": [],
  "count": 0,
  "total": 0,
  "limit": 200,
  "offset": 0,
  "summary": {}
}
```

批量动作：

```json
{
  "status": "ok",
  "total": 0,
  "succeeded": 0,
  "failed": 0,
  "results": []
}
```

错误：

```json
{
  "error": "human readable message",
  "code": "machine_readable_code",
  "details": {}
}
```

### 15.3 时间字段

- 机器计算：Unix seconds，字段名 `*_ts` 或 `*_at`。
- 前端展示：本地化时间。
- JSON 中不得混用毫秒和秒。

### 15.4 Secret 字段

禁止返回（也禁止落入任何持久化文件 / 日志 / webhook payload，包括 SQLite raw_json）：

- raw API key
- access token
- refresh token
- id token
- webhook full URL secret

允许返回：

- SHA256 hash 前 16 位：`api_key_hash`
- preview：`sk-...abcd`
- 文件名

---

## 16. 前端 UX 规范

### 16.1 页面结构

每个复杂页面按顺序：

1. 标题 + 主操作按钮
2. Info alert：说明数据来源和风险
3. Summary cards
4. Filter bar
5. 主表/图
6. Empty state
7. Modal/Drawer

### 16.2 操作风险颜色

| 风险   | UI               |
| ------ | ---------------- |
| none   | default/ghost    |
| low    | primary          |
| medium | warn             |
| high   | danger + confirm |

> 账号 health level (`healthy/warning/critical`) 与池容量 risk (`green/amber/red`) 走两套独立颜色映射，**badge 组件不复用**，避免视觉歧义。

### 16.3 批量操作

必须显示：

- 选中数量
- 操作影响
- 是否可撤销
- per-item 结果

### 16.4 空状态

空状态必须告诉用户：

- 为什么为空
- 下一步做什么

示例：

```text
暂无可按 API Key 聚合的数据（等待带 API Key 的新请求，或旧快照缺少 api_key_hash）。
```

### 16.5 图表与格式化

- 默认展示 Top 10。
- 大表格用排序，不默认渲染几千行。
- 金额格式化使用 `frontend/src/lib/utils.ts` 中的 `fmtUSD`。
- Token 数使用 `fmtTokens`。
- 若新增其他通用 formatter（百分比、AE、时长），统一加入 `lib/utils.ts`，避免散落。

---

## 17. 测试规范

### 17.1 后端

> overlay 仓库本身没有 `internal/api/handlers/management/` 包目录，**所有 `go test` 必须在 overlay 已应用到 CPA tree 后执行**。

```powershell
overlay\apply-overlay.bat
cd CLIProxyAPI
go test ./internal/api/handlers/management/... -run TestFeatureName -count=1
go test ./internal/api/handlers/management/... -count=1
```

测试类型：

- CRUD
- validation
- persistence
- dry-run/apply 差异（含 dry_run_token 过期与 action_ids 不匹配的拒绝路径）
- no secret leak
- event dedup
- pagination/filter

### 17.2 前端

当前最低验证：

```powershell
cd frontend
pnpm run build
```

若后续引入 Vitest，优先测试：

- aggregation pure functions
- filter/sort functions
- formatter helpers
- risk/status classification

### 17.3 Overlay

每次改 CPA tree 后：

```powershell
overlay\refresh-overlay.bat
overlay\verify-overlay.bat
```

`verify-overlay.bat` 必须通过后才允许交付。

---

## 18. 文档规范

每个新模块必须更新：

1. `docs/DEVELOPMENT_LOG.md`

   - 新增 session section 或在当前 section 追加。
   - 记录新增 API、前端页面、测试、验证命令。
2. `docs/MAINTAINING.md`

   - 如果新增 overlay 文件，更新文件数量和清单。
   - 如果新增脚本/持久化文件，更新维护说明。
3. `docs/README.md`

   - 若新增主要设计文档或核心能力，更新索引。
4. API 对比文档

   - 如果功能来自 Codex-Manager 思路或改变 CPA/CM 差异，更新 `CPA_vs_CodexManager_API_Analysis.md`。

---

## 19. 验收清单

模块完成前必须满足：

- [ ] 新文件位于 `overlay/files/internal/api/handlers/management/`，未触碰 CPA 上游 tree。
- [ ] 新 API 不泄漏 secret（含 SQLite raw_json、webhook payload、audit payload_json）。
- [ ] 新路由通过 `RegisterExtensionRoute` 注册。
- [ ] 有后端测试覆盖核心逻辑。
- [ ] `go test ./internal/api/handlers/management/... -count=1`（在 overlay-applied 的 CPA tree 中）通过。
- [ ] `pnpm run build` 通过（如改前端）。
- [ ] `overlay\refresh-overlay.bat` 已运行。
- [ ] `overlay\verify-overlay.bat` 通过。
- [ ] docs 已更新。
- [ ] destructive action 有 preview/confirm/per-item result。
- [ ] destructive action 在 §9 audit log 上线后写入 audit（参考 §9.5 必审计动作清单）。
- [ ] dry-run 类接口返回 `dry_run_token` 与稳定 `action_ids`，apply 拒绝重新隐式计算。

---

## 20. 推荐近期实施包

### 包 A：账号运维核心包（推荐优先）

包含：

- Account Health
- Maintenance Rules dry-run
- Account detail route

价值：

- 直接降低账号池维护成本。
- 与现有 Accounts/Quota/RequestHistory 强相关。
- 低侵入。

### 包 B：成本与限额包

包含：

- Token Reports
- API Key Insights
- Capacity Forecast（依赖 §8.2 AE 单位定义）

价值：

- 控制 API key 成本。
- 给团队展示清晰报表。
- 与现有 TokenStats/API Key Limits 自然衔接。

### 包 C：部署治理包

包含：

- Audit Log（建议在包 A 落地后立刻接入，让后续 apply 都能写 audit）
- Backup Center
- System Diagnostics

价值：

- 适合 VPS 多人使用。
- 降低误操作和部署排障成本。

推荐先做包 A + Audit Log，再做包 B，最后是包 C 的 Backup / System Diagnostics 与 P3 SQLite。
