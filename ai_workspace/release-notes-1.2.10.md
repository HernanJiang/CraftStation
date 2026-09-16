## 下载 / Download

请用本页 **Assets** 里的安装包，不要 clone 源码当安装包。

**[CraftStation-Portable-1.2.10-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.10/CraftStation-Portable-1.2.10-x64.exe)**

双击即可运行。用户数据在 `C:\Users\<你>\.craftstation\`，不在 exe 旁边。

---

## 中文

### 本版修复

- **Devin 登录终端打不开**：当设置或探测到的 `C:\Program Files\PowerShell\7\pwsh.exe` 实际无法启动时，会自动回退到 Windows PowerShell 5.1，再不行则用 `cmd.exe`，不再弹出 `craftstation:start-shell` 失败 toast。

---

## English

### Fixes

- **Devin login shell**: If the configured PowerShell 7 path cannot be spawned, CraftStation falls back to Windows PowerShell 5.1 and then `cmd.exe`, instead of failing `craftstation:start-shell`.
