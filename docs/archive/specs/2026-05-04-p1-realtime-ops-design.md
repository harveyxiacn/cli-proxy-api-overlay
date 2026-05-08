# CPA 管理面板 P1 实时运维设计

## 背景

P0B 已提供 `POST /v0/management/jobs/refresh-tokens` 和 `GET /v0/management/jobs/:id`，前端通过轮询展示刷新 Token 进度。请求历史、Token 统计和日志仍主要靠页面定时查询或用户手动刷新。下一阶段应建立统一的实时事件通道，让 Dashboard、Logs、RequestHistory、TokenStats、Accounts、Quota 共享同一套状态更新。

## 目标

1. 用单连接事件流替代多页面轮询。
2. 推送 job 进度、日志追加、请求历史追加、Token 统计变化和账号状态变化。
3. 断线后自动恢复，并通过事件序号补齐短时间内丢失的事件。
4. 保留轮询 fallback，确保旧浏览器、反向代理或远程环境不支持 SSE 时仍可使用。

## 方案选择

### 方案 A：SSE 优先

优点：浏览器原生 `EventSource`，实现简单，适合服务端单向推送；管理面板当前不需要前端通过同一通道发命令。  
缺点：只支持文本事件，二进制和双向交互不适合。

### 方案 B：WebSocket 优先

优点：双向能力强，可扩展为远程终端或交互任务。  
缺点：鉴权、保活、代理兼容和重连处理更复杂。

### 方案 C：继续轮询

优点：最稳定。  
缺点：页面越多请求越多，job 和日志体验仍有延迟。

推荐方案 A：P1 使用 SSE，保留 P0B 轮询接口作为 fallback；未来确有双向需求时再独立设计 WebSocket。

## 后端设计

### 事件端点

新增：

```text
GET /v0/management/events
```

鉴权沿用 management middleware。客户端可传：

```text
?last_event_id=12345
```

也支持标准 SSE 请求头：

```text
Last-Event-ID: 12345
```

### 事件格式

所有事件使用统一 envelope：

```json
{
  "id": 12346,
  "type": "job.updated",
  "ts": 1770000000,
  "source": "management",
  "payload": {}
}
```

SSE 输出：

```text
id: 12346
event: job.updated
data: {"id":12346,"type":"job.updated","ts":1770000000,"source":"management","payload":{}}
```

### 事件类型

| type | payload | 用途 |
|---|---|---|
| `job.created` | job snapshot | Dashboard/Quota 打开进度 Modal |
| `job.updated` | job snapshot | 替代 `GET /jobs/:id` 高频轮询 |
| `job.completed` | final job snapshot | 关闭进度、刷新账号列表 |
| `log.appended` | level/message/time/request_id | Logs 增量追加 |
| `request.recorded` | request history item summary | RequestHistory 追加最新记录 |
| `token_stats.updated` | changed auth/model totals | TokenStats 局部刷新 |
| `auth.status_changed` | name/status/status_message/next_refresh_after | Accounts/Dashboard 状态刷新 |
| `quota.updated` | auth name and quota summary | Quota 页刷新单账号 |
| `system.health_changed` | health score and reasons | Dashboard 告警卡片 |

### 事件总线

新增内部包或 management 子模块：

```text
internal/api/handlers/management/events.go
```

核心结构：

- `eventBus`：保存订阅者、递增事件 ID、最近事件 ring buffer。
- `subscriber`：每个 SSE 连接一个 channel。
- `PublishManagementEvent(type, payload)`：供 job、logs、usage、auth 变更调用。

保留最近 1000 条事件用于短断线补齐。事件只保存摘要，不保存完整敏感数据。

### 心跳和断线

- 每 15 秒发送 `event: ping`。
- 写入失败或 context cancel 时移除 subscriber。
- 客户端重连时带 `Last-Event-ID`，服务端从 ring buffer 回放后再进入实时订阅。
- 如果 last id 太旧，服务端发送 `system.resync_required`，前端回退到重新拉取 `startup-snapshot`。

## 前端设计

### 连接层

新增：

```text
frontend/src/api/events.ts
frontend/src/stores/events.ts
```

职责：

- 建立 `EventSource`。
- 自动拼接 management key。若不能把 key 放 header，则使用短期 event token。
- 保存连接状态：`connecting/open/reconnecting/fallback`.
- 将事件分发给 TanStack Query cache。

如果 `EventSource` 无法携带自定义 header，新增后端：

```text
POST /v0/management/events-token
```

返回 60 秒有效的一次性 token，SSE URL 使用：

```text
/v0/management/events?token=...
```

### 页面更新

- Dashboard：订阅 job、auth、system health，更新问题中心。
- Logs：收到 `log.appended` 直接追加，不再每秒拉取。
- RequestHistory：收到 `request.recorded` 追加到当前筛选集合；筛选条件不匹配则只更新 summary。
- TokenStats：收到 `token_stats.updated` 后 debounce 1 秒拉取完整 stats，避免每次请求都重算图表。
- Accounts：收到 `auth.status_changed` 更新行状态；复杂变更后 invalidate `auth-files` query。
- Quota：收到 `quota.updated` 局部更新；批量查询仍通过 REST。

## 错误处理

- SSE 断线 0、1、2、5、10 秒退避重连，最长 30 秒。
- 连续 5 次失败进入 fallback，每 10 秒轮询关键接口。
- 收到 `system.resync_required` 立即重新拉取 `startup-snapshot`。
- 浏览器标签页隐藏时不断开 SSE，但 TokenStats 图表刷新 debounce 到 5 秒。

## 测试设计

后端：

1. 事件 ID 单调递增。
2. 多 subscriber 都能收到同一事件。
3. last_event_id 可回放 ring buffer 内事件。
4. ring buffer 溢出后返回 resync_required。
5. SSE handler 在 context cancel 后释放 subscriber。

前端：

1. `events.ts` 能解析 SSE envelope 并分发。
2. 断线进入 fallback 状态。
3. job.updated 能更新 Dashboard modal。
4. request.recorded 不匹配当前筛选时不污染列表。

## 风险与回滚

- SSE 出问题时关闭前端事件连接，保留 P0B 轮询。
- 后端事件发布只做 best effort，不能阻塞代理请求主路径。
- 事件 payload 必须脱敏，避免日志或 token 泄露。
