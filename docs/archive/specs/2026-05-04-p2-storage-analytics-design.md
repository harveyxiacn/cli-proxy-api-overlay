# CPA 管理面板 P2 SQLite 存储与分析设计

## 背景

P0B 使用 `data/request_history.jsonl` 和 `data/token_stats.json` 解决了重启不丢失的问题，但它不是长期分析存储：查询只能扫描文件或内存，缺少索引、保留策略、按 API Key/账号/模型/时间聚合的能力。P2 应引入 SQLite，作为管理面板本地分析层，同时保留 JSONL/JSON 作为迁移来源和回退方案。

## 目标

1. 持久化请求历史、Token 统计、API Key 使用量、告警、job 记录。
2. 支持按时间、provider、model、auth、api key、状态分页查询。
3. 提供小时/日聚合，支撑 Dashboard 趋势图和告警规则。
4. 从现有 JSONL/JSON 平滑迁移，失败时不影响代理主路径。
5. 仍保持单机低依赖部署，不要求外部数据库。

## 方案选择

### 方案 A：SQLite 本地文件

优点：单文件、跨平台、可索引、适合管理面板本地分析。  
缺点：需要引入 Go SQLite driver，构建和 CGO/纯 Go 选择要评估。

### 方案 B：继续 JSONL + 内存索引

优点：无新依赖。  
缺点：复杂查询和长期保留会变成自研数据库。

### 方案 C：Postgres

优点：能力强。  
缺点：部署成本高，不符合当前单二进制工具定位。

推荐方案 A。driver 优先评估纯 Go `modernc.org/sqlite`；如果体积或兼容性不可接受，再考虑 build tag 可选。

## 存储位置

```text
<config.yaml 所在目录>/data/management.db
```

保留：

```text
data/request_history.jsonl
data/token_stats.json
```

迁移成功后不立即删除旧文件，标记为 fallback source。

## 表结构

### schema_version

```sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

### request_events

```sql
CREATE TABLE request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  auth_name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  error_class TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  latency_ms INTEGER NOT NULL
);
```

索引：

```sql
CREATE INDEX idx_request_events_ts ON request_events(ts DESC);
CREATE INDEX idx_request_events_provider_model_ts ON request_events(provider, model, ts DESC);
CREATE INDEX idx_request_events_auth_ts ON request_events(auth_name, ts DESC);
CREATE INDEX idx_request_events_api_key_ts ON request_events(api_key_hash, ts DESC);
CREATE INDEX idx_request_events_failed_ts ON request_events(failed, ts DESC);
```

### token_daily

```sql
CREATE TABLE token_daily (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  auth_name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  requests INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  PRIMARY KEY (day, provider, model, auth_name, api_key_hash)
);
```

### jobs

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  total INTEGER NOT NULL,
  success INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
```

### alerts

```sql
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  count INTEGER NOT NULL,
  status TEXT NOT NULL,
  action TEXT NOT NULL
);
```

## 后端设计

### 数据层接口

新增：

```text
internal/api/handlers/management/storage.go
internal/api/handlers/management/storage_sqlite.go
internal/api/handlers/management/storage_json_fallback.go
```

接口：

```go
type ManagementStore interface {
    AppendRequest(record RequestLogItem) error
    QueryRequests(filter RequestQuery) (RequestQueryResult, error)
    UpsertTokenDaily(delta TokenDelta) error
    QueryTokenStats(filter TokenQuery) (TokenStatsResult, error)
    UpsertJob(snapshot managementJobSnapshot) error
    QueryJobs(filter JobQuery) (JobQueryResult, error)
    UpsertAlert(alert Alert) error
    QueryAlerts(filter AlertQuery) (AlertQueryResult, error)
    Close() error
}
```

代理请求主路径调用 store 时必须 best effort：写库失败记录日志和告警，不阻塞上游响应。

### 迁移流程

启动时：

1. 打开或创建 `management.db`。
2. 应用 schema migrations。
3. 若 request_events 为空且 `request_history.jsonl` 存在，导入最近保留窗口。
4. 若 token_daily 为空且 `token_stats.json` 存在，导入快照。
5. 导入完成后写入 `data/migration_state.json`。

### 保留策略

配置项：

```yaml
management-storage:
  request-retention-days: 30
  aggregate-retention-days: 365
  max-db-size-mb: 512
```

默认：

- 明细保留 30 天。
- 日聚合保留 365 天。
- 超限时先删除最旧明细，不删除聚合。

## API 设计

扩展：

```text
GET /v0/management/request-history
```

新增参数：

```text
offset=0
cursor=<opaque>
api_key_hash=<hash>
auth_name=<name>
error_class=<class>
```

新增：

```text
GET /v0/management/analytics/usage-daily
GET /v0/management/analytics/usage-hourly
GET /v0/management/analytics/top-auths
GET /v0/management/analytics/top-api-keys
GET /v0/management/analytics/errors
```

## 前端设计

- RequestHistory：改为服务端分页，支持更多筛选。
- TokenStats：展示 24 小时趋势、7 日趋势、Top 模型、Top 账号。
- Dashboard：增加 7 日请求量、失败率、成本趋势。
- API Key 页面：按 key 查看用量和失败率。

图表继续 lazy load，不进入首屏 bundle。

## 测试设计

1. 空库启动自动建表。
2. JSONL 导入后查询 newest first。
3. token_stats.json 导入后日聚合正确。
4. 写库失败不阻塞 request publish。
5. retention 清理只删除过期明细，不删除聚合。
6. request-history cursor 分页稳定。

## 风险与回滚

- SQLite 初始化失败时回退到 P0B JSONL/JSON。
- 迁移过程幂等，可重复执行。
- 保留旧文件至少一个版本周期，防止迁移 bug 造成不可逆数据丢失。
