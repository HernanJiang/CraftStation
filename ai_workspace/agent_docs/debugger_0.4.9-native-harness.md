# Debugger — v0.4.9 Native Multi-Harness User-Gate FAIL

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.9`
> 日期：2026-08-27
> 角色：Debugger
> 用户现场：[codex-clipboard-67d0c514-5d9e-47f0-bca5-883f15b34bf1.png](file:///C:/Users/Haona/AppData/Local/Temp/codex-clipboard-67d0c514-5d9e-47f0-bca5-883f15b34bf1.png)
> 上一轮：[debugger_0.4.8-rereview-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.8-rereview-native-harness.md)
> Verdict：**FAIL**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**

用户完成官方 device-auth 后：登录 overlay 右上角关不掉；「模型与用量」仍无 Grok 号池/认证信息。这不是 F04 余额问题，是生产 UI 闭环缺口。

## Evidence

### 用户截图

- Overlay 标题：`New Grok 登录`
- `CraftStation GROK_HOME=C:\Users\Haona\.craftstation-dev\craftstation-accounts\grok-pending-New-Grok-mtb6b6td`
- URL：`https://accounts.x.ai/oauth2/device?user_code=4GRM-KFQN`（F08 改道成立，不是 grok.com）
- CLI 仍停在 `Waiting for authorization...`
- Overlay 右上角 X 与窗口标题栏控件叠在同一角

### 磁盘（独立核对，不记录 secret）

`C:\Users\Haona\.craftstation-dev\craftstation-accounts\accounts.json` **已经有**一条 Grok 受管账号：

- `provider: grok`
- `label: New Grok`
- `maskedIdentity` 存在
- `status: available`
- `credentialRoot` 指向 `profile-8ba0b87e-...`（该目录有 `auth.json` + `environment.json`）

同时残留：

- `grok-pending-New-Grok-mtb6akf4`（有 `auth.json`，第一次登录留下）
- `grok-pending-New-Grok-mtb6b6td`（截图这次，**没有** `auth.json`，CLI 还在等）

所以：**账号已经导入，UI 没画出来。** 用户因此又点了一次登录。

### 源码

- [SidebarProviderAccounts.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx)
  - `ModelUsageDialog`：`codexAccounts = accounts.filter(provider === "codex")`，只渲染「ChatGPT 账号池」
  - Grok 卡片 `managedCodexAccounts` 同样只列 Codex
  - `listAccounts({})` 会拉到 Grok 行，但全部被滤掉
- [LoginTerminalOverlay.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/LoginTerminalOverlay/LoginTerminalOverlay.tsx)
  - 面板 `fixed top-8 right-8`（32px）
  - X 在面板 header 右上角，和 Windows `titleBarOverlay` 关闭/拖拽区重叠
  - `closeSession` 依赖 `active`；header **没有** `app-region: no-drag`
- [agentLoginActions.ts](file:///D:/Work/CraftStation/craftstation/src/renderer/actions/agentLoginActions.ts)
  - overlay 自动关闭只在 `watchCommandCompletion` 收到 `poracode-login-complete` 且 `exitCode === 0`
  - grok CLI 停在 `Waiting for authorization...` 时 **不退出**，OSC 不发，X 又点不到 → 卡死
  - `onForceClose` 会 `cancelGrokProfileLogin`（第二次 pending 取消会删目录；第一次成功导入后 overlay 仍可能卡住）

## Findings

### F15 — Grok 受管账号写入 AccountStore，但「模型与用量」只展示 Codex 号池

**P0 / 用户可复现**

`accounts.json` 已有 `available` 的 Grok 账号。对话框和厂商卡片只 `filter(provider === "codex")`。用户看到的就是「没有号池、没有认证信息」。

### F16 — 登录 overlay 右上角 X 落在 Windows 标题栏命中区，关不掉

**P0 / 用户可复现**

面板 `top-8 right-8` 把 header/X 送进 caption overlay。点击被 Electron 吃掉，不是 React `closeSession`。成功后 CLI 若不退出，1200ms 自动 `close()` 也不会发生。

### F17 — 成功/失败后 overlay 与 pending 目录生命周期不完整

**P1**

- 第一次登录已 import，pending `mtb6akf4` 仍留在磁盘
- 第二次 `mtb6b6td` 无 `auth.json`，CLI 仍 Waiting
- 完成检测只认 OSC completion，不认 `auth.json` 已出现、也不认用户点 X
- X 失效时无法 cancel

F08 改道、F12 supervisor import、F13 空字符串覆盖 **保持关闭**。F04 五 Harness 真实回复仍 BLOCKED。

## Verdict

**FAIL**

不要宣称 Feature PASS。不要开完整 v0.5。这是 v0.4.9 UI/生命周期 Fix。

## Fix Plan

### Fix 1 — F15：号池按 provider 展示

1. `ModelUsageDialog` 为每个有 `AccountStore` 行的 provider 渲染号池（至少 **grok** 与 **codex**），不要写死 Codex。
2. 已登录 Grok 卡片放大/两列，列出 `maskedIdentity`、status、selected；「添加账号」继续 `createAndRunGrokProfileLogin`。
3. 打开「模型与用量」时 `listAccounts({})` 的 Grok 行必须可见。
4. 测试：seed 一条 grok `available` 账号，对话框/卡片能看到 masked identity，不是空号池。

### Fix 2 — F16：overlay 必须能关

1. 登录面板整体下移到 `env(titlebar-area-height)` / Windows caption 之下；header 与 X 设 `app-region: no-drag`（或等价 `poracode-overlay-header__controls`）。
2. X、遮罩点击、失败态都必须调用 `closeSession`（杀 shell + `onForceClose` + store close），**不要** `if (!active) return` 把残留面板留住。
3. 成功 import 后必须关掉 overlay，不要等 grok CLI 自己退出。
4. 测试：点 Close 会 `onForceClose` + `closeThread` + store 清空。

### Fix 3 — F17：完成检测与 pending 清理

1. 除 OSC completion 外：pending `GROK_HOME/auth.json` 出现官方 identity 即可 `completeGrokProfileLogin` 并关 overlay。
2. `cancelGrokProfileLogin` / complete 失败必须删 pending 目录（已有 `removeGrokPendingHome`，确认 UI 取消会走到）。
3. 不要在 CLI 仍 Waiting 时无限挂起；用户关 overlay 必须 cancel。

### 回归

- F08 仍禁止 grok.com
- F12 identity 门控
- F13 seed 宿主 key
- F14 Codex profile
- 不 commit/tag/push；不宣称 PASS

## Fix Acceptance Criteria

- [ ] 打开「模型与用量」能看到已导入的 Grok 账号（masked email + available）
- [ ] Grok 卡片能看到该账号，不是空白厂商卡
- [ ] 登录 overlay 的 X 能关掉面板并杀掉 CLI
- [ ] 浏览器授权成功后 overlay 会关，号池出现账号
- [ ] 取消/关 overlay 不留空账号，pending 目录删除
- [ ] 不打开 grok.com

## 用户最短验收（修完后）

1. 完全退出再开 CraftStation
2. 打开「模型与用量」——若已有上次导入的 Grok 账号，现在就应看到 masked 邮箱
3. 再点 Grok「登录/授权」
4. 登录面板 X 必须能关掉
5. 走 `accounts.x.ai` 授权成功后：面板关掉，号池出现该账号
