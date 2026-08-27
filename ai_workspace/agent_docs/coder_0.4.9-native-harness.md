# Coder — v0.4.9 Native Multi-Harness User-Gate Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.9`
>
> 状态：已按 `debugger_0.4.9-native-harness.md` Fix Plan 完成 F15 / F16 / F17。等待 Debugger 独立复检。v0.4 Feature 仍不可宣称 PASS。

## 用户现场根因

用户完成官方 device-auth（`accounts.x.ai`，GROK_HOME 为 managed pending）后：

- 登录 overlay 右上角 X 与 Windows `titleBarOverlay` 标题栏控件叠在同一角，点不到 → 关不掉；
- 「模型与用量」仍看不到 Grok 号池/认证信息 → 磁盘 `accounts.json` 已有 `provider: grok`、`status: available`、`maskedIdentity` 的受管账号，但 UI 被 `filter(provider === "codex")` 滤掉了；用户因此重复点登录。

## F15 — ModelUsageDialog 与 Grok 卡片显示受管 Grok 账号

### 修复

- `SidebarProviderAccounts.tsx`：
  - 抽出 `AccountRow` 与 `ManagedAccountPool` 组件（provider 参数化）。
  - `ModelUsageDialog` 不再只渲染 `codex` 账号池：新增 `grokAccounts` / `signedGrokAccounts`，渲染「Grok 账号池」section（`provider-card-grok`），含 maskedIdentity / status / 首选 / 刷新 / 启用 / 移除 / 登录授权。
  - `reorder` 支持 provider 参数（codex / grok 分别排序）。
  - ProviderCard 紧凑卡 `managedAccounts` 按 `props.id` 过滤（codex / grok），登录授权按钮按 provider 走 `runCodexProfileLogin` 或 `createAndRunGrokProfileLogin`。
  - 删除不再使用的 `tokenUsage` / `activeTab` / `setActiveTab`（原 codex-only token tab）。
- `createGrokProfile`（添加 Grok 账号）接 `createAndRunGrokProfileLogin({ label: "New Grok" })`。

### 测试

- `SidebarProviderAccounts.test.tsx` 新增：`renders an imported Grok account in the model usage dialog` —— seed 一条 grok available 账号（`maskedIdentity`、`status: available`）后打开 dialog，断言「Grok 账号池」、maskedIdentity、status 可见。

## F16 — LoginTerminalOverlay 关闭与定位

### 修复

- `LoginTerminalOverlay.tsx`：
  - 面板从 `top-8 right-8` 改为 `top-16 right-4`（下移到 Windows caption 之下，不再与 titleBarOverlay 叠角）。
  - 面板与 header 设 `appRegion: "no-drag"`（`style` cast），X 按钮可点击。
  - `closeSession`（X / 遮罩点击 / 失败后手动关闭）执行：`disposeRoutedShellSession` + `readBridge().closeThread` + `session.onForceClose?.()` + `useLoginTerminalStore.close()`。
  - 遮罩（backdrop）点击同样走 `closeSession`。

### 测试

- `LoginTerminalOverlay.test.tsx` 新增：面板 className 含 `top-16`，`appRegion`/`WebkitAppRegion` 为 `no-drag`。

## F17 — 官方 identity 出现即完成并关 overlay；关闭即 cancel + 删 pending 目录

### 修复

- 新增 IPC `pollGrokProfileLogin({ pendingRef })`（supervisor）：检查 pending home 的 `auth.json` 是否已含官方 identity（`grokAuthContainer` + `grokAccountIdentityFromContainer`）；有则 `completeGrokProfileLogin` 并返回 `{ done: true, account }`。
- `contracts/grokProfiles.ts` 新增 `grokProfilePollPayload/Result`；`usage.ts` procedure + `ipcHandlers` 注册。
- renderer `runGrokProfileLoginInternal`：`startGrokProfileLogin` 成功后启动 1s interval 轮询 `pollGrokProfileLogin`；`done` 时 `finish(0)` → complete → 刷新账号列表 → 关 overlay（不再等 grok CLI 写 OSC/退出）。
- `finish(0)` 成功分支：若 poll 已 complete（complete 抛 "Unknown pending Grok login"），视为已成功并继续刷新。
- 关闭 overlay（X / 遮罩 / onForceClose）→ `cancelGrokProfileLogin` → supervisor 删除 pending 目录（`removeGrokPendingHome`，`relative` 校验仅删 managedRoot 内路径）。
- `completeGrokProfileLogin` 无 identity 失败分支同样清理 pending 目录。

### 测试

- `runtime.test.ts`（Grok profile login）新增：`polls a pending login and promotes it once the official auth.json has an identity` —— 无 auth.json 时 `done:false`；写入带 identity 的 auth.json 后 `done:true` 且落行、pending 清空。
- `agentLoginActions.test.ts` 新增：`promotes a Grok login once the pending auth.json carries an identity and closes the overlay` —— poll 首次 done:false、二次 done:true，`completeGrokProfileLogin` 被调用、`loginTerminalStore.close` 被调用。

## 回归

- F08：Grok 卡片不打开 grok.com，登录走官方 device-auth；`accounts.x.ai/oauth2/device` 测试保持。
- F12：pending GROK_HOME → 官方 device-auth → identity 门控 import；IPC/UI 已接。
- F13：spawn env 显式设空屏蔽宿主 API key / Router 变量（seed 宿主 key 测试保持）。
- F14：agentLoginActions.test.ts、SidebarProviderAccounts.test.tsx 全绿。
- 全量定向回归：**25 files / 193 passed**。
- `pnpm typecheck`、`pnpm lint` 通过；`git diff --check` 无 whitespace error（仅既有 CRLF 提示）。

## 边界

- F04 五 Harness 仍 BLOCKED（Grok 官方余额、Kimi AUTH_REQUIRED、Antigravity unprobed、DSH unavailable）。
- F09 保持关闭：未导入 Router `xai-*.oauth.json`/cookie/refresh token；未接 CLIProxyAPI；未覆盖 `~/.grok/auth.json` 作默认切号。
- 不 commit / tag / push；不宣称 Feature PASS；不进入 v0.5。
