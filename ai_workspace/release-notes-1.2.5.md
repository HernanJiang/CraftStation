## 下载 / Download

请用本页 **Assets** 里的包，不要 clone 源码当安装包。

**[CraftStation-Portable-1.2.5-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.5/CraftStation-Portable-1.2.5-x64.exe)**（约 125 MB）

双击即可运行。包内已带：

- Electron / Chromium 运行时
- 原生模块 `better-sqlite3`、`node-pty`
- 外设 sidecar
- 官方 Windows **CLIProxyAPI** sidecar（`cli-proxy-api.exe`），跨厂商配方可直接起兼容桥

各家 Agent CLI（Codex、Kimi Code、Antigravity、Grok 等）仍使用你本机已安装的官方工具和订阅。

---

### 本版修复

- CLIProxyAPI 不再把 macOS Mach-O 当成 Windows 程序（`spawn UNKNOWN`）
- 安装器按 `windows_amd64` 选型并校验 PE 头，下载走 `HTTP(S)_PROXY`

### 已知限制

- 合成台部分跨厂商配方保存 / Gemini→Codex 模型目录仍有问题，见 Issues #1 #2

签名：HernanJIANG · Apache 2.0

---

## English

**[CraftStation-Portable-1.2.5-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.5/CraftStation-Portable-1.2.5-x64.exe)** (~125 MB)

Double-click to run. The package already bundles:

- Electron / Chromium runtime
- Native modules `better-sqlite3`, `node-pty`
- The peripheral sidecar
- The official Windows **CLIProxyAPI** sidecar (`cli-proxy-api.exe`), so cross-vendor recipes can bring up a compatibility bridge directly

The agent CLIs (Codex, Kimi Code, Antigravity, Grok, etc.) still use the official tools and subscriptions already installed on your machine.

### Fixes in this release

- CLIProxyAPI no longer mistakes a macOS Mach-O for a Windows binary (`spawn UNKNOWN`)
- The installer selects the `windows_amd64` asset, verifies the PE header, and honors `HTTP(S)_PROXY` for downloads

### Known limitations

- Some cross-vendor recipe saves and the Gemini→Codex model catalog still have issues — see Issues #1 #2

Signed: HernanJIANG · Apache 2.0
