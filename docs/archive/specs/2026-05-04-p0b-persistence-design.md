# CPA 管理面板 P0B 持久化与任务化设计

## 背景

P0A 已完成批量 API、请求历史时间筛选、Recharts 图表和 localhost 封禁误伤修复。剩余最高优先级问题是：请求历史和 Token 统计仍主要依赖内存，服务器重启后管理面板缺少连续运维数据。

## 本轮实现范围

1. 请求历史持久化到本地 JSONL 文件，启动时恢复最近 5000 条记录。
2. Token 统计持久化到本地 JSON 快照，启动时恢复累计和今日统计。
3. `request-history/clear` 和 `token-stats/reset` 同步清理持久化文件。
4. 前端文案从“重启后清零”改为“持久化保留最近 5000 条/累计快照”。
5. 继续保留 `/extended.html` 和 `/management.html` 回退入口。

## 存储方案

本轮不引入 SQLite 驱动，原因：

- 当前 Go 项目没有 SQLite 依赖，直接引入会扩大构建和跨平台风险。
- P0B 的关键目标是“重启不丢”，JSONL/JSON 快照已能覆盖当前 UI。
- 后续如需复杂聚合、长期保留和索引查询，可从 JSONL 迁移到 SQLite。

文件位置：

```text
<config.yaml 所在目录>/data/request_history.jsonl
<config.yaml 所在目录>/data/token_stats.json
```

若管理 handler 没有 `configFilePath`，例如单元测试中的 `NewHandlerWithoutConfigFilePath`，则不启用磁盘持久化。

## 请求历史持久化

- 每条 `usage.Record` 仍先进入 5000 条内存环形缓冲。
- 同时追加一行 JSON 到 `request_history.jsonl`。
- 启动时读取文件尾部逻辑上最近 5000 条有效 JSON 记录并恢复环形缓冲。
- `POST /request-history/clear` 清空内存和 JSONL 文件。

## Token 统计持久化

- 每条成功/失败 usage 记录更新内存统计后，写出完整 `token_stats.json` 快照。
- 快照包含：
  - `started_at`
  - per-auth entries
  - global totals
  - today bucket
- 启动时恢复快照；若日期已跨天，现有 `maybeReset()` 会在读取时旋转今日桶。
- `POST /token-stats/reset` 清空内存并删除/清空快照。

## 非本轮范围

- SQLite 索引查询。
- 后端 job 状态系统。
- SSE/WebSocket 实时推送。
- 长期数据保留策略和自动压缩。

