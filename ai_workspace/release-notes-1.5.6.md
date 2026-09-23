# CraftStation v1.5.6 — 官网模型目录，以及可核销的 ChatGPT 重置卡

安装包：**[CraftStation-Setup-1.5.6-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.6/CraftStation-Setup-1.5.6-x64.exe)**

便携版：**[CraftStation-Portable-1.5.6-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.6/CraftStation-Portable-1.5.6-x64.exe)**

## 用户可见

- 渠道页点「获取模型」时，Codex 会用已登录账号去官网模型目录。本机 CLI 还只列着 5.6 Sol / 5.6 Luna 时，GPT-6 Sol 和 GPT-6 Luna 也会出现。
- ChatGPT 账号如果还有未核销的重置卡，额度行会写明张数，并可以在这里核销。核销后周额度会重新拉取。

## 实现

- Codex 能力探测在本机 `model/list` 之外，再请求 `https://chatgpt.com/backend-api/codex/models`。主机登录被拒时，改用账号池里的凭证。官网多出来、且当前 CLI 版本够得着的模型并入列表。
- `/wham/usage` 里的未核销重置卡单独显示，不当成已用百分比。核销走 `rate-limit-reset-credits/consume`，成功后再采集额度。

## 验证

- 目录合并、登录被拒后换下一张凭证、重置卡窗口解析和额度卡片按钮，已用对应测试核对。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。

---

# CraftStation v1.5.6 — Official model catalog, and a ChatGPT reset you can spend

Installer: **[CraftStation-Setup-1.5.6-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.6/CraftStation-Setup-1.5.6-x64.exe)**

Portable: **[CraftStation-Portable-1.5.6-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.6/CraftStation-Portable-1.5.6-x64.exe)**

## User-facing

- Fetch models for Codex now reads the official ChatGPT catalog with a signed-in account. GPT-6 Sol and GPT-6 Luna show up even when the installed CLI still lists only the 5.6 names.
- A ChatGPT account with an unused reset card shows the count on the quota row, and you can spend that card there. The weekly meter refreshes after it is redeemed.

## Implementation

- Codex capability probes request `https://chatgpt.com/backend-api/codex/models` in addition to the local `model/list`. If the host login is rejected, a pool account is used instead. Catalog models the CLI omitted, and that this CLI is new enough to run, are merged in.
- Unused reset cards from `/wham/usage` render on their own and are not treated as a used-percent bar. Redeeming calls `rate-limit-reset-credits/consume`, then collects quota again.

## Verification

- Catalog merge, falling through a rejected login, reset-card parsing, and the quota-card button were checked with their tests.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`.
