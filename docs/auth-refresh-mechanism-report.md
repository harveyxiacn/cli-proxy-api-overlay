# CPA OAuth Token 刷新机制分析报告

> 生成日期：2026-05-08
> 分析对象：CLIProxyAPI conductor.go + auto_refresh_loop.go + 前端 Badge 逻辑

---

## 1. 执行摘要

当前 VPS 上 279/282 个账号显示"未刷新"状态，`last_error` 包含 "token refresh failed with status ..."。
251 个账号的 quota 查询正常（access_token 有效），30 个 quota 查询返回 401（access_token 过期）。

**根因**：CPA 自动刷新调度器在启动后立即对 `LastRefreshedAt.IsZero()` 的账号触发 refresh，但 refresh 失败后：
1. `LastError` 被写入，但 **`StatusMessage` 不同步**（导致 `needsRelogin()` 检测失效）
2. `Status` 保持 "active"（正确——access_token 仍可用于请求路由）
3. `LastRefreshedAt` 永远不更新（refresh 永远失败）
4. 前端 Badge 用 "未刷新"（黄色）表示所有 `status=active && !lastRefresh` 的账号，无法区分"从未尝试"和"刷新失败"

---

## 2. Token 刷新机制详解

### 2.1 Token 生命周期

```
JSON 文件加载
  ↓
conductor.Load() → 恢复 Auth{Status, LastRefreshedAt, ...}
  ↓
auto_refresh_loop 启动 → 计算每个账号的 nextRefreshCheckAt
  ↓
shouldRefresh(auth, now) 判断是否需要刷新
  ↓
refreshAuth(ctx, id) 执行实际 OAuth 请求
  ↓ 成功                    ↓ 失败
LastRefreshedAt = now      LastError = err
NextRefreshAfter = 0       NextRefreshAfter = now + 5min
LastError = nil            StatusMessage = ❌ 未同步（bug）
Status = 不变              Status = 不变（保持 active）
```

### 2.2 shouldRefresh() 对 Codex 账号的行为

Codex 注册了 `ProviderRefreshLead = 5 days`（5天提前刷新窗口）。

| 账号状态 | shouldRefresh() 结果 | 说明 |
|---------|---------------------|------|
| `LastRefreshedAt.IsZero()` | **true**（立即刷新）| 永远未被成功刷新过 |
| `LastRefreshedAt` < 2天前 | true（expiry - 5d < now） | 即将过期 |
| `LastRefreshedAt` 很新 | false | 还不需要 |

**问题**：对于 JSON 文件中 `last_refreshed_at` 为空的账号（新导入或从未刷新），`shouldRefresh()` 认为"立即刷新"，在启动时产生 280 个并发刷新请求（已由 TriggerRefreshAllThrottled 解决），但无法解决 refresh_token 失效的情况。

### 2.3 "token refresh failed with status XXX" 错误来源

```go
// openai_auth.go（上游代码）
if resp.StatusCode != http.StatusOK {
    return nil, fmt.Errorf("token refresh failed with status %d: %s",
        resp.StatusCode, string(body))
}
```

常见状态码：
| HTTP 状态 | 原因 | 处理方式 |
|----------|------|---------|
| 400 + `invalid_grant` | refresh_token 已过期/无效，永久失效 | 需要重新 OAuth 登录 |
| 401 | access_token 无效（用于刷新端点的认证失败） | 可能需要重新登录 |
| 429 | 速率限制 | 等待后自动重试（已有 5min backoff） |
| 500/503 | OpenAI 服务端异常 | 等待后自动重试 |

### 2.4 当前 refreshAuth() 错误处理路径（Bug 位置）

```go
// conductor.go:3608-3614（当前 overlay patch 后的代码）
current.NextRefreshAfter = now.Add(refreshFailureBackoff)  // 5min backoff
current.LastError = &Error{Message: err.Error()}            // ✓ 设置了 LastError
// ❌ 缺少: current.StatusMessage = err.Error()
// ❌ 缺少: invalid_grant 等不可恢复错误的特殊处理
m.auths[id] = current
```

