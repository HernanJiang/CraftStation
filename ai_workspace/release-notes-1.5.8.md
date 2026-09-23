# CraftStation v1.5.8 — 更新不再停在 0%

安装包：**[CraftStation-Setup-1.5.8-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.8/CraftStation-Setup-1.5.8-x64.exe)**

便携版：**[CraftStation-Portable-1.5.8-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.8/CraftStation-Portable-1.5.8-x64.exe)**

## 用户可见

- 检查更新比较慢时，顶栏不再停在「正在下载… 0%」却什么都没在下。发现新版本后仍会开始下载。
- 进度停在 0% 且还没有字节数时，这个按钮可以点，会打开发布页用浏览器下载，不再点了没反应。

## 实现

- 检查的 8 秒上限不再把已经发现的更新丢掉。迟到的「有新版本」仍会调用下载。
- 关闭 GitHub 差分下载。差分请求会停在 0% 且不报进度，改为整包下载。
- 下载中的顶栏按钮不再禁用。没有字节进度时文案带上「改为在浏览器中下载」。

## 验证

- 更新器和顶栏对应测试已通过。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。

---

# CraftStation v1.5.8 — Update downloads no longer sit at 0%

Installer: **[CraftStation-Setup-1.5.8-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.8/CraftStation-Setup-1.5.8-x64.exe)**

Portable: **[CraftStation-Portable-1.5.8-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.8/CraftStation-Portable-1.5.8-x64.exe)**

## User-facing

- A slow update check no longer leaves the titlebar on Downloading… 0% with nothing actually downloading. Once a newer version is found, the download still starts.
- While progress is 0% and no bytes have arrived, that pill can be clicked. It opens the release page so you can download in the browser, instead of ignoring the click.

## Implementation

- The 8-second check deadline no longer drops an update that was already found. A late "update available" still starts the download.
- Differential downloads against GitHub are off. Those range requests could sit at 0% without reporting bytes, so the app downloads the full installer.
- The titlebar pill stays enabled during a download. With no byte progress yet, its label includes the browser-download action.

## Verification

- The updater and titlebar tests passed.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`.
