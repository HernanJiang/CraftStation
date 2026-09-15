<p align="center">
  <img src="figures/CraftStation_LOGO.png" width="128" height="128" alt="CraftStation" />
</p>

<h1 align="center">CraftStation</h1>

<p align="center">
  <strong>Agent Runtime Composition System</strong><br />
  把 Model × Harness 合成成一次可运行的 Session。<br />
  不是多模型聊天窗，不是 CLI 启动器，也不是某一家 Harness 的换皮。
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

CraftStation 把一次 Agent 运行当成一次**合成**：选择 Item（模型、Harness、工具、账号），形成 Recipe，由 Crafter 编译计划，spawn 成 Entity，在 Session 里连续工作。

**Auto** 按模型族选择原生 Harness，让模型跑在它自己的运行时上，能力不被稀释。  
你在合成台指定的配方是显式组合：启动时就应该是那个 Harness + 那个模型。

<p align="center">
  <img src="docs/screenshots/home-composer.png" alt="CraftStation 首页：多 Harness 模型列表与我的配方" width="960" />
</p>

<p align="center"><em>一个窗口里同时管理 Codex、Kimi Code、Antigravity、OpenCode、Command Code……保存的配方会出现在模型列表顶部。</em></p>

## 核心能力

### 多 CLI / Harness 聚集到一起调度

Codex、OpenCode、Kimi Code、Antigravity / Gemini、Grok、DeepSeek、Muse、Claude、Cursor、Command Code、Copilot 以及 ACP 代理，都在同一套桌面里启动、停、切模型、看思考链和工具调用。不用为每个 CLI 开一个终端、记一套快捷键。

### 模型原生匹配 Harness，最大化模型能力

同一厂商的模型优先走该厂商的原生 Harness（例如 Gemini → Antigravity，Kimi → Kimi Code，GPT → Codex）。Agent Loop、上下文压缩、工具执行、MCP 与 Skills 仍由官方 Runtime 拥有，CraftStation 不重写这些内部能力。原生匹配是默认路径，也是能力上限最高的路径。

### 自定义 Harness + 模型搭配

合成台允许你显式组合：例如 **Gemini 3.8 Flash × Codex Native**，或 **Kimi K3-256k × Codex Native**。匹配时走原生；跨厂商时走兼容桥（CLIProxyAPI），把订阅/Key 投影成 Target Harness 能吃的 API。

<p align="center">
  <img src="docs/screenshots/workbench-craft.png" alt="合成台：Gemini 3.8 Flash 与 Codex Native Harness 兼容桥合成" width="960" />
</p>

<p align="center"><em>合成台：左边选模型，中间选 Harness，右边看组件（含 CLIProxyAPI）。可合成的结果可以存成配方，下次从首页直接选用。</em></p>

### 多号池 + 优先级调度

每个渠道可以挂多张账号（Grok、Kimi Code、ChatGPT、Command Code 等）。账号带优先级、启用开关和额度条。新会话按池规则调度：高优先级先用，额度耗尽或不可用时落到下一张，而不是每次手动换号。

<p align="center">
  <img src="docs/screenshots/account-pool.png" alt="渠道与额度：Grok / Kimi Code / Command Code / ChatGPT 多号池与优先级" width="960" />
</p>

<p align="center"><em>渠道与额度：同一提供商多账号排队，Weekly / Session 额度一目了然，第 1 优先、第 2 优先……可拖动调整。</em></p>

### MCP 原生：跨线程发任务、Schedule、Computer Use

CraftStation 自己提供 MCP，Agent 可以：

- **跨线程发任务**：把工作派给另一个正在跑的 Session（或新建一条），而不是把所有事塞进当前上下文
- **Schedule**：定时 / 间隔唤醒一条线程继续干活
- **Computer Use**：在本机桌面上点、键、截屏（Windows）

这些能力跟第三方 MCP 一样，在启动时按 Harness 兼容性注入。

### Skills、Git、MCP 统一管理

Skills、Git / worktree、MCP 服务器不再散落在各家 CLI 的配置目录里。CraftStation 作为统一管理面：启用、禁用、注入范围、项目级绑定都在一处。各 Harness 只消费已经解析好的能力集。

## 安装

Windows 便携版：

1. 从 [Releases](https://github.com/HernanJiang/CraftStation/releases) 下载 `CraftStation-Portable-*.exe`
2. 直接运行，无需安装
3. 登录你已有的 Agent 账号；自带 Key / 订阅即可

跨厂商配方需要 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)。1.2.5 便携版已内置官方 Windows amd64 sidecar；合成台也可以下载/启动它。

## 许可证

Apache License 2.0。Copyright HernanJIANG。
