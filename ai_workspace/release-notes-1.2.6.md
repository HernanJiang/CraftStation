## 下载 / Download

请用本页 **Assets** 里的包，不要 clone 源码当安装包。

**[CraftStation-Portable-1.2.6-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.6/CraftStation-Portable-1.2.6-x64.exe)**（约 125 MB）

双击即可运行。包内已带：

- Electron / Chromium 运行时
- 原生模块 `better-sqlite3`、`node-pty`
- 外设 sidecar
- 官方 Windows **CLIProxyAPI** sidecar（`cli-proxy-api.exe`），跨厂商配方可直接起兼容桥

各家 Agent CLI（Codex、Kimi Code、Antigravity、Grok 等）仍使用你本机已安装的官方工具和订阅。

---

### 本版修复（#3 / #4）

- **首页四张卡变为真实入口**：合成台 / Harness、侧边栏、模型管理、配方管理，点击直接导航（不再只是聚焦输入框）
- **「合成台」一级入口统一显示为「合成台 / Harness」**（内部 tab id 不变）
- **修复"启动时模型很多、过几秒只剩三个"**：模型目录不再随账号信息加载完成而收缩；已安装但未登录的 CLI 保留在目录中并明确显示「未配置」，只有真实检测到未安装/停用时才消失
- **合成台 Harness / CLI 实时检测**：打开合成台与点击刷新都会触发真实的 agent 重新探测（含 Windows 注册表 PATH 刷新与可执行文件缓存失效），运行中新安装的 CLI 无需重启即可从「未安装」变为「未配置 / 就绪」
- **Harness / CLI 支持一键安装**（#4）：未安装行直接显示「安装」，走应用内已有的官方安装命令；安装中如实显示「安装中…」，成功后自动刷新状态，失败给出真实错误
- **修复右上角 CLI 更新菜单"一闪而过 / 点击无效"**（#3）：打开菜单不再同时强制刷新版本数据；单击更新条目立即且只执行一次更新，更新完成自动刷新状态与可更新列表

### 已知限制

- 各家 CLI 的真实安装仍依赖本机已有 curl/npm 等官方安装器；安装命令在应用内终端中执行，输出可在终端查看
- 尚未登录的渠道在选择器中显示「未配置」，登录后自动恢复

---

## English

**[CraftStation-Portable-1.2.6-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.6/CraftStation-Portable-1.2.6-x64.exe)** (~125 MB)

Double-click to run. The package already bundles:

- Electron / Chromium runtime
- Native modules `better-sqlite3`, `node-pty`
- The peripheral sidecar
- The official Windows **CLIProxyAPI** sidecar (`cli-proxy-api.exe`), so cross-vendor recipes can bring up a compatibility bridge directly

The agent CLIs (Codex, Kimi Code, Antigravity, Grok, etc.) still use the official tools and subscriptions already installed on your machine.

### Fixes in this release (#3 / #4)

- **The four home cards are now real entries**: Crafting / Harness, sidebar, model management, and recipe management navigate directly on click (no longer just focusing the input)
- **The top-level "Crafting" entry is uniformly shown as "Crafting / Harness"** (internal tab id unchanged)
- **Fixed "many models at startup, only three left seconds later"**: the model catalog no longer shrinks once account info finishes loading; installed-but-not-logged-in CLIs stay in the catalog and are clearly marked "unconfigured" — entries only disappear when genuinely detected as uninstalled/disabled
- **Real-time Harness / CLI detection on the crafting bench**: opening the bench and clicking refresh both trigger a real agent re-probe (including a Windows registry PATH refresh and executable-cache invalidation), so a CLI installed while the app is running flips from "not installed" to "unconfigured / ready" without a restart
- **One-click Harness / CLI install** (#4): uninstalled rows show an "Install" action wired to the app's official install commands; honest "installing…" progress, automatic status refresh on success, real error on failure
- **Fixed the top-right CLI update menu "flashing closed / clicks doing nothing"** (#3): opening the menu no longer force-refreshes version data; clicking an update entry fires exactly one update, and completion refreshes status and the updatable list

### Known limitations

- Real CLI installation still depends on official installers already on your machine (curl/npm etc.); install commands run in the in-app terminal where output is visible
- Channels not yet logged in show as "unconfigured" in the picker and recover automatically after login
