# CPA 管理面板 P1 可观测与告警设计

## 背景

当前管理面板已有 Logs、RequestHistory、TokenStats、Quota 和 request-error-log 下载能力，但信息分散，缺少统一健康评分和告警规则。用户需要快速知道系统是否异常、异常影响哪些账号、是否需要立刻处理。

## 目标

1. 提供系统健康评分和告警列表。
2. 统一展示错误日志、请求失败、账号状态、Token 消耗和配额风险。
3. 导出 Prometheus 指标，支持外部监控。
4. 告警先本地规则化，不依赖外部服务。
5. 所有日志和指标都必须脱敏。

## 告警模型

告警结构：

```json
{
  "id": "auth:needs_relogin:account.json",
  "level": "critical|warning|info",
  "category": "auth|quota|traffic|system|storage|security",
  "title": "Account needs relogin",
  "message": "refresh_token_reused",
  "target": "account.json",
  "first_seen": 1770000000,
  "last_seen": 1770000300,
  "count": 3,
  "status": "active|acknowledged|resolved",
  "action": "oauth_repair"
}
```

## 后端设计

### 告警 API

新增：

```text
GET  /v0/management/alerts
POST /v0/management/alerts/:id/ack
POST /v0/management/alerts/:id/resolve
```

`GET /alerts` 支持：

```text
?level=critical&status=active&category=auth&limit=100
```

### 健康 API

新增：

```text
GET /v0/management/health-summary
```

返回：

```json
{
  "score": 86,
  "status": "healthy|degraded|critical",
  "reasons": ["4 accounts need relogin", "error rate 8% in last 10m"],
  "metrics": {
    "active_accounts": 42,
    "healthy_accounts": 36,
    "requests_10m": 120,
    "failed_requests_10m": 8,
    "tokens_today": 123456
  }
}
```

评分规则：

- 初始 100。
- 每个 critical 扣 15，最多扣 60。
- 每个 warning 扣 5，最多扣 30。
- 最近 10 分钟失败率 > 10% 扣 10。
- 可用账号数为 0 直接 critical。

### Prometheus 指标

新增：

```text
GET /v0/management/metrics
```

输出 text exposition format。核心指标：

```text
cpa_management_accounts_total{provider,status}
cpa_management_requests_total{provider,model,status}
cpa_management_tokens_total{provider,model,type}
cpa_management_request_failures_total{provider,model,error_class}
cpa_management_quota_remaining_ratio{provider,auth,window}
cpa_management_alerts_active{level,category}
cpa_management_job_active_total{type}
```

`auth` label 默认不包含完整文件名，可使用 hash 或 group，避免高基数和泄露。

### 告警规则

P1 内置规则：

- `needs_relogin`：status message 匹配 refresh_token_reused/invalid_grant/unauthorized。
- `long_failed`：同账号连续失败超过 3 次。
- `quota_low`：quota remaining ratio < 10%。
- `high_error_rate`：最近 10 分钟失败率 > 10% 且请求数 >= 20。
- `no_healthy_accounts`：某 provider 可用账号为 0。
- `storage_write_failed`：JSONL/快照写入失败。
- `remote_auth_failures`：远程管理密钥失败次数异常。

### 数据来源

- auth manager 状态。
- request history ring buffer/SQLite。
- token stats。
- quota 查询缓存。
- logs/error logs。
- management auth failure counter。

## 前端设计

### Dashboard

新增健康评分卡：

- 分数、状态、趋势。
- Critical/Warning/Info。
- “立即处理”按钮跳转问题中心。

### Alerts 页面或面板

可以在 Dashboard 下方先做 Alerts 面板，P2 再独立页面。

功能：

- 按 level/category/status 筛选。
- ack/resolve。
- 点击 action 进入 OAuth 修复、Accounts 过滤、Quota 页面或 RequestHistory。
- 支持复制诊断摘要。

### Logs 增强

- 增加 error class 筛选。
- 根据 request_id 跳转 request log by id。
- 和 Alerts 互相链接。

## 测试设计

后端：

1. 告警规则能从 auth status 生成 needs_relogin。
2. 失败率规则在请求数不足时不触发。
3. ack 后状态保持 acknowledged，问题消失后 resolved。
4. metrics 输出不包含完整 token/key。
5. health score 在 no healthy accounts 时为 critical。

前端：

1. Dashboard 正确展示 health-summary。
2. Alerts ack/resolve 后状态更新。
3. action 跳转携带过滤参数。

## 风险与回滚

- Prometheus 端点仍需 management 鉴权，避免公开内部状态。
- 告警只建议动作，不自动禁用账号。
- 指标 label 控制基数，避免每个 auth 文件产生无限时序。
