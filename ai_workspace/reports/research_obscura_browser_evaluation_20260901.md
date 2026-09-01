# Obscura 作为 CraftStation 浏览器核心的可行性评估

日期：2026-09-01  
结论类型：研究/架构建议，不代表已实现或已验收

## 结论

Obscura **不适合直接替换 CraftStation 当前可见的内置浏览器**。它不是 Electron/Chromium 的二进制兼容内核，而是一个 Rust 编写、内置 V8 的独立 headless browser/rendering engine，提供自己的 DOM、网络、CSS 布局/CPU 绘制、CDP 和 MCP 层。

它可以作为 CraftStation 的**可选后台浏览器/Agent Browser Engine sidecar**进行验证，尤其适合：

- 无头网页抓取和文本/Markdown 提取；
- Agent 的后台页面检查、轻量 DOM 操作和截图；
- 不需要完整 Chromium Web API、媒体播放、复杂登录页面或高保真桌面交互的任务。

但它目前不应替代用户在 UI 中看到的 Electron `<webview>`。建议保持“双引擎”方向：可见交互继续使用 Electron Chromium；Obscura 只在明确兼容的后台任务中作为实验性 provider，经过真实任务基准后再决定是否扩大范围。

## 一手来源核验

### Obscura 官方仓库

- 仓库：[h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura)
- GitHub API 返回：Rust 项目，Apache-2.0，默认分支 `main`；仓库描述为 “The headless browser for AI agents and web scraping”。
- 截至本次核验，GitHub API 的 latest release 为 `v0.2.1`；Windows x86_64 发布包存在。

### 官方 README 的能力声明

README 明确写明 Obscura 是：

- “open-source headless browser for AI agents and web scraping”；
- 运行 V8 JavaScript、提供 CDP，并兼容 Puppeteer/Playwright 的部分工作流；
- 提供不依赖 Chromium 的 native rendering；
- 发布页自报与 headless Chrome 的内存、启动和页面加载对比数据。

这些性能数字是项目方 README 的宣传/基准声明，不是 CraftStation 在相同机器、相同页面和相同工作负载下的独立测量，不能直接当作 CraftStation 性能收益。

README 同时承认其渲染实现仍在演进，部分 Web API、媒体播放、长尾 CSS、合成器效果和平台字体光栅化可能不同于 Chromium。

### 官方 Architecture Overview

Obscura 官方架构文档把项目拆为多个 Rust crate：

```text
obscura-cli       fetch / serve / scrape / mcp
obscura-cdp       CDP WebSocket server
obscura-browser   page / navigation / lifecycle
obscura-js        V8 runtime via deno_core
obscura-dom       DOM tree
obscura-net       HTTP / cookies / stealth / blocklist
obscura-render    CSS / layout / text shaping / CPU paint
obscura           embeddable Rust library
```

官方请求流是 `CDP -> obscura-cdp -> obscura-browser -> obscura-net/dom/js`，渲染流由 `obscura-render` 使用保留布局和 CPU 绘制完成。官方文档还说明：一个进程内的所有页面共享一个 V8 isolate，V8 工作由全局锁串行化；这对并发后台任务的吞吐和隔离需要实际压测。

### 官方 CDP、Playwright/Puppeteer 与 MCP 文档

官方文档确认：

- 可以启动 `obscura serve`，通过 WebSocket 提供 CDP；
- Puppeteer 使用 `puppeteer-core` 连接，Playwright 使用 `connectOverCDP`，不是 Playwright 自有协议；
- `obscura mcp` 提供浏览器导航、快照、点击、填充、截图、网络、Console、Cookie、Storage 和标签页工具；
- MCP 的 HTTP transport 默认没有内置认证，公开暴露时需要 Origin allowlist 和外部网络隔离；
- 当前限制包括 service worker、原生媒体播放、部分 Web API、长尾 CSS/合成器效果，以及一个进程共享 V8 isolate。

## 与 CraftStation 当前实现的差异

CraftStation 当前可见浏览器路径是：

```text
React BrowserPanel
    -> Electron <webview>
    -> Guest WebContents (Chromium)
    -> Main BrowserTab / BrowserPanelManager
    -> CraftStation CDP、权限、导航、网络、MCP 与持久化
```

当前实现依赖 Electron 特有对象和生命周期：

