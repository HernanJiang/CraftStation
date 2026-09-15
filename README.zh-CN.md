<p align="center">
  <img src="figures/CraftStation_LOGO.png" width="128" height="128" alt="CraftStation" />
</p>

<h1 align="center">CraftStation</h1>

<p align="center">
  <strong>Agent Runtime Composition System</strong><br />
  把 Model × Harness 合成成一次可运行的 Session，而不是多模型 GUI 或 CLI 启动器。
</p>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="https://github.com/HernanJiang/CraftStation/releases">下载</a>
  ·
  <a href="./LICENSE">Apache 2.0</a>
</p>

<p align="center"><em>HernanJIANG</em></p>

---

CraftStation 把一次 Agent 运行当成一次**合成**：选择 Item（模型、Harness、工具），形成 Recipe，由 Crafter 编译计划，spawn 成 Entity，在 Session 里工作。

**Auto** 按模型族选择原生 Harness。你在合成台保存的配方是显式组合，启动时应当就是那个 Harness + 模型。

## 能做什么

- 一个桌面窗口同时跑 Codex、OpenCode、Kimi Code、Antigravity / Gemini、Grok、DeepSeek、Muse、Claude、Cursor 以及 ACP 代理
- 模型厂商与 Harness 厂商匹配时走原生路径
- 跨厂商时走兼容路径（CLIProxyAPI），例如 **Kimi Code 的 Key 接入 Codex Harness**
- 共享工作区、MCP、Skills；GUI 展示思考链、工具调用和上下文窗口

## 安装

Windows 便携版：

1. 从 [Releases](https://github.com/HernanJiang/CraftStation/releases) 下载 `CraftStation-Portable-*.exe`
2. 直接运行，无需安装
3. 登录你已有的 Agent 账号，自带 Key / 订阅即可

跨 CLI 配方需要 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)。合成台可以把官方 Windows amd64 构建下载到 `~/.craftstation/tools/cpa/`。

## 许可证

Apache License 2.0。Copyright HernanJIANG。
