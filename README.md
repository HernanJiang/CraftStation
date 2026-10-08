<p align="center">
  <img src="figures/CraftStation_LOGO.png" width="128" height="128" alt="CraftStation" />
</p>

<h1 align="center">CraftStation</h1>

<p align="center">
  <strong>Your model. Your harness. Your agent.</strong><br />
  Agent Runtime Composition System<br />
  Choose a model, craft a runtime, and get to work.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a>
  ·
  <a href="https://github.com/HernanJiang/CraftStation/releases/latest">Download</a>
  ·
  <a href="./LICENSE">Apache 2.0</a>
</p>

<p align="center"><em>HernanJIANG</em></p>

---

**Build the agent you want to work with.** CraftStation brings models, Harnesses, accounts, MCP servers, and Skills into one desktop workspace. Use **Auto** to follow a model's native runtime path, or craft a **Recipe** with an explicit Model × Harness combination and reuse it across your projects.

Inspired by Minecraft's crafting system, CraftStation turns composition into an executable workflow: select Items, form a Recipe, let the Crafter compile a plan, and spawn an Entity that works inside a continuous Session. The Harness is the runtime that drives the agent: its execution loop, context, and tools.

<p align="center">
  <img src="docs/screenshots/home-composer.png" alt="CraftStation home with projects, recent threads, and the unified agent composer" width="960" />
</p>

<p align="center"><em>Your projects, recent threads, environment, permissions, and agent selection—all within reach when you start a task.</em></p>

## What makes CraftStation different

### One model menu, a whole workspace of agents

Choose from models across **Codex, Grok Build, Kimi Code, Antigravity, OpenCode, Devin, Step Code**, and other integrated Harnesses. Saved Recipes appear alongside models, so a combination you crafted becomes an everyday choice in the same composer.

Stay in your project while switching agents, following their output, and inspecting tool activity. Your workspace stays familiar as you choose the runtime that suits the task.

<p align="center">
  <img src="docs/screenshots/model-picker.png" alt="Unified model picker showing saved Recipes and models from multiple Harnesses" width="960" />
</p>

<p align="center"><em>Native models and your own Recipes share one entry point. The menu shows the Harness behind each choice.</em></p>

### Craft a combination. Save it. Use it again.

The workbench makes **Model × Harness** composition visible. Pick your ingredients, inspect compatibility, and save a craftable result as a Recipe. The inventory beside the grid shows available MCP servers and Skills, with shortcuts to manage them.

The screenshots show Recipes such as **Gemini 3.8 Flash × Codex Native Harness** and **K3-256k × Codex Native Harness**. Supported cross-vendor combinations use a compatibility bridge where needed; CLIProxyAPI handles provider/API compatibility while the selected Harness continues to run the agent.

Save a useful combination once, then select it from the home model menu when you need it again.

<p align="center">
  <img src="docs/screenshots/workbench-craft.png" alt="Crafting workbench with Model and Harness inventories, saved Recipes, MCP servers, and Skills" width="960" />
</p>

<p align="center"><em>A crafting grid for your agent: Model and Harness inventories, reusable Recipes, and a visible MCP and Skills inventory.</em></p>

### See the runtime behind the model

The Harness overview connects **Channel → Model → Final Harness / CLI**. See where a model comes from, which runtime executes it, and whether that runtime is ready or still needs installation.

**Auto** follows the model's default native path—for example, GPT → Codex, Kimi → Kimi Code, and Gemini → Antigravity. The official runtime retains ownership of its agent loop, context management, tool execution, MCP, and Skills. An explicit **Recipe** lets you choose a supported composition yourself.

<p align="center">
  <img src="docs/screenshots/harness-overview.png" alt="Harness overview connecting provider channels, models, and the final Harness or CLI, with readiness states" width="960" />
</p>

<p align="center"><em>Follow the connections from account channel to model to execution runtime, and see availability in the same view.</em></p>

### Put your accounts and quotas to work

Manage multiple accounts in supported provider pools, including **Grok, Kimi Code, and ChatGPT**. View session or weekly usage, reset times, account priorities, and enable/disable controls together.

New sessions follow the pool's scheduling rules. Order accounts by priority, and let pool failover select another eligible account when quota or availability prevents the current one from continuing. You can see which accounts still have capacity before starting the next task.

<p align="center">
  <img src="docs/screenshots/account-pool.png" alt="Channels and quotas showing Grok, Kimi Code, and ChatGPT account pools, priorities, usage, and reset times" width="960" />
</p>

<p align="center"><em>Multiple accounts, visible capacity, and clear priorities—managed from one Channels &amp; quotas page.</em></p>

## Tools that keep work moving

- **Cross-thread collaboration:** agents can hand tasks to other Sessions or create a new one through built-in MCP tools.
- **Schedule:** wake a thread at a scheduled time or interval to continue working.
- **Browser and Computer Use:** give compatible Harnesses browser tools and Windows desktop actions, including clicks, typing, and screenshots.
- **Skills, MCP, and Git / worktrees:** manage capabilities and project workflows from the same desktop, with project bindings and compatible tool injection.
- **CLI updates:** check and update installed CLIs from the titlebar. Automatic updates can be controlled in **Settings → Agents → General → Auto-update CLIs**; managed account-profile copies are updated too.

## Get started

**[Download the latest release →](https://github.com/HernanJiang/CraftStation/releases/latest)**

1. Choose the **Windows x64 installer** (`CraftStation-Setup-…-x64.exe`) or **portable build** (`CraftStation-Portable-…-x64.exe`). Run the installer for a regular installation, or double-click the portable executable.
2. Open CraftStation and connect your accounts. Agent CLIs use their official tools and your existing subscriptions; install or authorize the Harnesses you want to use.
3. Open a project, select a model with **Auto** or a saved **Recipe**, and send your first task.

The Windows package includes the desktop runtime and the CLIProxyAPI compatibility sidecar. No separate Electron or Node.js setup is required to run the packaged app. Available platforms and artifacts are listed on each release page.

## License

Apache License 2.0. Copyright HernanJIANG.
