# CraftStation v1.5.16 — 用量凭证持久化与额度读数修复

安装包：**[CraftStation-Setup-1.5.16-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.16/CraftStation-Setup-1.5.16-x64.exe)**

便携版：**[CraftStation-Portable-1.5.16-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.16/CraftStation-Portable-1.5.16-x64.exe)**

## 用户可见

- OpenCode / Command Code 额度不再在每次更新或重启后要求重新登录：过期的会话 cookie 会从持久化浏览器会话静默续期，必要时再以隐藏窗口完成一轮静默重放，全部通过真实活性校验后才重封凭证；只有签发方会话本身也失效时才回到交互登录。
- Antigravity 账号额度不再在窗口恢复满额时「突然查不到」：云端对无用量记录窗口返回的合成满桶现在渲染为 0% 已用（不显示伪造的恢复时间），账号正在运行的 agy 会话在邮箱匹配时优先采用其官方语言服务器额度。

## 实现

- `UsageLoginManager.attemptSilentReauth`：存储快照存活直接复用 → 持久化 cookie jar 收割 → 隐藏窗口静默重放 `loginUrl`；30s 上限 + 60s 冷却；仅对具备真实活性探针的 opencode/commandcode 开启。
- `AntigravityProfileService.collectQuota` 改为 LS-first：扫描本机 agy 端点，`GetUserStatus` email 与账号匹配才采用其 `RetrieveUserQuotaSummary`，防止串号；cloudcode 合成桶渲染为 0% 无 reset。
- token 刷新现在持久化 Google 轮换返回的新 `refresh_token`。

## 验证

- usage-login 44 项 + antigravity collector/profiles 36+131 项测试全过；`pnpm typecheck` 与 oxlint 零告警；真实账号数据验证合成桶→0%、真实桶保留固定 reset。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。

---

# CraftStation v1.5.16 — Provider usage credentials that stay signed in

Installer: **[CraftStation-Setup-1.5.16-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.16/CraftStation-Setup-1.5.16-x64.exe)**

Portable: **[CraftStation-Portable-1.5.16-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.16/CraftStation-Portable-1.5.16-x64.exe)**

## User-facing

- OpenCode / Command Code quota no longer demand a fresh login after every update or restart — expired session cookies renew silently from the persistent browser session, with a hidden re-auth pass before the sign-in window ever appears; interactive login only returns when the issuer session itself is gone.
- Antigravity accounts no longer report "no quota record" the moment a Gemini or Claude window rolls back to full — nominal always-full buckets render as 0% used without the fabricated reset, and a running Antigravity session contributes its official language-server quota when its email matches the account.

## Implementation

- `UsageLoginManager.attemptSilentReauth`: live stored snapshot → harvest the persistent cookie jar → hidden-window re-auth replay, all candidates verified by real liveness probes; 30s budget + 60s cooldown; enabled only for providers with real probes.
- `AntigravityProfileService.collectQuota` is now LS-first — a running `agy` endpoint is adopted only when `GetUserStatus` email matches the account; cloudcode nominal buckets render at 0% without resets.
- Token refresh persists rotated `refresh_token` values returned by Google.

## Verification

- 44 usage-login tests + 167 antigravity collector/profile tests pass; `pnpm typecheck` and oxlint are clean; live-verified against real account data.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`.
