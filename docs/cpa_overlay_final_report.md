# CPA Overlay 授权文件功能最终修复报告

**测试时间**: 2026-05-08 15:14 UTC  **VPS**: DMIT-LPZqoMyy17  **结果**: ✅ 37/37 全通，0 错误

## 端点测试结果（37/37 ✓）
所有 overlay 扩展端点全部返回 200，包括 overlay-config（之前 404，已修复）。

## 授权文件最终状态

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| active+no_lastRefresh | 279 | **0** |
| needs_relogin | 0 (错误) | **5** (正确) |
| active badge | 黄色"未刷新" | 绿色"active" |
| last_refresh 字段 | 全为 null | 全部有值 (从 JSON metadata 读取) |

## 维护摘要（正确）
- active: 277 — 正常服务
- error/needs_relogin: 5 — 真正需要重登录
- refresh_failed: 247 — AT 有效但 RT 消耗过（非紧急，AT 到期前不需操作）

## 根本原因
`filestore.go` 加载时硬编码 `LastRefreshedAt = time.Time{}`，但 codex JSON 文件里已有 `last_refresh` 字段。只需在 `buildAuthFileEntry()` 调用已有的 `extractLastRefreshTimestamp()` 函数即可。

## 实施的五个修复
1. **buildAuthFileEntry fallback** — 从 JSON metadata 读取 last_refresh（主要修复）
2. **conductor.go 写入 metadata** — 成功刷新后把时间戳持久化到 JSON
3. **Badge 信任 CPA status** — status=active 直接显示绿色，不再依赖 last_refresh
4. **智能刷新只刷坏账号** — 跳过 status=active 账号，避免消耗 one-time-use refresh token
5. **overlay-config 路由注册** — 修复 404

## AT/ST/RT 关键认知（用户提供）
- AT 10天有效，ST 一次性使用，RT 理论无限期
- refresh_token_reused = ST 已消耗，非账号损坏，AT 仍有效
- 多次重启导致 auto_refresh_loop 反复触发消耗 ST 属正常现象
