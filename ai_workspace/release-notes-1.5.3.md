# CraftStation v1.5.3 — 任务会自己结束，用量图标进统计页

安装版：**[CraftStation-Setup-1.5.3-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.3/CraftStation-Setup-1.5.3-x64.exe)**（国内：[Gitee](https://gitee.com/HernanJiang/CraftStation/releases/download/v1.5.3/CraftStation-Setup-1.5.3-x64.exe)）

便携版：**[CraftStation-Portable-1.5.3-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.3/CraftStation-Portable-1.5.3-x64.exe)**（国内：[Gitee](https://gitee.com/HernanJiang/CraftStation/releases/download/v1.5.3/CraftStation-Portable-1.5.3-x64.exe)）

## 用户可见

- 任务已经写完、子 Agent 也结束了，线程不再一直停在「工作中」并占着停止按钮。中途插入 Prompt，或 Codex、Claude 以及其他结构化 Agent 拉起子 Agent，都走同一条收口。
- 定时任务即使跑在没有 Schedule MCP 的 harness 上，也可以自己停。回复的最后一个非空行写成 `CRAFTSTATION_SCHEDULE: pause` 会暂停后续触发，写成 `CRAFTSTATION_SCHEDULE: delete` 会删除这条计划。
- 左侧缩略栏不再重复标题栏上的用量、设置和同类快捷按钮。用量和设置留在标题栏。点击任意用量图标都会打开「用量统计」。
- 网站下载按地区分流：中国大陆走 Gitee，其他地区走 GitHub。Windows 同时提供安装包和便携版。应用内自动更新仍使用 GitHub 上的 `latest.yml`。

## 实现

- Codex 在 `turn/steer` 换成新回合编号时丢掉旧编号；可见回合结束后若服务器已没有进行中的回合，会再读一次线程状态并回到空闲。
- ACP 在用户打断或插入 Prompt 时，不再为了等子 Agent 汇报而把线程停在工作中。Claude 被打断时立刻结束本轮，不等后台任务通知。
- 子 Agent 自己的进度不再把已经空闲的父线程重新打成工作中。
- 每次计划触发都会附上自停说明。宿主只认回复的最后一行，说明文字本身不会误停。
- 缩略栏去掉与标题栏重复的用量圆环、快捷方式和设置。标题栏「用量」、钉住的用量入口、渠道用量圆环和输入框旁的额度圆环都打开用量统计页。
- 网站 `/api/download/*` 根据 `x-vercel-ip-country` / `cf-ipcountry` 把安装包和便携版转到对应仓库。便携版的手动下载页在中国时区打开 Gitee。

## 验证

- 回合收口、计划自停、标题栏用量按钮和 changelog 版本唯一性已用对应测试核对。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。产物上传 GitHub Release 与 Gitee Release。

---

# CraftStation v1.5.3 — Turns settle, and usage icons open statistics

Installer: **[CraftStation-Setup-1.5.3-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.3/CraftStation-Setup-1.5.3-x64.exe)** (China: [Gitee](https://gitee.com/HernanJiang/CraftStation/releases/download/v1.5.3/CraftStation-Setup-1.5.3-x64.exe))

Portable: **[CraftStation-Portable-1.5.3-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.3/CraftStation-Portable-1.5.3-x64.exe)** (China: [Gitee](https://gitee.com/HernanJiang/CraftStation/releases/download/v1.5.3/CraftStation-Portable-1.5.3-x64.exe))

## User-facing

- A finished task no longer stays on Working with the Stop button after the reply and its sub-agents are done. Mid-turn prompts and sub-agents on Codex, Claude, and other structured agents all settle the same way.
- A scheduled run can stop itself even when that harness has no Schedule MCP. The last non-empty line `CRAFTSTATION_SCHEDULE: pause` disables future runs; `CRAFTSTATION_SCHEDULE: delete` removes the schedule.
- The collapsed sidebar no longer repeats the title bar's usage, settings, and matching shortcuts. Usage and Settings stay on the title bar. Every usage icon opens Usage statistics.
- Website downloads are split by region: mainland China uses Gitee, everywhere else uses GitHub. Windows ships both an installer and a portable build. In-app auto-update still uses the GitHub `latest.yml` feed.

## Implementation

- Codex drops the previous turn id when `turn/steer` accepts a replacement, and reads the thread again after the visible turn completes if no turn is still in progress.
- An ACP interrupt or mid-turn prompt no longer waits forever on sub-agent reports. An interrupted Claude turn ends immediately instead of waiting for a background task notification.
- Sub-agent progress no longer reopens a parent thread that has already gone idle.
- Every schedule fire appends the self-stop instructions. The host honors only the last line of the reply, so the instructions themselves do not stop the schedule.
- The collapsed rail drops the usage rings, shortcuts, and Settings button that duplicated the title bar. The title bar Usage button, a pinned Usage shortcut, provider usage rings, and the composer quota ring all open Usage statistics.
- `/api/download/*` sends the installer and portable build to Gitee or GitHub from `x-vercel-ip-country` / `cf-ipcountry`. The portable manual download page opens Gitee in China time zones.

## Verification

- Turn settlement, schedule self-stop, the title bar Usage button, and changelog version uniqueness were checked with their tests.
- Windows x64 dual build: `pnpm dist:win` and `pnpm dist:win:portable`. Artifacts are uploaded to the GitHub Release and the Gitee Release.
