# CPA 管理面板全量优化路线设计

## 背景

`docs/DEVELOPMENT_LOG.md` 已记录管理面板从 `extended.html` 增量扩展到 React + Vite SPA，并完成 P0A/P0B：批量运维、时间筛选、前端拆包、请求历史/Token 统计持久化、刷新 Token job、Settings 运行配置补齐。用户明确要求旧版 `extended.html` 和 `management.html` 继续保留，作为新版故障时的回退入口。

本文件补齐 P0 之后的完整设计路线。后续每个专项应先按本设计写实现计划，再进入代码实现。

## 总目标

把管理面板从“可查看和手工操作”的控制台，升级为“实时、可诊断、可恢复、可审计、可扩展”的运维中心：

1. 实时显示请求、日志、job 和账号状态变化，减少轮询和等待不确定性。
2. 为 OAuth 失效账号提供跨 provider 的修复向导。
3. 支持账号分组、标签、批量治理和 Dashboard 问题处理中心。
4. 增强观测、告警、Prometheus 指标和错误日志诊断。
5. 将 JSONL/JSON 快照升级为可长期查询的 SQLite 数据层。
6. 完整管理 API Key、路由策略和配额感知调度。
7. 完成 UX、移动端、无障碍和 i18n 体系。
8. 设计桌面化打包与旧入口迁移策略，同时保留回退能力。

## 分层路线

### P0：已完成的稳定基础

- 批量启用/禁用、批量删除。
- localhost 管理密钥错误不封禁。
- 请求历史时间范围筛选。
- Token Top 账号图表与前端 lazy chunk。
- 请求历史 JSONL、Token 统计 JSON 快照。
- 刷新 Token job 轮询。
- Settings 运行配置。

### P1：运维体验闭环

P1 解决用户每天使用时最直接的卡点。

- `2026-05-04-p1-realtime-ops-design.md`：SSE 实时事件、job/log/history/status 推送。
- `2026-05-04-p1-oauth-recovery-design.md`：Codex/Anthropic/Gemini/Antigravity/Kimi OAuth 修复向导。
- `2026-05-04-p1-account-organization-design.md`：账号分组、标签、批量治理、Dashboard 问题中心。
- `2026-05-04-p1-observability-alerting-design.md`：告警、Prometheus、错误日志诊断和健康评分。

### P2：数据、策略与产品化

P2 将面板升级为可长期运营的管理系统。

- `2026-05-04-p2-storage-analytics-design.md`：SQLite 长期历史、索引、聚合分析和迁移。
- `2026-05-04-p2-api-key-routing-design.md`：API Key 管理 UI、使用量审计、配额感知路由策略。
- `2026-05-04-p2-ux-accessibility-i18n-design.md`：信息架构、响应式、快捷键、可访问性和多语言。

### P3：分发、桌面化与旧入口迁移

P3 处理交付形态和长期兼容。

- `2026-05-04-p3-desktop-legacy-design.md`：Tauri 桌面应用、离线资产、自动打开、本地安全和旧入口替换策略。

## 统一原则

### 兼容性

- `/extended.html` 和 `/management.html` 不删除。
- 新版 `/management/*` 的每个大功能必须有降级路径：轮询替代 SSE、JSONL 替代 SQLite、浏览器 UI 替代桌面壳。
- 后端新增接口应保持现有管理鉴权和 `allow-remote-management` 语义。

### 安全性

- 管理面板不展示完整 token、API key 或 OAuth refresh token。
- 导出、下载、错误日志查看必须继续使用管理密钥鉴权。
- 远程管理仍默认受 `allow-remote-management` 和管理密钥约束。

### 性能

- 首屏继续依赖 `startup-snapshot`。
- 实时能力优先使用单连接 SSE，避免每页独立轮询。
- 图表和重型页面继续 lazy load。
- 大数据查询进入 SQLite 后必须分页、索引和限流。

### 可测试性

- 后端每个新增 API 都要有 handler 单测。
- 数据层迁移必须有“旧文件存在、SQLite 为空”的启动恢复测试。
- 前端关键交互至少通过 `pnpm build` 和手工路由可达验证。

## 交付顺序建议

1. P1 实时事件：先打通事件总线，后续 OAuth、告警、Dashboard 都能复用。
2. P1 OAuth 修复向导：直接解决 `refresh_token_reused` 等高频问题。
3. P1 账号组织和问题中心：把已有 label、status、quota、history 整合成可执行任务列表。
4. P1 可观测和告警：在数据流稳定后做规则和通知。
5. P2 SQLite：等 P1 数据模型稳定后再迁移，避免反复改表。
6. P2 API Key/路由策略：依赖 SQLite 使用量和配额数据。
7. P2 UX/i18n：在页面结构稳定后统一打磨。
8. P3 桌面化和旧入口迁移：最后处理交付形态。

## 成功标准

- 管理员可以在 Dashboard 看到“当前最需要处理的 5 类问题”，并一键进入修复。
- 刷新 Token、OAuth、批量治理、配额查询都能展示真实进度和最终结果。
- 重启后仍能查询历史、Token、API Key 使用量和告警。
- 对低频用户，旧入口仍可直接打开并完成基础回退操作。
