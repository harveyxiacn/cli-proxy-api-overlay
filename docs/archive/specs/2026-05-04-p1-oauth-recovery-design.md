# CPA 管理面板 P1 OAuth 修复向导设计

## 背景

开发日志记录了大量 `refresh_token_reused`、`invalid_grant`、`unauthorized` 和 session 过期问题。P0 已能在 Accounts 页面区分“需重登录”，但用户仍需要手动判断 provider、打开 OAuth、等待回调、上传或替换 auth 文件。下一阶段应把这些动作变成可引导、可批量、可回滚的修复向导。

## 目标

1. 在 Dashboard 和 Accounts 中识别需要重新 OAuth 的账号。
2. 支持 Codex、Anthropic、Gemini CLI、Antigravity、Kimi 的统一 OAuth 修复流程。
3. 对单账号和多账号批量修复提供清晰进度。
4. 修复后自动 warmup、刷新 quota，并展示结果。
5. 保留手工上传 JSON 的兜底路径。

## 当前基础

后端已有：

- `GET /v0/management/anthropic-auth-url`
- `GET /v0/management/codex-auth-url`
- `GET /v0/management/gemini-cli-auth-url`
- `GET /v0/management/antigravity-auth-url`
- `GET /v0/management/kimi-auth-url`
- `POST /v0/management/oauth-callback`
- `GET /v0/management/get-auth-status`
- `POST /v0/management/auth-files/warmup`
- provider callback route：`/anthropic/callback`、`/codex/callback`、`/google/callback`、`/antigravity/callback`

## 用户流程

### 单账号修复

1. Accounts 行上出现“需重登录”徽章和“修复”按钮。
2. 点击后打开 OAuthRepairWizard。
3. Wizard 展示 provider、文件名、email、错误原因、上次刷新时间。
4. 用户点击“开始授权”。
5. 前端打开授权 URL，新窗口完成 provider 登录。
6. 后端 callback 写入 pending session 结果。
7. 前端轮询或接收 SSE `oauth.completed`。
8. 后端替换或新增 auth 文件。
9. 前端调用 warmup，成功后刷新列表、quota 和 token 状态。

### 批量修复

1. 用户在 Accounts 选择多个“需重登录”账号。
2. 点击“批量修复”。
3. Wizard 按 provider 分组，提示每组会依次打开授权。
4. 每次只处理一个账号，避免 callback state 混乱。
5. 每个账号完成后进入下一个；失败账号保留在结果列表。

## 后端设计

### OAuth session 模型

现有 session 继续保留，新增统一状态结构：

```json
{
  "session_id": "oauth_abc",
  "provider": "codex",
  "target_name": "user@example.com.json",
  "status": "pending|callback_received|exchanging|saved|warmup_failed|failed|expired",
  "auth_file": "user@example.com.json",
  "error": "",
  "created_at": 1770000000,
  "expires_at": 1770000600
}
```

新增端点：

```text
POST /v0/management/oauth/repair-session
GET  /v0/management/oauth/sessions/:id
POST /v0/management/oauth/sessions/:id/warmup
POST /v0/management/oauth/sessions/:id/cancel
```

`repair-session` 请求：

```json
{
  "provider": "codex",
  "target_name": "old-auth.json",
  "mode": "replace"
}
```

`mode`：

- `replace`：授权成功后替换同名文件，旧文件备份为 `.bak.<timestamp>`。
- `create_new`：新建文件，不覆盖旧文件。

### 文件替换策略

为避免授权成功但保存失败导致数据丢失：

1. 写入新 auth 到临时文件。
2. warmup 成功后备份旧文件。
3. 原子 rename 临时文件到目标。
4. 更新内存 auth manager。
5. 发布 `auth.status_changed`。

若 warmup 失败，默认不替换旧文件，用户可选择“仍保存为新文件”。

### 过期和清理

- session 默认 10 分钟过期。
- 每 1 分钟清理过期 session。
- session 中不保存 refresh token，只保存 state、provider、目标文件名和状态。

## 前端设计

### 页面和组件

新增：

```text
frontend/src/components/oauth/OAuthRepairWizard.tsx
frontend/src/components/oauth/OAuthSessionProgress.tsx
frontend/src/pages/OAuth.tsx
```

OAuth 页面改为三块：

1. 快速新增账号。
2. 失效账号修复队列。
3. 手工上传 JSON。

Accounts 和 Dashboard 使用同一个 Wizard 组件。

### UX 细节

- 明确提示当前 provider 和目标文件。
- 新窗口打开失败时显示授权 URL 复制按钮。
- 每一步显示状态：创建会话、等待浏览器授权、收到回调、保存文件、warmup、完成。
- 批量模式显示“当前第 N/M 个”。
- 失败时提供：重试当前、跳过、停止批量、下载错误详情。

## 与实时事件集成

若 P1 实时事件已完成，后端发布：

- `oauth.session_created`
- `oauth.callback_received`
- `oauth.saved`
- `oauth.failed`
- `auth.status_changed`

若未完成，前端每 2 秒轮询 `GET /oauth/sessions/:id`。

## 测试设计

后端：

1. 创建 repair session 返回 provider 授权 URL。
2. callback state 匹配时 session 状态变为 callback_received。
3. replace 模式在 warmup 成功后备份旧文件并替换。
4. warmup 失败不覆盖旧文件。
5. session 过期后不能继续保存。

前端：

1. 单账号修复 wizard 状态流转正确。
2. 弹窗被拦截时显示复制 URL。
3. 批量修复一个失败后可继续下一个。
4. 完成后 invalidate `auth-files`、`quota` 和 `startup-snapshot`。

## 风险与回滚

- 保留现有 OAuth 页面和手工上传。
- 文件替换前始终备份旧文件。
- 批量模式串行执行，避免 provider callback 混线。
