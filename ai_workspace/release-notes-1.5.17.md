# CraftStation v1.5.17 — Step Code 按渠道协议路由

安装包：**[CraftStation-Setup-1.5.17-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.17/CraftStation-Setup-1.5.17-x64.exe)**

便携版：**[CraftStation-Portable-1.5.17-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.17/CraftStation-Portable-1.5.17-x64.exe)**

## 用户可见

- 阶越星辰等 Step 系第三方渠道模型不再报「暂不支持直连 stepcode Harness」：渠道已验证支持 Chat Completions 且本机装有 `step` 时走原生 Step Code；否则自动回退 OpenCode，不再在发送时崩错。
- 渠道验证现在顺带探测 `/chat/completions` 第二面并把结论随账号凭证本地持久化——Responses 优先的渠道若同时提供 Chat Completions，Step Code 可以直接跑原生，无需再登录。

## 实现

- `probeChatCompletionsSurface`：只探 Chat Completions 面，确定性结论（成功/协议不支持）才算数，瞬时故障不缓存；`verifyModel` 与账号表单验证均顺带探测，`chatCompletionsOk` 写入密封凭证桶。
- 路由层（`resolveThirdPartyHarnessForModel`/`applyThirdPartyPickerSelection`/`composerPickerAgentKind`/`useManagedComposerProviders`）全部接入安装列表 + 渠道戳；新建对话、既有会话切换、chip 显示路径一致。
- 发送路径惰性探测：新 IPC `probeChannelChatCompletions`，仅 stepcode 已装 + Step 系 + 三方账号 + 无定论戳时 await 一次，结论回写该账号对应模型行；其余路径保持全同步。
- spawn 闸门：`resolveThirdPartySessionEnv` 对 stepcode 绑定时读 `chatCompletionsOk`，未知则惰性探测，仍不通过才 fail-closed。

## 验证

- 新增渠道协议路由、能力探测/缓存、stepcode 闸门用例；244 supervisor/shared + 135 renderer 测试全过；`pnpm typecheck` 与 oxlint 零告警。
- Windows x64 双包由 Release workflow 全平台构建。

---

# CraftStation v1.5.17 — Step Code routes by what the channel can speak

Installer: **[CraftStation-Setup-1.5.17-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.17/CraftStation-Setup-1.5.17-x64.exe)**

Portable: **[CraftStation-Portable-1.5.17-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.17/CraftStation-Portable-1.5.17-x64.exe)**

## User-facing

- Step-family third-party models no longer hit "this API does not support the stepcode harness" — channels proven Chat Completions-capable run on native Step Code when `step` is installed; everything else falls back to OpenCode instead of erroring at send time.
- Channel verification now also probes the `/chat/completions` surface once and seals the result with the account credential — a Responses-first channel that still serves Chat Completions can run Step Code natively.

## Implementation

- `probeChatCompletionsSurface`: probes only the chat surface; only definitive answers are cached; `verifyModel` and the account form both probe it, persisting `chatCompletionsOk` beside the sealed credential.
- Routing (`resolveThirdPartyHarnessForModel` / `applyThirdPartyPickerSelection` / `composerPickerAgentKind` / `useManagedComposerProviders`) is installed- and protocol-aware across new launches, live switches, and picker display.
- Send path lazily probes once per channel via the new `probeChannelChatCompletions` IPC only when stepcode could actually win, then stamps the result back onto the channel's model row; every other path stays synchronous.
- Spawn gate: `resolveThirdPartySessionEnv` reads `chatCompletionsOk` when binding stepcode, lazily probing once and failing closed only when the chat surface is truly unavailable.

## Verification

- New routing/probe/gate tests; 244 supervisor/shared + 135 renderer tests pass; `pnpm typecheck` and oxlint clean.
- Windows x64 dual packages built by the Release workflow across all platforms.