- `BrowserPanel.tsx` 为每个 tab 渲染 `<webview>`，用 `getWebContentsId()` 回传主进程；
- `createMainWindow.ts` 开启 `webviewTag`，并用 `will-attach-webview` 关闭 preload、Node integration；
- `BrowserTab.ts` 保存 Electron `WebContents`，监听导航、标题、加载、Console、renderer crash，并使用 `capturePage`、`executeJavaScript` 等能力；
- `BrowserPanelManager.ts` 负责 tab、分组、持久化、登录捕获、MCP/CDP、截图和后台 headless 保活；
- `permissions.ts` 使用 Electron `Session`/`WebContents` 处理权限与导航安全；
- `persist:craftstation-browser` 是 Electron session partition，用于 Cookie 和网站登录状态。

Obscura 的 CDP 兼容性只意味着“客户端可以通过 CDP 连接到 Obscura”，不意味着它能提供 Electron `WebContents`、`Session`、`<webview>` Guest 生命周期或 Electron 权限模型。因此不能把现有 `BrowserTab` 的底层对象简单替换成一个 WebSocket URL。

## 若直接替换，会影响什么

至少需要重构以下边界：

1. 将 `BrowserTab` 从 Electron `WebContents` 抽象为 `BrowserEngineTab` interface；
2. 为可见页面实现 Electron adapter，为后台页面实现 Obscura CDP adapter；
3. 重新定义 Cookie、Storage、登录捕获、弹窗、权限、下载、文件/PDF、截图和 Console 的能力矩阵；
4. 处理 Obscura 与 Electron 在 DOM、Web API、媒体、service worker、复杂 SPA 和 CSS 上的行为差异；
5. 让 Browser MCP 明确声明当前 tab 的 engine/capability，而不是假设所有 tab 都是 Electron WebContents；
6. 增加真实网站和真实 Agent 任务的差分回归，不能只用 CDP 协议单元测试；
7. 对 Obscura MCP HTTP transport 增加本地端口、Origin 和进程生命周期防护，不能裸露未认证端口。

这已经是新的 Browser Engine feature，不是换一个依赖或修改一个启动参数。

## 性能判断

### 可能更快的场景

- 静态 HTML、轻量 JS、DOM/Markdown 抽取；
- 无需完整 GPU 合成和浏览器 UI 的后台任务；
- 多 URL 抓取（Obscura 提供 `scrape --concurrency` 和 worker 模式）。

### 不能预先假设更快的场景

- Electron 可见 UI 的首屏和滚动体验；
- 大型 React/Vue/Next SPA；
- 复杂登录、OAuth、验证码、支付页面；
- 音视频、WebRTC、service worker、下载和扩展依赖页面；
- 需要完整 Chromium 行为的 Browser MCP 交互。

Obscura 官方文档明确其 V8 isolate 在进程内共享并串行化；因此“单页更省内存/启动更快”与“多页并发吞吐更高”不是同一个结论，必须分别测量。

## 推荐接入方案

### 不推荐：直接替换可见 `<webview>`

当前阶段不推荐。风险是破坏现有登录 Cookie、网页兼容性、权限、安全策略、截图和 CraftStation 的 Browser MCP 控制面；即使静态页面更快，也可能让核心可见浏览器不可用。

### 推荐：Obscura Headless Adapter（实验性）

在 CraftStation 的 `harness-runtime`/Browser engine seam 后新增：

```text
BrowserEngine
├── ElectronWebviewEngine   # 当前可见浏览器，默认
└── ObscuraHeadlessEngine   # 可选后台实验引擎
```

第一期只允许显式选择 Obscura，且限定为无头任务：`navigate`、`snapshot/markdown`、`evaluate`、`click/fill`、`screenshot`、`network diagnostics`。不可兼容的能力必须在 UI 和 MCP 中显示为 `INCOMPATIBLE`，不能静默降级成“看起来成功”。

## 最小验证计划

在决定是否继续前，建立同机、同网络、同 URL、同任务的差分基准：

1. Electron `<webview>` 与 Obscura 各执行一次静态页面导航、DOM 提取、截图；
2. 各执行一次 React SPA、表单提交、同源 iframe 和 Cookie 持久化；
3. 各执行一次 Browser MCP 最小任务，记录首事件延迟、完成延迟、失败率、RSS、截图差异；
4. 单独测试登录/OAuth 页面、媒体页面和需要 service worker 的页面，允许 Obscura 明确失败；
5. 只有当“可接受兼容性 + 可复现实测收益”同时成立，才考虑扩大 Obscura 的路由范围。

## 最终建议

当前结论为：**不要用 Obscura 替换 CraftStation 的 Electron Chromium 可见浏览器；可以把 Obscura 纳入参考项目，并规划为可选的后台 Headless Browser Adapter。** 这样可以在不牺牲 CraftStation 现有 UI 和登录能力的前提下，验证它在 Agent 抓取/后台自动化场景是否确实带来速度和内存收益。
