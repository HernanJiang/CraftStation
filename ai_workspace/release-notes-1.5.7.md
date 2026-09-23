# CraftStation v1.5.7 — 顶栏铺到版本号，状态胶囊一次展开

安装包：**[CraftStation-Setup-1.5.7-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.7/CraftStation-Setup-1.5.7-x64.exe)**

便携版：**[CraftStation-Portable-1.5.7-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.7/CraftStation-Portable-1.5.7-x64.exe)**

## 用户可见

- 顶栏快捷入口一直排到版本号左边。更新角标和窗口按钮仍留在最右侧，不再在窗口中间截断。
- 右上角状态胶囊点一次就打开完整 Git 面板，直接看到更改、分支和提交或推送，不用再点一次才展开。
- 右侧文件列表藏起来之后，离开线程再回来仍然保持隐藏。

## 实现

- 标题栏中间的拖拽空白不再和快捷入口对半平分宽度。快捷区占满版本号左侧，版本号和更新角标单独成组。
- 状态面板每次从关闭变为打开时，先展开正文再绘制，避免停在只有标题的半开状态。
- 文件树的隐藏状态写入本地存储，面板卸载后再挂上时读回，不再每次回到线程都展开。

## 验证

- 标题栏、状态胶囊和文件列表隐藏的对应测试已通过。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。

---

# CraftStation v1.5.7 — Titlebar shortcuts reach the version, status opens in one click

Installer: **[CraftStation-Setup-1.5.7-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.7/CraftStation-Setup-1.5.7-x64.exe)**

Portable: **[CraftStation-Portable-1.5.7-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.7/CraftStation-Portable-1.5.7-x64.exe)**

## User-facing

- Pinned titlebar shortcuts now run across to the version number. The update badge and window buttons stay on the right, and the row is no longer cut off halfway.
- One click on the project status capsule opens the full Git panel, with changes, branch, and commit or push, instead of stopping on the title row.
- Hiding the file list in the right sidebar stays hidden after you leave the thread and come back.

## Implementation

- The titlebar drag gap no longer splits the remaining width with the shortcuts. The shortcut row fills the space to the left of the version, and the version plus update badge stay their own group.
- When the status panel opens, its body is expanded before paint, so it does not stop on the title-only state.
- The file tree's hidden state is stored locally and restored when the panel mounts again, so returning to a thread does not show it.

## Verification

- The titlebar, status-capsule, and hidden file-list tests passed.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`.
