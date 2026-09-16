## 下载 / Download

请用本页 **Assets** 里的安装包，不要 clone 源码当安装包。

**[CraftStation-Portable-1.2.11-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.11/CraftStation-Portable-1.2.11-x64.exe)**

双击即可运行。用户数据在 `C:\Users\<你>\.craftstation\`，不在 exe 旁边。

---

## 中文

### 本版修复

- **Devin 打不开会话**：ACP `session/new` 会向 `server.codeium.com` 刷新团队设置，默认走 Windows WinHTTP（直连），10 秒超时后以 `Failed to load team settings` 失败。现在会把本机 HTTP 代理写入 Devin 用户配置（`proxy.mode=manual`），并在这次超时上自动重试 `session/new`。

---

## English

### Fixes

- **Devin session open**: ACP `session/new` fail-closed when Devin's 10s `GetCliTeamSettings` fetch timed out (Windows WinHTTP is often direct even when Clash/V2Ray set `HTTP_PROXY`). CraftStation now pins Devin's user proxy to the host HTTP proxy and retries `session/new` on that timeout.
