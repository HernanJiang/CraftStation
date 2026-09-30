# CraftStation v1.5.20 — 凭证持久化与完成通知修复

安装包：**[CraftStation-Setup-1.5.20-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.20/CraftStation-Setup-1.5.20-x64.exe)**

便携版：**[CraftStation-Portable-1.5.20-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.20/CraftStation-Portable-1.5.20-x64.exe)**

## 用户可见

- **任务完成通知卡自动消失**：一直停留在已完成线程时，Workspace 收件箱的完成卡片现在会立即消失，不再需要切换到其他线程再切回来。
- **Antigravity 登录态不再丢失**：修复了重启后 Antigravity 显示「未登录」的问题——账号池里的凭证现在会被正确识别，额度卡片重启后照常显示。
- **Step Code 登录态持久化**：`step login` 的登录凭证（`~/.stepcode/auth.json`）现在被登录态判断和用量面板直接识别，重启后不再要求重新登录。
- **Step Code 出现在渠道与用量**：登录 Step Code 后，「模型与用量」左侧渠道列表显示已授权的 Step Code 渠道并可管理其模型；用量卡片显示登录身份（套餐名 + 脱敏账号 ID）。Step Plan 暂未开放额度查询接口，卡片如实展示身份而不伪造额度数字。
- **退登更干净**：在「模型与用量」里移除 Step Code 授权时，会同时清掉本地 CLI 凭证文件中的 `step` 项，不会在下次刷新时复活。

## 实现

- `threadSlice`：可见线程收到 runtime 直接推送的 `finished` 状态时降级为 `idle`（与远程快照同步同一规则）；不可见线程仍保留未读完成徽章。
- `usageSecretStore` 新增 `listUsageSecretAccountBuckets`；Antigravity 的 `importHostLogin` 会把默认桶搬入 `antigravity:<accountId>` 池行，`resolveAnyStoredAntigravityToken` 在默认桶缺失时按序兜底池桶，`token.raw.bucket` 记录来源桶，refresh 路由回实际桶。
- 新增 `src/shared/stepcodePaths.ts`：`~/.stepcode` 配置根目录与 auth 候选路径的单一事实来源，supervisor detection 与 main 进程登录态共用；`getLoginState`/`clearLogin` 纳入 Step Code auth 文件探测与清除。
- 新增 `stepcodeUsageScanner`（supervisor-local collector）：读 `auth.json` 报 `status:"ok"` + 套餐名 + 脱敏 uid，`windows:[]`（Step Plan 无公开额度 API）；`STEP_API_KEY` 也认作登录态。
- CI：`Release (stable)` workflow 新增 `platforms` 输入——补丁版本默认只构建 Windows，次版本（`X.Y.0`）自动构建三端，可显式覆盖。

## 验证

- 相关测试 154 个全过（新增：可见/不可见线程直收 `finished`、池桶枚举/兜底/refresh 路由、登录态 auth.json 探测、桶枚举）；全量套件中顺带修复 5 个陈旧断言；`pnpm typecheck` 与 oxlint 零告警。

---

# CraftStation v1.5.20 — Credential persistence & completion-notice fixes

Installer: **[CraftStation-Setup-1.5.20-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.20/CraftStation-Setup-1.5.20-x64.exe)**

Portable: **[CraftStation-Portable-1.5.20-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.20/CraftStation-Portable-1.5.20-x64.exe)**

## User-facing

- **Completion cards now dismiss themselves**: the Workspace inbox completion card on a thread you're already watching clears immediately — no more switching away and back.
- **Antigravity stays signed in**: fixed the "signed out after restart" symptom — credentials parked in account-pool buckets are now recognized, so the quota card survives restarts.
- **Step Code sign-in persists**: the `step login` credential (`~/.stepcode/auth.json`) is now read directly by login state and the usage panel — no more re-login prompts after restart.
- **Step Code in channels & usage**: once signed in, Step Code appears as an authorized channel whose models you can manage; the usage card shows your identity (plan name + masked account id). Step Plan exposes no public quota API, so the card honestly shows identity rather than fabricated meters.
- **Cleaner sign-out**: removing the Step Code authorization also strips the `step` entry from the local CLI credential files, so it cannot resurrect on the next refresh.

## Implementation

- `threadSlice`: inbound `finished` on a visible thread demotes to `idle` (same rule as remote snapshot sync); non-visible threads keep the unread badge.
- `usageSecretStore` gains `listUsageSecretAccountBuckets`; Antigravity's `importHostLogin` drains the plain bucket into `antigravity:<accountId>` pool rows — `resolveAnyStoredAntigravityToken` falls back to pool buckets, stamps `token.raw.bucket`, and refresh routes back to that bucket.
- New `src/shared/stepcodePaths.ts`: single source for the `~/.stepcode` config root and auth candidates, shared by supervisor detection and the main process; `getLoginState`/`clearLogin` now probe and clear the Step Code auth files.
- New `stepcodeUsageScanner` (supervisor-local collector): reads `auth.json`, reports `status:"ok"` + plan + masked uid with `windows:[]` (no public quota API); `STEP_API_KEY` counts as signed in.
- CI: `Release (stable)` gains a `platforms` input — patch versions build Windows only by default, minor versions (`X.Y.0`) build all three, with an explicit override.

## Verification

- 154 targeted tests pass (new: visible/non-visible `finished`, pool-bucket enumeration/fallback/refresh routing, login-state auth probing, bucket listing); 5 stale assertions fixed along the way; `pnpm typecheck` and oxlint clean.
