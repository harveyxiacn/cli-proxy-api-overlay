# CPA 管理面板扩展 — 文档索引

本目录是 CLIProxyAPI（CPA）之上叠加的 React 管理面板扩展的文档集合。
项目根的 `README.md` / `README_CN.md` 是 CPA 上游本身的入口。

## 主要文档

| 文档 | 用途 |
|------|------|
| [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) | 完整开发日志（30 节，按时间序）—— 决策、实现、bug、回归。最新 §30 (2026-05-08) 涵盖按设计文档实施 12 个 P0/P1/P2/P3 运维模块（账号健康、维护规则、审计日志、Token 报表、API Key 画像、路由实验台、容量预测、备份、系统诊断、SQLite scaffold）+ 上游 release 检查 + 定价核对 + bulk-refresh 限流（解决 282 账号 thundering-herd 假 401） |
| [MAINTAINING.md](MAINTAINING.md) | Overlay 系统维护指南 —— 升级 CPA 上游、加新功能、排错。**§12 涵盖 VPS 远程部署的完整 playbook**；当前 overlay 快照包含 54 个新 CPA 文件（含 12 个运维模块）、13 个 patch |
| [CPA_vs_CodexManager_API_Analysis.md](CPA_vs_CodexManager_API_Analysis.md) | CPA 与 Codex-Manager 的 API 全面对比（已标注 CPA 现已吸收的日志、账号维护、Token/API Key 聚合能力） |
| [OVERLAY_FEATURE_MODULES_DESIGN.md](OVERLAY_FEATURE_MODULES_DESIGN.md) | Overlay 后续功能模块详细设计与开发规范 —— 账号健康、自动维护、Token 报表、路由实验台、容量预测、审计、备份、系统诊断、SQLite 分析库 |

## 工具脚本（在 `overlay/` 目录）

| 脚本 | 用途 |
|------|------|
| `overlay/detect-removed.bat` | 升级前侦察被删除/重命名的端点（只读） |
| `overlay/update-cpa.bat` | 一键升级（stash → pull → apply → verify → test → build） |
| `overlay/verify-overlay.bat` | 一致性检查（CI 集成） |
| `overlay/selftest.bat` | 端到端 round-trip 自测 |
| `overlay/refresh-overlay.bat` | 重新捕获当前 CPA tree 状态到 overlay |
| `overlay/apply-overlay.bat` | 把 overlay 应用到 CPA tree |

完整说明见 [MAINTAINING.md §7](MAINTAINING.md)。

## 历史归档

`archive/` 目录保留早期的设计 spec 和实现 plan，仅作历史参考，不再维护。

| 子目录 | 内容 |
|--------|------|
| `archive/plans/` | 早期实现计划（P0 / P0b / P1-P3 阶段、React 重构计划） |
| `archive/specs/` | 早期设计文档（11 个 design docs 涵盖 P0-P3 各功能模块） |

## 加新功能

不要直接改 CPA 上游文件或 `server.go`。在 **`overlay/files/internal/api/handlers/management/`** 新建文件，
通过 `init() { RegisterExtensionRoute(...) }` 自动注册路由。

需要扩展 SDK 级别能力（如给 `Manager` 加方法以访问 unexported 字段）时，新文件放
**`overlay/files/sdk/cliproxy/auth/`** —— 已有先例：`bulk_refresh_throttled.go` 给 `Manager`
加导出方法 `TriggerRefreshAllThrottled` 解决 bulk-refresh 限流问题。

详见 [MAINTAINING.md §10](MAINTAINING.md)「添加新功能（最佳实践）」。
