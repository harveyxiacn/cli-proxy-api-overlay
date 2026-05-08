# CPA 管理面板 P3 桌面化与旧入口迁移设计

## 背景

当前交付形态包含：

- `/management/*`：新版 React SPA，随 Go 二进制 embed。
- `/extended.html`：旧扩展 UI，用户要求保留。
- `/management.html`：CPA 原管理面板，用户要求保留。

长期看，React SPA 应成为主入口；桌面化可以降低本地用户启动、打开浏览器、输入管理密钥和处理 OAuth callback 的成本。但旧入口必须继续作为回退手段存在。

## 目标

1. 设计 Tauri 桌面壳，复用现有 React SPA。
2. 支持本地启动/连接 CPA server。
3. 优化本地管理密钥和 OAuth callback 体验。
4. 明确旧入口迁移策略：默认隐藏但不删除。
5. 保证桌面壳失败时浏览器 UI 仍可使用。

## 方案选择

### 方案 A：Tauri 桌面应用

优点：体积小，能复用前端，支持系统托盘和本地能力。  
缺点：需要额外构建链和签名流程。

### 方案 B：Electron

优点：生态成熟。  
缺点：体积大，与当前轻量单二进制定位冲突。

### 方案 C：只保留浏览器 UI

优点：零额外复杂度。  
缺点：本地用户体验仍依赖手动打开 URL 和输入密钥。

推荐方案 A，但作为 P3 可选交付，不影响 Go server 主线。

## 桌面架构

```text
Tauri Shell
  ├─ WebView: http://127.0.0.1:<port>/management/
  ├─ Sidecar or external CPA process
  ├─ Local settings: server path, config path, port, auto start
  ├─ System tray: open, restart, stop, logs, quit
  └─ OAuth callback helper
```

两种运行模式：

1. 连接已有 server：用户输入 URL/key。
2. 托管 server：Tauri 启动 `cli-proxy-api.exe --config ...`，自动打开 WebView。

P3 初版优先实现模式 1，模式 2 作为后续增强。

## 本地安全设计

- 桌面壳不保存完整管理密钥，优先使用 OS keychain；不可用时提示用户每次输入。
- 本机连接优先 `127.0.0.1`。
- 自动启动 server 时生成 runtime-only local management password，只对 localhost 生效。
- WebView 禁止导航到非白名单域名，OAuth 授权窗口使用系统浏览器打开。

## React SPA 适配

前端新增 desktop bridge 检测：

```text
frontend/src/desktop/bridge.ts
```

能力：

- 获取本地 server URL。
- 打开外部浏览器。
- 读取桌面壳版本。
- 请求系统通知权限。

浏览器环境下 bridge 返回 no-op，不影响 `/management/*`。

## 旧入口迁移策略

### 当前阶段

三入口并存：

- `/management/`：默认推荐。
- `/extended.html`：旧扩展 UI。
- `/management.html`：原 CPA 面板。

### P3 迁移后

- Header 或 Settings 中提供“打开旧版入口”。
- `/extended.html` 和 `/management.html` 继续路由可达。
- 新版启动失败或 embed_frontend 未构建时，服务端日志提示旧入口地址。
- 不做自动跳转旧入口到新版，避免破坏用户书签和回退路径。

### 未来长期

只有在用户明确同意后，才把旧入口标记为 deprecated；不在本路线中删除。

## 构建与发布

### Go server

继续：

```powershell
go build -tags embed_frontend -ldflags="-s -w" -o cli-proxy-api.exe ./cmd/server
```

### Tauri

新增目录：

```text
desktop/
  src-tauri/
  package.json
  tauri.conf.json
```

构建产物：

- Windows portable exe。
- Windows installer。

Tauri 使用已构建的 `/management/`，不复制一套独立 UI 逻辑。

## OAuth 体验

桌面壳不拦截 provider OAuth 页面。流程：

1. React 发起 OAuth session。
2. 桌面壳打开系统浏览器。
3. Provider callback 回到 CPA server。
4. React 通过 SSE 或轮询获取 session 状态。

这样保持与浏览器版一致，减少 provider 登录兼容风险。

## 测试设计

1. 浏览器 `/management/` 不依赖 Tauri bridge。
2. 桌面环境能打开 SPA 并连接 server。
3. 外部链接不在 WebView 内跳转。
4. 旧入口仍返回 200。
5. embed_frontend 构建缺失时旧入口仍可用。

## 风险与回滚

- Tauri 完全独立于 Go server 主构建，失败不影响浏览器 UI。
- 旧入口不删除，始终可回退。
- 托管 server 模式延后，避免 P3 初版处理进程生命周期过多复杂度。
