<p align="center">
  <img src="figures/CraftStation_LOGO.png" width="128" height="128" alt="CraftStation" />
</p>

<h1 align="center">CraftStation</h1>

<p align="center">
  <strong>Agent Runtime Composition System</strong><br />
  Compose Model × Harness into a running Session — not a multi-model GUI, not a CLI launcher.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a>
  ·
  <a href="https://github.com/HernanJiang/CraftStation/releases">Download</a>
  ·
  <a href="./LICENSE">Apache 2.0</a>
</p>

<p align="center"><em>HernanJIANG</em></p>

---

CraftStation treats an agent run as a **craft**: pick Items (model, harness, tools), form a Recipe, let the Crafter compile a plan, spawn an Entity, and work inside a Session.

**Auto** picks a native Harness for the model family. A Recipe you save on the workbench is an explicit composition and should spawn exactly that Harness + model.

## What it does

- One desktop for Codex, OpenCode, Kimi Code, Antigravity / Gemini, Grok, DeepSeek, Muse, Claude, Cursor, and ACP agents
- Native route when Model vendor and Harness vendor match
- Compatibility route (CLIProxyAPI) when you project a subscription onto a different Harness — for example **Kimi Code key → Codex**
- Shared workspace, MCP, skills, and a GUI that shows thinking, tools, and context usage

## Install

Windows portable build:

1. Download `CraftStation-Portable-*.exe` from [Releases](https://github.com/HernanJiang/CraftStation/releases)
2. Run it. No installer required.
3. Sign in to the agents you already use. Bring your own keys and subscriptions.

Cross-vendor recipes need [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). The workbench can download the official Windows amd64 build into `~/.craftstation/tools/cpa/`.

## License

Apache License 2.0. Copyright HernanJIANG.
