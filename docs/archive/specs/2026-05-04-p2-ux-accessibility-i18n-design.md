# CPA 管理面板 P2 UX、可访问性与 i18n 设计

## 背景

React 管理面板已经具备 Dashboard、Accounts、Quota、TokenStats、RequestHistory、OAuth、Logs、Duplicates、Settings 等页面。随着功能继续增加，必须控制信息架构复杂度，并为不同屏幕尺寸、键盘操作、多语言和错误恢复设计统一规范。

## 目标

1. 统一页面布局、筛选、批量操作、详情抽屉和空状态。
2. 提供响应式体验，兼容窄屏和移动端基础管理。
3. 支持键盘快捷键和无障碍语义。
4. 引入 i18n，默认中文，准备英文。
5. 降低高风险操作误触概率。

## 信息架构

主导航分组：

```text
Overview
  - Dashboard
Operations
  - Accounts
  - OAuth Repair
  - Quota
  - Jobs
Observability
  - Request History
  - Token Stats
  - Logs
  - Alerts
Configuration
  - API Keys
  - Settings
  - Routing
Utilities
  - Duplicates
```

如果页面暂未实现，导航不显示，避免空入口。

## 通用 UX 模式

### 筛选栏

所有列表页统一：

- 搜索框。
- 主要筛选 chips。
- 高级筛选折叠。
- “清除筛选”。
- 当前结果数量。

### 批量操作

批量 bar 固定在表格上方或底部 sticky：

- 显示已选数量。
- 普通操作直接执行。
- 危险操作先确认。
- 长操作进入 job modal。

### 详情抽屉

账号、API Key、告警、请求记录统一使用右侧 drawer：

- 概览。
- 最近事件。
- 可执行动作。
- 原始 JSON 诊断折叠区。

### 空状态

空状态必须告诉用户下一步：

- 无账号：上传 auth 或开始 OAuth。
- 无历史：发送一次代理请求后会出现记录。
- 无告警：系统当前没有需要处理的问题。
- 无日志：确认 logging-to-file 或请求日志配置。

## 响应式设计

### 桌面

- 左侧 sidebar 常驻。
- 表格显示完整列。
- drawer 宽度 480-720px。

### 平板

- sidebar 可折叠。
- 表格隐藏低优先级列，改在 drawer 展示。
- 批量 bar sticky。

### 手机

- 顶部 hamburger。
- 列表转卡片。
- 高风险批量操作隐藏或要求进入桌面宽度确认。
- Logs/RequestHistory 默认只显示摘要，详情点击展开。

## 可访问性

要求：

- 所有按钮有可读 label。
- Modal 和 Drawer trap focus。
- Toast 不作为唯一错误反馈，页面内也要显示错误。
- 颜色不作为唯一状态区分，徽章必须有文本。
- 表格排序状态通过 `aria-sort` 表达。
- 表单错误绑定 `aria-describedby`。

键盘快捷键：

| 快捷键 | 功能 |
|---|---|
| `/` | 聚焦当前页搜索 |
| `g d` | Dashboard |
| `g a` | Accounts |
| `g l` | Logs |
| `g s` | Settings |
| `r` | 刷新当前页 |
| `Esc` | 关闭 modal/drawer |

快捷键只在非输入框焦点时生效。

## i18n 设计

### 技术选择

使用轻量字典，不引入重型运行时：

```text
frontend/src/i18n/index.ts
frontend/src/i18n/zh-CN.ts
frontend/src/i18n/en-US.ts
```

API：

```ts
t("accounts.needsRelogin")
t("common.refresh")
```

默认语言：

1. localStorage 用户选择。
2. 浏览器语言。
3. `zh-CN`。

### 文案规范

- 错误文案说明原因和下一步。
- 危险操作使用明确动词：删除、禁用、重置。
- 避免技术栈词直接暴露给普通用户，诊断区可保留原始错误。

## 前端重构边界

不做大规模重写。按页面触达时抽取：

```text
components/common/FilterBar.tsx
components/common/BulkActionBar.tsx
components/common/DetailsDrawer.tsx
components/common/EmptyState.tsx
components/common/PageHeader.tsx
```

优先改 Accounts、RequestHistory、Logs，再推广到其他页面。

## 测试设计

1. `pnpm build` 确保字典 key 类型正确。
2. 关键页面在 375px、768px、1280px 三种宽度下手工验证。
3. Modal/Drawer 可用 Esc 关闭。
4. 表格排序带 `aria-sort`。
5. 切换语言后导航和主要按钮更新。

## 风险与回滚

- i18n 逐页接入，未接入页面继续显示中文。
- 响应式不影响桌面布局。
- 快捷键可在 Settings 中关闭。
