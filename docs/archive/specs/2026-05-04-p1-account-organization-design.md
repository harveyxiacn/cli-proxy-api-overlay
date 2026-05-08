# CPA 管理面板 P1 账号组织与问题中心设计

## 背景

Accounts 页面已经支持 label 字段、批量启用/禁用/删除、warmup、排序和重复检测。但当账号数量达到几十到数百个时，单表格难以回答“现在最应该处理什么”。Dashboard 也需要从健康概览升级为问题处理中心。

## 目标

1. 支持账号分组、标签、备注、优先级和过滤视图。
2. Dashboard 展示可执行的问题队列，而不是静态统计。
3. 为重复账号、需重登录、冷却中、长期失败、配额异常、无请求账号提供治理入口。
4. 保持 auth 文件为主要真实来源，不引入必须依赖数据库的账号元数据。

## 数据模型

复用并扩展 auth 文件字段：

```json
{
  "label": "workload-a",
  "note": "main codex pool",
  "priority": 50,
  "proxy_url": "",
  "prefix": "",
  "group": "codex-free",
  "tags": ["free", "weekly", "stable"]
}
```

P1 必须实现：

- `group`：单值，用于主要分组。
- `tags`：多值，用于横向分类。
- `note`：自由文本。
- `priority`：整数，越大越优先。

现有 `PATCH /auth-files/fields` 已支持部分字段，扩展为可保存 `group` 和 `tags`。

## 后端设计

### 字段更新

扩展：

```text
PATCH /v0/management/auth-files/fields
```

请求：

```json
{
  "name": "account.json",
  "label": "prod-a",
  "note": "weekly pool",
  "priority": 80,
  "group": "codex-free",
  "tags": ["free", "batch"]
}
```

校验：

- `group` 最大 64 字符。
- `tags` 最多 16 个，每个最大 32 字符。
- 字符允许字母、数字、空格、`-`、`_`、`.`、中文。
- 空字符串等价于清除字段。

### 批量字段更新

新增：

```text
POST /v0/management/auth-files/fields-batch
```

支持批量设置 group、追加 tags、移除 tags、设置 priority。

请求：

```json
{
  "names": ["a.json", "b.json"],
  "set": {"group": "codex-free"},
  "add_tags": ["free"],
  "remove_tags": ["old"]
}
```

响应沿用 batch 风格：`updated/files/failed/errors`。

### 问题摘要 API

新增：

```text
GET /v0/management/issues
```

返回：

```json
{
  "summary": {
    "needs_relogin": 4,
    "cooling": 8,
    "disabled": 3,
    "duplicates": 2,
    "quota_low": 5,
    "long_failed": 6,
    "idle": 12
  },
  "items": []
}
```

`items` 的统一字段：

```json
{
  "id": "needs_relogin:account.json",
  "severity": "critical|warning|info",
  "kind": "needs_relogin",
  "auth_name": "account.json",
  "title": "Codex account needs relogin",
  "detail": "refresh_token_reused",
  "action": "oauth_repair",
  "ts": 1770000000
}
```

问题来源：

- auth status/status_message。
- request history 最近失败。
- token stats 最近活跃。
- quota 查询缓存。
- duplicate email 分组。

## 前端设计

### Dashboard 问题中心

Dashboard 顶部改为：

1. 系统健康分：0-100。
2. Critical/Warning/Info 数量。
3. Top 5 可执行问题。
4. 快捷操作：修复 OAuth、清理重复、刷新 Token、查询 Quota、禁用长期失败。

问题卡片点击后跳转对应页面，并自动带过滤条件。

### Accounts 信息架构

Accounts 页面拆为：

- 顶部统计与批量操作。
- 左侧筛选栏：provider、status、group、tags、priority、needs relogin、cooling、quota。
- 主表格。
- 右侧详情抽屉：文件信息、错误历史、最近请求、配额、编辑字段。

表格保留原功能，但将编辑 label/note/group/tags 放入详情抽屉，避免行内过度拥挤。

### 视图保存

前端 localStorage 保存过滤视图：

```json
{
  "name": "Needs Relogin",
  "filters": {"needsRelogin": true, "provider": "codex"}
}
```

P1 只本地保存，不同步到后端。

## 测试设计

后端：

1. `PATCH /auth-files/fields` 可写入 group/tags。
2. `fields-batch` 可批量追加和移除 tag。
3. `GET /issues` 能识别 needs relogin、cooling、duplicates。
4. 字段校验拒绝过长 tag。

前端：

1. Dashboard 能展示问题摘要。
2. 点击问题能跳转 Accounts 并应用过滤。
3. 批量设置 group/tags 后表格更新。
4. 详情抽屉保存字段后刷新 query cache。

## 风险与回滚

- group/tags 写入 auth 文件，旧版本忽略未知字段即可兼容。
- 批量字段更新必须逐文件失败隔离。
- 问题中心只读汇总，不影响代理请求路径。
