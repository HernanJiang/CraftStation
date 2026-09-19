## 下载 / Download

请用本页 **Assets** 里的包，不要 clone 源码当安装包。

安装版：**[CraftStation-Setup-1.2.15-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.15/CraftStation-Setup-1.2.15-x64.exe)**

便携版：**[CraftStation-Portable-1.2.15-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.15/CraftStation-Portable-1.2.15-x64.exe)**（双击即运行，用户数据在 `C:\Users\<你>\.craftstation\`）

旧目录覆盖安装后自动打开即完成更新；应用内右上角更新菜单也会发现本版本并支持一键下载/重启安装。

---

## 中文

### 本版修复

- **更新菜单点检查无反应**：三种静默路径——main 侧去重/慢查无回执、下载停滞、本地菜单无进度行。现 beginCheck 入口即发 checking（含去重命中）；菜单在 main 未回执前显示本地进度行；下载 120 秒无字节即判可见错误并释放门闩（迟到完成仍可落地）。

---

## English

### Fixes in this release

- **"Check for updates" in the update menu did nothing**: three silent paths — a deduplicated/slow check in main returning no receipt, a stalled download, and no local progress row in the menu. Now beginCheck emits `checking` right at the entry (including on dedup hits); the menu shows a local progress row until main reports back; and a download with zero bytes for 120 seconds is declared a visible error and releases the latch (a late completion still lands).
