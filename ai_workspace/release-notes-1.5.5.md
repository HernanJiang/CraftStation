# CraftStation v1.5.5 — 思考收起，Devin 不再自己停，菜单对准点击处

安装包：**[CraftStation-Setup-1.5.5-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.5/CraftStation-Setup-1.5.5-x64.exe)**

便携版：**[CraftStation-Portable-1.5.5-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.5/CraftStation-Portable-1.5.5-x64.exe)**

## 用户可见

- 连续的思考和搜索、查看收进同一组。收起后是次数，不再一条条摊开；点开才能读每一条。
- 同一工作区目录里的线程可以互相看见、互相发消息，不再只有同项目里的 Codex。Devin 也在其中。
- Devin 的 SWE-2 在安静间隙，或自己返回 cancelled 而你没有按停止时，不再把还在跑的命令掐掉。
- 界面缩放不是 100% 时，右键菜单和溢出菜单停在你点的那一行，不再偏到别处。

## 实现

- 带正文的思考进入工具组，和搜索、查看共用折叠标题。组里一旦有思考，默认收起，直到你打开。
- 对等体名单按工作区路径匹配，不再只认同一个项目 id，也不再把 Harness 限制成一份固定名单。
- Devin 开会话时标记为自主长回合：prompt 还开着时不因静默收成空闲；未经请求的 cancelled 留在同一轮，等工具和最终回复安静后再按完成收口。
- 共用的上下文菜单在缩放不是 1 时，锚点和弹出层按缩放倒数对齐，文字大小保持不变。

## 验证

- 思考分组、工具组收起、Devin 自主回合、上下文菜单缩放补偿，已用对应测试核对。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。产物发布到 GitHub Release。

---

# CraftStation v1.5.5 — Folded thoughts, steadier Devin turns, menus that stay put

Installer: **[CraftStation-Setup-1.5.5-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.5/CraftStation-Setup-1.5.5-x64.exe)**

Portable: **[CraftStation-Portable-1.5.5-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.5/CraftStation-Portable-1.5.5-x64.exe)**

## User-facing

- Consecutive thoughts fold into the same group as searches and views. The collapsed header is a count, not a stack of open rows. Open the group to read each thought.
- Threads that share a workspace path can see and message each other across harnesses, including Devin, instead of only Codex threads in the same project.
- Devin SWE-2 no longer cancels a live command during a quiet gap, or when the prompt returns cancelled without you pressing Stop.
- When CraftStation's zoom is not 100%, right-click and overflow menus stay on the row you clicked.

## Implementation

- Text-bearing thoughts join tool groups and share the collapsed summary with searches and views. A group that contains a thought stays collapsed until you open it.
- The peer roster matches workspace paths, not only one project id, and no longer limits harnesses to a fixed list.
- Devin sessions are marked as one long autonomous prompt: a quiet gap does not idle the thread while the prompt is open, and an unsolicited cancelled stop stays on the same turn until tools and the final reply go quiet.
- Shared context menus counter-scale the anchor and the popover when zoom is not 1, so the text size stays the same and the menu lands on the click.

## Verification

- Thought grouping, collapsed tool groups, Devin's autonomous turn, and context-menu zoom compensation were checked with their tests.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`. Artifacts are published to the GitHub Release.
