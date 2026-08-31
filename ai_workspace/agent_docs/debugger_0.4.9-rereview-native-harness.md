# Debugger — v0.4.9 Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.9` 复检
> 日期：2026-08-27
> 角色：Debugger
> Coder 交付：[coder_0.4.9-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.9-native-harness.md)
> 上一轮 Fix Plan：[debugger_0.4.9-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.9-native-harness.md)
> Verdict：**FAIL / BLOCKED（F15/F16/F17 关闭；F04 仍缺五 Harness 真实 response）**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**
> Next Coder cycle: **不要开 v0.4.10。** 用户现场 UI 闭环已独立复检通过。下一动作是用户手工点一遍号池/关闭 overlay，再用有余额的 Grok 走真实 Session。

独立复检，不以 Coder self-check 代替质量门。v0.4 Feature **不得 PASS**，不得 Closeout。

## Review Scope

- F15：已导入 Grok 账号是否出现在「模型与用量」
- F16：登录 overlay X 是否离开 Windows caption，能否 closeSession
- F17：pending `auth.json` 有 identity 是否 poll complete 并关 overlay；取消是否删 pending
- F08/F12/F13/F14 回归
- F04 五 Harness 真实 response

## Evidence

### 独立源码

- [SidebarProviderAccounts.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx)
  - `ManagedAccountPool` 按 provider 渲染；dialog 有 `signedGrokAccounts` / 「Grok 账号池」
  - 紧凑 Grok 卡 `filter(provider === props.id && (maskedIdentity || providerAccountId))`
  - 打开 dialog 仍 `listAccounts({})`
- [LoginTerminalOverlay.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/LoginTerminalOverlay/LoginTerminalOverlay.tsx)
  - `top-16 right-4`（64px，低于常见 32px caption）
  - 面板/header `appRegion: "no-drag"`
  - `closeSession`：dispose shell + `closeThread` + `onForceClose` + store close
- [supervisorRuntime.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/supervisorRuntime.ts) `pollGrokProfileLogin`：pending `auth.json` 有官方 identity 则 complete
- [agentLoginActions.ts](file:///D:/Work/CraftStation/craftstation/src/renderer/actions/agentLoginActions.ts) 1s poll；done → finish(0) → 刷新账号 → 关 overlay

磁盘上已有的 Grok 行（`maskedIdentity` + `available`）满足紧凑卡和 dialog 过滤，修完后应能看见，不必再登录一次。

### 独立测试（Debugger 复跑）

```text
pnpm exec vitest run
  SidebarProviderAccounts.test.tsx
  LoginTerminalOverlay.test.tsx
  agentLoginActions.test.ts
  runtime.test.ts
  grokProfiles.test.ts
```

**5 files / 100 passed / 0 failed**

含：dialog 渲染导入的 Grok 账号；overlay `top-16` + no-drag；poll 有 identity 即 promote；agentLogin 关 overlay。

### CodeGraph

已 `codegraph sync`（11 个改动文件）。

## Spec Fidelity

| 要求                                   | 结果                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| 号池显示已导入 Grok                    | **关闭**（F15）                                                                    |
| overlay X 可点、可关                   | **关闭**（F16；`top-16` 非 `env(titlebar-area-height)`，64px 应离开 32px caption） |
| auth.json identity → complete + 关面板 | **关闭**（F17）                                                                    |
| 取消删 pending                         | **关闭**（沿用 removeGrokPendingHome）                                             |
| grok.com 改道                          | **保持关闭**                                                                       |
| 五 Harness 真实回复                    | **仍 BLOCKED（F04）**                                                              |

## Findings

### F15 / F16 / F17 — 关闭

用户现场两件事（号池滤掉 Grok、X 落在标题栏、CLI Waiting 不关 overlay）已在源码+测试对齐。不要再当成「授权失败」。

### F04 — 仍 BLOCKED

没有新的五路官方 native response。不要开 v0.4.10 代码修复。

## Verdict

**FAIL / BLOCKED**

v0.4.9 用户门禁工程项关闭。Feature 仍不能 PASS。

## 用户最短手工验收

**先完全退出 CraftStation 再开**（旧窗口还是 v0.4.8 代码）。

1. 打开左下角「模型与用量」。
2. **现在应看到：** 「Grok 账号池」和一条带 masked 邮箱、`available` 的受管账号（上次已经导入，不必再登录）。Grok 厂商卡也应列出该账号，不再是空白卡。
3. 若还要加号：点 Grok「添加账号 / 登录授权」。
4. 登录面板应在标题栏**下面**，右上角 X **必须能关掉**，关掉后 CLI 应结束。
5. 走 `accounts.x.ai` 授权成功后：面板应自己关掉，号池出现/刷新该账号。不要等 CLI 一直 `Waiting for authorization...`。
6. 用这张卡开一个 Grok Session，能出真实回复，才算 F04 的 Grok 格。

不要导入 Codex Router oauth 文件。不要反复点登录叠 pending。
