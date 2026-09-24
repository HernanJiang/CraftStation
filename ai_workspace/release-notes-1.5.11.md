# CraftStation v1.5.11 — 每个线程留着自己的文件，Markdown 公式能排版

安装包：**[CraftStation-Setup-1.5.11-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.11/CraftStation-Setup-1.5.11-x64.exe)**

便携版：**[CraftStation-Portable-1.5.11-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.11/CraftStation-Portable-1.5.11-x64.exe)**

## 用户可见

- 右侧打开的文件、文件列表指向的项目，以及目录是展开还是收起，都跟着当前线程走。换一条对话，不会再看见上一条里打开的 PDF。
- 藏起目录只影响这一条线程。离开再回来仍然保持隐藏，别的线程不受影响。
- Markdown 预览会把独立公式排成版，不再把 `$$` 和 `\frac` 当普通文字显示。表头里的行内公式不会把分数格子挤乱。

## 实现

- 右侧栏在焦点真正落到某条线程时收起上一份、恢复这一份，取消掉的切换不会把侧栏提前换走。
- 文件标签、缓冲区和文件面板的项目范围按线程暂存。目录折叠写在按线程分开的本地记录里，旧的全局开关只归到当时打开的那条线程。
- 预览使用和对话相同的 KaTeX。单独一行的 `$$ ... $$`，以及公式贴在开头 `$$` 后面的写法，会先整理成独立公式再排版。

## 验证

- 线程侧栏绑定、文件目录折叠和 Markdown 公式预览的对应测试已通过。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。

---

# CraftStation v1.5.11 — Each thread keeps its files, formulas render

Installer: **[CraftStation-Setup-1.5.11-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.11/CraftStation-Setup-1.5.11-x64.exe)**

Portable: **[CraftStation-Portable-1.5.11-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.11/CraftStation-Portable-1.5.11-x64.exe)**

## User-facing

- Open files, the project the file list points at, and whether the directory is hidden now stay with the current thread. Switching conversations no longer shows the PDF you opened next door.
- Hiding the directory affects only that thread. It stays hidden when you leave and come back, and other threads are left alone.
- Markdown preview typesets display formulas instead of leaving `$$` and `\frac` as plain text. Inline math in a table header no longer shoves the score cells out of place.

## Implementation

- The right sidebar parks the previous thread and restores the next one only when focus actually lands. A cancelled switch no longer moves the sidebar early.
- File tabs, buffers, and the files panel's project scope are kept per thread. Directory collapse is stored per thread; the old global flag is claimed only by the thread that was open.
- Preview uses the same KaTeX path as chat. A one-line `$$ ... $$`, and a formula stuck on the opening `$$` line, is rewritten into a display block before typesetting.

## Verification

- The thread-sidebar, directory-collapse, and Markdown formula preview tests passed.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`.
