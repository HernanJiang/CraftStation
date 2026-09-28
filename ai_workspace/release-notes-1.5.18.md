# CraftStation v1.5.18 — 用量会话自愈 & Step Code 登录渠道

安装包：**[CraftStation-Setup-1.5.18-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.18/CraftStation-Setup-1.5.18-x64.exe)**

便携版：**[CraftStation-Portable-1.5.18-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.18/CraftStation-Portable-1.5.18-x64.exe)**

## 用户可见

- OpenCode 不再卡在「已登录 / 暂无额度窗口」：旧版本会在 OAuth 登录流程中途把占位 cookie 封存成快照覆盖好值，且读路径没有任何修复手段。现在镜像写入前先做活性验证，占位/死值永不落盘；卡片读到死会话时自动从持久浏览器会话静默续期——无需再点任何按钮。
- 登录渠道列表新增 **Step Code**：「登录/授权」按钮直接跑原生 `step login` 终端流程（与 Harness 面板同一入口），凭证落到 `~/.stepcode/auth.json` 供 Harness 读取。

## 实现

- `UsageLoginCookieMirror.reseal`：候选 header 先过 `config.validateSession` 活性验证，验证不过不覆盖现有快照——杜绝登录流程中途的占位 cookie 污染快照。
- `useUsageProviderLogin`：快照 `auth-missing`（或浏览器会话类 provider 报 ok 但无窗）且存在已存会话时，自动调既有 `attemptUsageSilentLogin`（jar 收割→隐藏回放，主进程自带冷却），成功即刷新；渲染侧 60s 去重防重渲染风暴，失败不打扰 UI。
- `packages/agents-usage` 注册 `stepcode` local descriptor（login-only，无采集器）+ `CLI_LOGIN_COMMANDS["stepcode"]="step login"`。Step Plan 未公开 quota API，卡片仅报告登录身份。

## 验证

- 487 usage/provider 测试全过；`pnpm typecheck` 与 oxlint 零告警。
- Windows x64 双包由 Release workflow 全平台构建。

---

# CraftStation v1.5.18 — Self-healing usage sessions & a Step Code sign-in

Installer: **[CraftStation-Setup-1.5.18-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.18/CraftStation-Setup-1.5.18-x64.exe)**

Portable: **[CraftStation-Portable-1.5.18-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.18/CraftStation-Portable-1.5.18-x64.exe)**

## User-facing

- OpenCode no longer sticks on "signed in but no quota windows": a mid-OAuth placeholder cookie could overwrite the good snapshot with no read-path repair. Cookie mirroring now validates before sealing, and provider cards silently renew a dead stored session from the live browser session before ever asking you to sign in again.
- **Step Code** joins the sign-in channel list — its button runs the native `step login` terminal flow, the same entry the Harness panel offers, landing credentials in `~/.stepcode/auth.json`.

## Implementation

- `UsageLoginCookieMirror.reseal`: candidate headers pass `config.validateSession` liveness before resealing, so placeholders can never clobber a working snapshot.
- `useUsageProviderLogin`: when the snapshot reports `auth-missing` (or ok-but-windowless for browser-session providers) while a stored session exists, it auto-runs the existing silent renewal (jar harvest → hidden replay, debounced in main) and refreshes on success; a 60s renderer-side throttle prevents storms.
- `packages/agents-usage` registers a login-only `stepcode` descriptor + `CLI_LOGIN_COMMANDS["stepcode"]="step login"`. Step Plan exposes no quota API, so the card reports identity only.

## Verification

- 487 usage/provider tests pass; `pnpm typecheck` and oxlint clean.
- Windows x64 dual packages built by the Release workflow across all platforms.
