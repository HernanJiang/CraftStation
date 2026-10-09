# CraftStation v1.8.9

小窗口和较高界面缩放下，合成台与顶部操作保持可用。

## 用户可见

- 修复合成台原料栏覆盖结果和配方的问题。面板按实际可用宽度重排，小屏通过滚动访问全部面板。
- 修复顶部拉取请求、计划、工作、用量等操作重叠。空间不足时先显示图标，更窄时收进导航菜单；快捷项收起保持稳定，原生窗口按钮保留正确空间。

## 实现

- 合成台使用容器断点、可收缩列和内容高度滚动布局；格子随容器调整尺寸。
- 标题栏约束 Tooltip 包装层尺寸，快捷项使用不随收起卸载的测量行；窗口按钮留位抵消界面缩放，图标按钮保留可访问名称。

## 验证

- 30 项相关单元测试、16 项 changelog 测试、类型检查、普通及类型感知 lint 通过。
- 隔离 Electron 在小、中、大窗口及 100%、130%、150% 缩放下检查面板重叠、横向越界、滚动可达及窄屏菜单实际点击。
- 相关界面冒烟及 1 个 mock 门禁通过；预览关闭的 81 个原生命中点与 27 次鼠标点击、聊天面板的 5 组布局检查通过，控制台与运行时错误为 0。未进行外部 Provider 或 1.9 新能力的在线验收。

---

# CraftStation v1.8.9

Crafting panels and titlebar actions remain accessible in small windows and at higher interface zoom.

## User-facing

- Fix ingredients overlapping results and recipes in the crafting workspace. Panels reflow within the available width, with scrolling to keep every panel reachable on small screens.
- Fix overlapping Pull requests, Plan, Work and Usage actions. Labels collapse to icons and then a navigation menu as space shrinks; pinned shortcuts remain stable in overflow, and native window controls retain their reserved space.

## Implementation

- Crafting uses container breakpoints, shrinkable columns and content-height scrolling. Grid cells resize with their container.
- Titlebar tooltip wrappers retain their control widths, while pinned shortcuts use a measurement row that stays mounted in overflow. Window-control spacing compensates for interface zoom, and icon buttons retain accessible names.

## Verification

- 30 relevant unit tests, 16 changelog tests, type checking, regular lint and type-aware lint pass.
- Isolated Electron checks cover small, medium and large windows at 100%, 130% and 150% interface zoom, checking overlap, horizontal bounds, scroll reachability and an actual compact-menu click.
- Relevant UI smoke checks and one mock gate pass, including 81 native hit-test points and 27 mouse clicks for preview closing, plus five collaboration-layout cases. Console and runtime errors are zero. External providers and the new 1.9 capabilities have not undergone live acceptance.
