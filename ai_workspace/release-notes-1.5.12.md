# CraftStation v1.5.12 — Step Code 支持、文件预览实时刷新与 Codex 修复

安装包：**[CraftStation-Setup-1.5.12-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.12/CraftStation-Setup-1.5.12-x64.exe)**

便携版：**[CraftStation-Portable-1.5.12-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.12/CraftStation-Portable-1.5.12-x64.exe)**

## 用户可见

- StepFun 的 Step Code 成为受支持的 Agent：可在设置中安装、终端里登录，结构化会话默认使用 `step-5-preview`。
- 带自定义 Base URL 与 API Key 的第三方 OpenAI 兼容渠道可以驱动 Step Code 会话；本机已有 Step Code 会话可被发现并恢复。
- 文件栏中打开的 PDF、图片、视频与 Office 文档在磁盘文件变化时会自动重新加载，Agent 的改动即时可见。
- Codex / ChatGPT 线程在 turn 以 abort、错误或 idle 状态结束时不再停留在「工作中」。

## 实现

- 新增 `src/supervisor/agents/stepcode/` 独立适配器：复用 pi 兼容的 `step --mode rpc` JSONL 协议，`binary: "step"`，登录态探测 `~/.stepcode/auth.json`，会话文件布局 `~/.stepcode/agent/sessions/`。
- 第三方路由新增 `stepfun` 模型族（`step-`/`step_`/`step/`/`stepfun` 前缀）；`prepareStepCodeEndpointRuntime` 写隔离 `models.json` + env 投影（`STEP_CODING_AGENT_DIR`/`STEP_API_KEY`/`STEP_BASE_URL`），responses 协议 fail-closed。
- `refreshOpenBuffers()` 纳入干净的 `binary` buffer，按 `modifiedAtMs` 判定后重建；PDF/图片/音视频 URL 追加 `?v=<mtime>` 缓存穿透，webview 随版本 key 重挂载。
- `eventMapping.ts` 将 `turn/aborted` 映射为 interrupted 的 `turn.completed`，`error`/`thread/error` 走 warning/error 事件，`thread/status/changed` 在有开放 turn 时合成收敛事件；`nativeCodexRuntimeAdapter` 增加 8s 错误 settle 看门狗，`willRetry` 不误杀。

## 验证

- `pnpm typecheck`、`pnpm lint` 全绿。
- 新增/更新回归测试：stepcode adapter、provider manifest、第三方路由、文件预览刷新、nativeCodex turn 收敛共 40+ 用例通过。

---

# CraftStation v1.5.12 — Step Code support, live file previews & Codex fixes

Installer: **[CraftStation-Setup-1.5.12-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.12/CraftStation-Setup-1.5.12-x64.exe)**

Portable: **[CraftStation-Portable-1.5.12-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.12/CraftStation-Portable-1.5.12-x64.exe)**

## User-facing

- StepFun's Step Code agent is now a supported provider — install it from Settings, sign in from the terminal, and chat in structured sessions that default to step-5-preview.
- Third-party OpenAI-compatible accounts with a custom Base URL and API key can drive Step Code sessions, and existing Step Code sessions are discovered and can be resumed.
- PDFs, images, videos, and Office documents open in the file panel now reload when the file changes on disk, so an agent's edits show up instead of a stale copy.
- A Codex or ChatGPT thread no longer stays stuck on "working" when the app server ends the turn through an abort, an error, or an idle status instead of a completion event.

## Implementation

- New `src/supervisor/agents/stepcode/` adapter on the pi-compatible `step --mode rpc` JSONL protocol: `binary: "step"`, auth probing via `~/.stepcode/auth.json`, session discovery under `~/.stepcode/agent/sessions/`.
- Third-party routing gains a `stepfun` model family (`step-`/`step_`/`step/`/`stepfun` prefixes); `prepareStepCodeEndpointRuntime` writes an isolated `models.json` plus env projection (`STEP_CODING_AGENT_DIR`/`STEP_API_KEY`/`STEP_BASE_URL`), fail-closed for responses-protocol accounts.
- `refreshOpenBuffers()` now includes clean `binary` buffers, re-reading on `modifiedAtMs` changes; PDF/image/media URLs carry `?v=<mtime>` cache-busting and the webview remounts on version change.
- `eventMapping.ts` maps `turn/aborted` to an interrupted `turn.completed`, surfaces `error`/`thread/error` notifications, and synthesizes completion when `thread/status/changed` reports idle or a system error with an open turn; `nativeCodexRuntimeAdapter` adds an 8s error-settle watchdog that leaves `willRetry` turns alone.

## Verification

- `pnpm typecheck` and `pnpm lint` are clean.
- New and updated regression tests pass across the stepcode adapter, provider manifest, third-party routing, file-preview refresh, and nativeCodex turn-settle paths.
