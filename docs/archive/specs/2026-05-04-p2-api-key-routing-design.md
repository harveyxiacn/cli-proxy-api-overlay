# CPA 管理面板 P2 API Key 管理与配额感知路由设计

## 背景

后端已存在 `/api-keys` 和 `/api-key-usage`，Settings 也能管理部分路由策略。但 React 面板缺少完整 API Key 管理 UI，用户无法直观看到每个 key 的用量、失败率、权限和限额。另一方面，账号配额、冷却状态和失败历史已经具备数据来源，可以进一步用于路由策略建议。

## 目标

1. 在 React UI 中完整管理 API Key：新增、禁用、删除、备注、权限、限额。
2. 展示每个 API Key 的请求量、Token、成本、失败率和最近调用。
3. 支持 key 级 provider/model 限制。
4. 设计配额感知路由策略，减少命中冷却或 quota exceeded。
5. 保持默认路由行为不变，策略必须显式启用。

## API Key 数据模型

配置层保留现有 API key 列表，扩展元数据：

```json
{
  "key_hash": "sha256:abc",
  "display_name": "team-a",
  "enabled": true,
  "note": "batch workload",
  "allowed_providers": ["codex", "gemini"],
  "allowed_models": ["gpt-5.4", "gpt-5.4-mini"],
  "blocked_models": [],
  "monthly_token_limit": 10000000,
  "monthly_cost_limit_usd": 50.0,
  "created_at": 1770000000,
  "last_used_at": 1770000300
}
```

完整 key 只在创建时显示一次；后端持久化 hash 或现有加密配置格式，不在 UI 再次展示明文。

## 后端设计

### API Key 管理端点

保留并扩展：

```text
GET    /v0/management/api-keys
PUT    /v0/management/api-keys
PATCH  /v0/management/api-keys
DELETE /v0/management/api-keys
GET    /v0/management/api-key-usage
```

新增：

```text
POST /v0/management/api-keys/create
POST /v0/management/api-keys/:hash/rotate
PATCH /v0/management/api-keys/:hash/policy
GET /v0/management/api-keys/:hash/recent-requests
```

`create` 响应：

```json
{
  "api_key": "cpa_xxx",
  "key_hash": "sha256:abc",
  "display_name": "team-a"
}
```

### Key 级鉴权和限额

请求进入代理时：

1. 解析 API key。
2. 查 key metadata。
3. 检查 enabled。
4. 检查 provider/model allow/block。
5. 检查月度 token/cost limit。
6. 通过后进入现有路由。

失败返回明确错误：

```json
{
  "error": {
    "message": "API key is not allowed to use model gpt-5.5",
    "type": "access_denied"
  }
}
```

### 配额感知路由

新增配置：

```yaml
routing:
  strategy: round_robin
  quota-aware:
    enabled: false
    avoid-cooling: true
    avoid-quota-low-threshold: 0.1
    prefer-healthy: true
    failure-penalty-minutes: 10
```

策略评分：

```text
score = base_weight
      + priority_bonus
      + quota_remaining_bonus
      - cooling_penalty
      - recent_failure_penalty
      - latency_penalty
```

P2 只设计为可选策略，不替换默认 `round_robin`。

### 路由解释 API

新增：

```text
POST /v0/management/routing/explain
```

请求：

```json
{
  "provider": "codex",
  "model": "gpt-5.4",
  "api_key_hash": "sha256:abc"
}
```

返回候选账号及选择原因，用于 UI 调试：

```json
{
  "selected": "a.json",
  "candidates": [
    {"name": "a.json", "score": 92, "reasons": ["healthy", "quota 78%"]},
    {"name": "b.json", "score": 20, "reasons": ["cooling", "recent failure"]}
  ]
}
```

## 前端设计

### 新页面：API Keys

路径：

```text
/api-keys
```

功能区：

1. Key 列表：名称、hash 后 8 位、状态、最近使用、今日 tokens、失败率。
2. 创建 key modal：名称、权限、限额。
3. 详情抽屉：用量趋势、最近请求、允许模型、限额进度。
4. 危险区：禁用、删除、轮换。

### Settings 路由策略

Settings 中新增“路由策略”卡片：

- 当前 strategy。
- quota-aware 开关。
- 阈值配置。
- “解释一次路由”测试表单。

## 测试设计

后端：

1. 创建 API key 只返回一次明文。
2. disabled key 被拒绝。
3. model 不在 allowed_models 时被拒绝。
4. monthly token limit 超过后被拒绝。
5. quota-aware 关闭时不改变默认路由。
6. routing/explain 返回候选和原因。

前端：

1. API Keys 页面可创建、禁用、删除 key。
2. 权限配置保存后刷新列表。
3. 详情页展示 usage。
4. routing explain 表单展示候选评分。

## 风险与回滚

- 默认不启用 quota-aware，确保现有代理行为不变。
- 明文 key 只出现一次，刷新页面后无法再次查看。
- 删除 key 需要二次确认，优先提供 disable。
