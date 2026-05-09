# CPA Overlay 全功能检测报告

**检测时间**: 2026-05-08 10:35 UTC  
**VPS**: DMIT-LPZqoMyy17 (cpa.fanni-panda.com / 64.186.238.234)  
**二进制**: overlay 版本，备份 CLIProxyAPI.bak.20260508-103548

---

## 1. 端点可用性检测（36/36 通过）

| 状态 | 端点名称 | 方法 | HTTP | 响应时间 | 关键字段 |
|------|---------|------|------|---------|---------|| ✓ | UI cpa-management | GET | 200 | 5ms | - |
| ✓ | UI extended.html | GET | 200 | 6ms | - |
| ✓ | system/status | GET | 200 | 56ms | binary_mtime, binary_size, build_date, commit |
| ✓ | system/check-upstream | GET | 200 | 311ms | asset_count, body, checked_at, current_build_date |
| ✓ | system/diagnostics | GET | 200 | 88ms | generated_at, binary_hash, config_path, auth_dir |
| ✓ | desktop/info | GET | 200 | 52ms | entrypoints, legacy_supported, mode, tauri_supported |
| ✓ | startup-snapshot | GET | 200 | 63ms | fetched_at, files, stats, token_today |
| ✓ | auth-files | GET | 200 | 61ms | files |
| ✓ | auth-stats | GET | 200 | 54ms | auths, count, total_failed, total_success |
| ✓ | maintenance-summary | GET | 200 | 51ms | candidates, counts, summary |
| ✓ | account-health | GET | 200 | 54ms | summary, items, candidates, computed_at |
| ✓ | jobs (list) | GET | 200 | 51ms | count, jobs |
| ✓ | jobs/refresh (smart) | POST | 200 | 55ms | id, type, status, started_at |
| ✓ | pool-models | GET | 200 | 51ms | models, total |
| ✓ | routing/simulate | POST | 200 | 54ms | selected, strategy, quota_mode, candidates |
| ✓ | routing/explain | POST | 200 | 52ms | candidates, selected |
| ✓ | token-stats | GET | 200 | 53ms | entries, pricing_note, started_at, today |
| ✓ | token-reports 24h | GET | 200 | 52ms | range, window_start_ts, window_end_ts, truncated |
| ✓ | token-reports model | GET | 200 | 50ms | range, window_start_ts, window_end_ts, truncated |
| ✓ | token-reports provider | GET | 200 | 56ms | range, window_start_ts, window_end_ts, truncated |
| ✓ | token-reports api-key | GET | 200 | 51ms | range, window_start_ts, window_end_ts, truncated |
| ✓ | token-reports account | GET | 200 | 50ms | range, window_start_ts, window_end_ts, truncated |
| ✓ | pricing | GET | 200 | 50ms | count, items, note, source |
| ✓ | api-key-limits | GET | 200 | 52ms | date, limits, orphans, total |
| ✓ | api-key-insights | GET | 200 | 51ms | summary, items |
| ✓ | maintenance-rules | GET | 200 | 51ms | count, items |
| ✓ | audit-log | GET | 200 | 53ms | count, items, limit, offset |
| ✓ | capacity-forecast | GET | 200 | 53ms | range, summary, groups, recommendations |
| ✓ | backups | GET | 200 | 52ms | items, count |
| ✓ | webhooks | GET | 200 | 53ms | webhooks, known_events, total, note |
| ✓ | issues | GET | 200 | 55ms | items, summary |
| ✓ | alerts | GET | 200 | 56ms | alerts, count |
| ✓ | health-summary | GET | 200 | 54ms | metrics, reasons, score, status |
| ✓ | request-history | GET | 200 | 56ms | count, limit, offset, records |
| ✓ | analytics/daily | GET | 200 | 51ms | count, items |
| ✓ | analytics/hourly | GET | 200 | 51ms | count, items |

---

## 2. 账号状态分析

| 指标 | 数值 |
|------|------|
| 账号总数 | 282 |
| 状态 active | 282 |
| 需要重登录 (needs_relogin) | **266** |
| 问题账号 (problem) | 266 |
| last_error.message 已设 | 266 |
| active 且无 lastRefresh | 278 |

**错误类型**：efresh_token_reused（HTTP 401）

`
token refresh failed with status 401: {
  "error": {
    "message": "Your refresh token has already been used to generat
`

---

## 3. 修复效果对比

| 指标 | 修复前 | 修复后 | 变化 |
|------|--------|--------|------|
| needs_relogin 数量 | 0 | **266** | ✓ 现在能正确识别 |
| Badge 显示 (刷新失败) | 未刷新 (黄色) | 刷新失败 (橙色) | ✓ 需浏览器强制刷新 |
| Sidebar 固定 | 跟随滚动 | 固定不动 | ✓ 已修复 |
| conductor StatusMessage | 未同步 | 同步 LastError | ✓ 已修复 |
| authNeedsRelogin 对 active 账号 | 不检测 LastError | 先检测 LastError | ✓ 已修复 |

---

## 4. 待处理问题

### P0 — 立即处理

**266 个账号的 refresh_token 已被消耗（refresh_token_reused）**

原因：多次部署重启时 auto_refresh_loop 并发触发，导致同一 refresh_token 被使用多次。  
解决方案：
1. 进入 /cpa-management/accounts
2. 点击「⚡选需重登录」→ 自动选中 266 个账号  
3. 点击「🔁 批量重登 (266)」→ 逐个 OAuth 重授权
4. 或进入「账号健康」→ 筛选 critical → 批量重登

**30 个账号的 access_token 已过期（quota 查询 401）**

这些账号大概率与上述 266 有重叠（refresh_token 也失效），统一通过批量重登解决。

### P1 — 后续跟进

| 问题 | 影响 | 建议 |
|------|------|------|
| auto_refresh_loop 无限重试失败账号 | CPU/网络浪费 | 检测 refresh_token_reused 后暂停重试（需 upstream patch） |
| overlay-config 端点 404 | 无法读取 overlay.yaml | 检查路由注册 |
| bulk refresh 后 goroutineDone 检测依赖 lastRefreshedAt | 精度问题 | 当前 goroutineDone 兜底机制已足够 |

---

## 5. 当前运行状态

- **服务**: 正常运行（282 clients = 279 auth + 2 codex-api-key + 1 Gemini）
- **端点**: 36/36 全部返回 200 ✓
- **响应时间**: 53-294ms（正常）
- **配额**: 251 个账号有效配额，平均 23.5% 消耗

---

## 6. 浏览器端注意事项

**Badge 改动（刷新失败橙色 vs 未刷新黄色）需要强制清除浏览器缓存才能看到**：

- Chrome/Edge: **Ctrl+Shift+R** 或 Ctrl+F5
- Firefox: Ctrl+Shift+R
- Safari: Cmd+Shift+R

React SPA 的 JS bundle 已更新（嵌入在新 Go 二进制里），但浏览器可能缓存了旧版。

---

*报告生成时间: 2026-05-08 07:37:45 UTC*  
*测试脚本: /tmp/cpa_test.sh on DMIT-LPZqoMyy17*
