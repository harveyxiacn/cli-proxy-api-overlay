# CPA 管理面板 P0 运维优化设计

## 背景

`docs/DEVELOPMENT_LOG.md` 记录的当前状态是：后端已经补充了管理 API，前端已从 `extended.html` 迁移到 React + Vite SPA。下一步不应继续扩张页面数量，而应优先补齐日常运维闭环：批量操作可靠性、连接封禁误伤、请求历史筛选、后续持久化和真实任务进度的接口边界。

## 本轮范围

本轮实现 P0A，目标是在不引入新重型依赖、不改动核心代理链路的前提下，先解决最影响日常使用的低风险问题：

1. 后端新增批量启用/禁用授权文件 API。
2. React 前端使用后端批量 API，避免逐文件循环导致的慢和部分失败不可读。
3. localhost 管理密钥错误不再触发 30 分钟封禁，并在远程错误响应中返回剩余尝试次数。
4. 请求历史增加时间范围查询参数，前端增加开始/结束时间筛选。
5. Token 统计页接入 Recharts，先用现有 per-account 数据展示 Top 账号消耗分布。
6. 更新开发日志，明确已完成项与后续 SQLite / Job / SSE 阶段。

## 非本轮范围

以下内容保留为 P0B/P1：

- SQLite 持久化请求历史和 Token 聚合。
- 后端 job 系统替代固定等待 8 秒。
- SSE/WebSocket 推送替代轮询。
- 完整 Dashboard 问题处理中心重排。
- API Key 管理 UI、告警系统、配额感知路由。

兼容性要求：继续保留 `/extended.html` 和 `/management.html`。新版 `/management/*` React SPA 出现问题时，用户可以回退到旧扩展 UI 或原 CPA 管理 UI。

## 方案选择

### 方案 A：一次性实现 SQLite + Job + SSE + UI 重排

优点：最接近完整优化路线。  
缺点：跨存储、任务系统、实时推送和前端页面改造，风险高，当前工作区已有大量未提交改动，不适合一次性落地。

### 方案 B：P0A 小步闭环

优点：改动集中、可测试、不会改变代理请求主路径；能立即提升批量管理和连接体验。  
缺点：不能解决重启丢统计和长任务真实进度。

### 方案 C：只做前端 UI 优化

优点：最快。  
缺点：绕不开后端能力缺口，批量操作和封禁问题仍存在。

本轮采用方案 B。

## 后端设计

### 批量状态 API

新增端点：

```text
POST /v0/management/auth-files/status-batch
```

请求：

```json
{
  "names": ["a.json", "b.json"],
  "disabled": true
}
```

响应：

```json
{
  "updated": 2,
  "files": ["a.json", "b.json"],
  "failed": 0,
  "errors": []
}
```

若部分失败，仍返回 200，由 `failed` 和 `errors` 表达部分失败，保持与 `delete-batch` 一致。

### localhost 封禁 UX

`AuthenticateManagementKey` 保持远程 IP 5 次失败封禁 30 分钟，但 localhost 不累计失败次数、不进入封禁。这样 React 自动连接和用户本机输错密钥不会把自己锁住。

远程错误响应增加可读信息：

- `missing management key (4 attempts remaining)`
- `invalid management key (3 attempts remaining)`

现有 Redis 协议集成依旧只依赖字符串前缀，不改变 forbidden ban 文案前缀。

### 请求历史时间范围

`GET /request-history` 增加查询参数：

```text
after_ts=unix_seconds
before_ts=unix_seconds
```

过滤顺序：

1. 从环形缓冲取 newest first。
2. 应用 model/provider/failed/time range 过滤。
3. 截断到 limit。
4. 对返回集合计算 summary。

## 前端设计

### Accounts / Duplicates

- `Accounts.tsx` 的批量启用/禁用改为调用 `status-batch`。
- 批量删除改为调用 `delete-batch`。
- `Duplicates.tsx` 的单组清理和全部清理改为调用 `delete-batch`。
- Toast 显示成功/失败数量，失败时保留告警语气。

### RequestHistory

- 增加开始/结束时间输入框：`datetime-local`。
- 查询参数转换为 unix 秒。
- 保留现有 limit/model/provider/failed 筛选。

### TokenStats

- 使用已引入的 Recharts。
- 基于 `entries` 展示 Top 10 账号 Token 消耗条形图。
- 不新增后端 hourly bucket，避免伪造时间序列。

## 测试设计

后端测试：

1. localhost 错误密钥不会封禁正确密钥。
2. 远程错误密钥 5 次后仍封禁。
3. `PostStatusAuthFilesBatch` 对多个文件返回 `updated/files/failed/errors`。
4. `GetRequestHistory` 支持 `after_ts` / `before_ts` 过滤。

前端验证：

1. `pnpm build` 确认 TypeScript 和 Vite 构建通过。
2. Go 包测试覆盖 management handler。
3. Go 全量构建确认后端编译通过。

## 风险与回滚

- 批量 API 只复用已有单文件逻辑，失败按文件记录，不影响其他文件。
- localhost 不封禁只影响本机管理接口；远程封禁逻辑保留。
- 请求历史时间筛选只过滤已有内存数据，不改变记录写入。
- 前端批量调用失败时可回退到旧的逐项循环逻辑。
