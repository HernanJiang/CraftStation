# CraftStation v1.5.4 — 目录可收起，侧栏不再每次重载

安装版：**[CraftStation-Setup-1.5.4-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.4/CraftStation-Setup-1.5.4-x64.exe)**

便携版：**[CraftStation-Portable-1.5.4-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.4/CraftStation-Portable-1.5.4-x64.exe)**

## 用户可见

- 文件预览旁边的项目目录可以单独收起。收起后右上角有一个小的「恢复目录」，只把右侧目录展开回来，正在看的文件保持打开。
- 目录标题上不再放新建文件、新建文件夹、全部折叠和刷新。这些动作仍在右键菜单里。
- 在目录里右键文件或文件夹会打开菜单，不再把预览跳一下然后没有任何反应。
- 切换线程或右侧标签时，已经打开的浏览器页面和最近用过的项目目录会留着，不用每次重新加载。
- Grok、Claude 以及其他结构化 Agent 在可见回复结束后会离开「工作中」，即使后台子 Agent 还开着，或一直不回报。

## 实现

- 目录菜单挂在目录栏上，不再挂在虚拟列表的某一行里。右键不再把焦点打进那一行，避免列表滚动后行被卸掉、菜单一起消失。
- 浏览器面板在仍打开且有标签时，切走后改为离屏挂着，不销毁 webview。项目树记住最近打开的几个根目录，切回来先显示缓存再静默刷新。
- ACP 会话在前台回复结束时回到空闲，不等待已分离的子 Agent。安静且没有前台内容的回合会在超时后收口。Claude 在主结果已经返回、后台任务通知却一直不来时，最多再等一会儿就结束本轮。

## 验证

- 目录收起与恢复、目录右键菜单、浏览器离屏保留，以及 ACP / Claude 回合收口，已用对应测试核对。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。产物发布到 GitHub Release。

---

# CraftStation v1.5.4 — Directories collapse, side panels stay open

Installer: **[CraftStation-Setup-1.5.4-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.4/CraftStation-Setup-1.5.4-x64.exe)**

Portable: **[CraftStation-Portable-1.5.4-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.4/CraftStation-Portable-1.5.4-x64.exe)**

## User-facing

- The project directory beside a file preview can be collapsed on its own. A small restore chip brings only that column back, and the file you are reading stays open.
- The directory header no longer shows New file, New folder, Collapse all, and Refresh. Those actions stay on the right-click menu.
- Right-clicking a file or folder in the directory opens its menu, instead of jumping the preview and then doing nothing.
- Switching threads or right-panel tabs keeps an open browser page and a recently used project tree, instead of reloading them every time.
- Grok, Claude, and the other structured agents leave Working when the visible reply is finished, even if a background sub-agent is still open or never reports back.

## Implementation

- The directory menu is owned by the directory column, not by a virtualized row. A right-click no longer focuses that row, so the list does not scroll the row away and take the menu with it.
- While the browser panel stays open and has tabs, leaving its tab keeps the webview mounted off-screen. The project tree remembers the last few roots and shows the cached tree immediately, then refreshes quietly.
- An ACP session goes idle when the foreground reply ends, without waiting on a detached sub-agent. A quiet turn with no foreground content settles after a timeout. After Claude's main result, a missing background-task notification can no longer hold the turn open indefinitely.

## Verification

- Directory collapse and restore, the directory context menu, the off-screen browser, and ACP / Claude turn settlement were checked with their tests.
- Windows x64 dual build: `pnpm dist:win` and `pnpm dist:win:portable`. Artifacts are published to the GitHub Release.