**直接影响**：
- `StatusMessage` 为空 → `authNeedsRelogin()` 对 invalid_grant 账号返回 false（误判为健康）
- 前端 `needsRelogin(statusMessage)` 无法检测 invalid_grant 错误
- 当账号 access_token 最终过期、status 变为 error 后，badge 仍显示"error"而非"需重登录"

---

## 3. 当前状态分析（279 个"未刷新"账号）

### 3.1 状态分布

| 状态 | 数量 | 说明 |
|------|------|------|
| 有效 token + refresh 失败 | ~251 | access_token 有效，refresh_token 可能失效 |
| access_token 也过期 | ~30 | quota 查询返回 401 |
| 真正健康（有 lastRefresh） | 1-2 | 少量成功刷新过的账号 |

### 3.2 251 个"quota 正常但 refresh 失败"的账号

这些账号：
- access_token **仍然有效**（quota API 正常）
- refresh_token 可能已失效（`invalid_grant`）或服务端在限流（429）
- 每 5 分钟自动重试一次 → 失败 → 无限循环

OpenAI Codex 的 access_token 可能有 1~8 小时的有效期。这些账号的 access_token 是从 JSON 文件加载的，可能是之前刷新得到的，目前还在有效期内。

### 3.3 30 个"quota 401"账号

- access_token 已过期
- 如果 refresh_token 也无效 → 需要重新 OAuth 登录
- 如果 refresh_token 有效 → 手动触发刷新即可恢复

---

## 4. 修复计划

### Fix 1：Sidebar 固定（CSS）
**文件**：`frontend/src/components/layout/AppLayout.tsx`
- 将外层容器从 `min-h-screen`（允许页面滚动）改为 `h-screen overflow-hidden`
- 内容区 `overflow-auto` 独立滚动
- Sidebar 已有 `overflow-y-auto`，在小屏幕时自动出现内部滚动条

### Fix 2：Badge 区分"刷新失败"vs"未刷新"
**文件**：`frontend/src/components/ui/Badge.tsx`
- `status=active` + `!lastRefresh` + **`lastError != null`** → 橙色"刷新失败"（+错误 tooltip）
- `status=active` + `!lastRefresh` + **`lastError == null`** → 黄色"未刷新"（真正从未尝试）
- 同步更新 Accounts.tsx 的排序逻辑

### Fix 3：Conductor patch — StatusMessage 同步
**文件**：`CLIProxyAPI/sdk/cliproxy/auth/conductor.go`（patch 覆盖）
- 在刷新失败路径添加：`current.StatusMessage = err.Error()`
- 效果：当账号 access_token 过期后 status 变为 error，`needsRelogin(statusMessage)` 能正确检测 invalid_grant → badge 显示"需重登录"

### Fix 4：智能刷新的 shouldSkipBulkRefresh 优化
**文件**：`CLIProxyAPI/sdk/cliproxy/auth/bulk_refresh_throttled.go`（已有 overlay）
- 当前逻辑：`LastRefreshedAt.IsZero()` → 不跳过（触发刷新）
- 补充：`LastError != nil` → 不跳过（错误账号总是重试）
- **这已在当前代码中正确实现**（✓ 无需修改）

---

## 5. 操作建议

### 立即操作
1. **部署 Fix 1-3** → 侧边栏固定 + badge 正确显示
2. **点击"强制刷新全部"** → 对所有账号触发刷新（含 30 个 access_token 过期账号）
3. **观察结果**：
   - 429 账号：刷新成功 → "active" + 绿色
   - invalid_grant 账号：仍失败 → "刷新失败" 橙色（access_token 仍有效时），或"需重登录"（access_token 过期后）
   - 真正需要重登录的账号：到账号健康页面批量处理

### 中期操作
- 对显示"需重登录"的账号：前往"账号健康" → 选 critical → 批量重登

---

## 6. 无需修改的设计决定

- **`Status` 在 refresh 失败时保持 "active"**：正确——access_token 仍可路由请求，不应把可用账号变成 error
- **5 分钟重试 backoff**：合理——给 OpenAI 服务端恢复时间
- **`shouldSkipBulkRefresh` 对有 LastError 的账号不跳过**：正确——总是重试有错误的账号
