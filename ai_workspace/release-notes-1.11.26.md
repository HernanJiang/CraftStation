# CraftStation 1.11.26

## 用户可见

- 新增「极简」主题分组，共 6 套，每套都包含夜间与日间两版，随外观设置的明暗模式自动切换：
  - Onyx（曜石）：纯黑 / 纯白，单色强调，对比最强。
  - Graphite（石墨）：柔和的中性灰黑 / 纸白，单色强调。
  - Ash（烟灰）：偏暗的炭灰 / 柔灰白，两种模式下都最不刺眼。
  - Slate（冷岩）：带一点蓝的冷灰 / 雾白，钢蓝强调。
  - Linen（亚麻）：暖炭灰 / 亚麻白，砂色强调。
  - Sage（鼠尾草）：带一点绿的灰黑 / 青瓷白，灰绿强调。
- 主题列表按「CraftStation / 极简 / 编辑器主题」分组显示。
- 浮层细节统一：下拉框不再显示成胶囊形，菜单、下拉框、弹窗与文件提及面板使用同一圆角，并以细描边加柔和阴影区分层次；侧栏「新建」和通知菜单不再混用直角与圆角。
- 弹窗遮罩更轻，并带轻微模糊；提示气泡改为中性深色，边缘和阴影更细。
- 修复 Esc 键事件直接派发到页面根节点时导致界面崩溃的问题。

## 实现

- `ThemeSpec` 新增可选 `overlay`，极简日间主题让菜单与弹窗保持和页面同样明亮；主题新增 `group` 字段，设置页按分组渲染。新分组标题已补齐 13 种语言。
- 浮层统一为 0.875rem 圆角、内部条目 0.5rem 圆角；`--overlay-shadow` 按明暗模式分别定义为发丝描边 + 贴近阴影 + 柔和远阴影；`--backdrop` 调轻，不透明遮罩加 3px 模糊，系统要求减少透明度时关闭模糊。
- `overlayEscapeStack` 只对 Element 目标调用 `closest`。

## 验证

- 6 套新主题通过现有的对比度测试（正文、次要文字、强调色、状态色与按钮填充）。主题、设置页、侧栏与 Esc 相关 55 个文件 499 项测试，changelog 16 项，`pnpm typecheck`、`pnpm lint`、格式检查通过。新增的 Esc 回归测试修复前失败、修复后通过。
- 隔离真实 Electron 中检查了主题分组、Onyx 日间 / 夜间、Graphite 夜间的设置页、下拉框、「新建」菜单与弹窗：下拉框圆角 14px，遮罩为 `--opaque` 变体并生效 3px 模糊，弹窗圆角 14px。
- 隔离应用 changed-scope mock 冒烟：8 个自动场景与 3 个 mock 关卡通过，控制台 / 运行时错误 0。首轮的无障碍检查把两个通过 `aria-labelledby` 命名的既有滑块误报为缺少标签，已修正冒烟脚本按无障碍名称规则解析后重跑通过。未重跑全量测试。
- 本补丁发布 Windows x64 安装包与便携版。

---

# CraftStation 1.11.26

## User-facing

- New "Minimal" theme group with six themes. Each has a dark and a light variant that follows the appearance mode:
  - Onyx: true black / pure white with a monochrome accent. Highest contrast.
  - Graphite: soft neutral grey-black / paper white with a monochrome accent.
  - Ash: dimmed charcoal / soft grey-white. Lowest glare in both modes.
  - Slate: cool blue-grey / mist white with a steel-blue accent.
  - Linen: warm charcoal / linen white with a sand accent.
  - Sage: green-tinted grey-black / celadon white with a sage accent.
- The theme list is grouped into CraftStation, Minimal, and Editor themes.
- Floating surfaces are consistent: select dropdowns are no longer pill-shaped, and menus, dropdowns, dialogs, and the file-mention panel share one corner radius with a fine hairline edge and soft shadow. The sidebar New and notification menus no longer mix square and rounded corners.
- Dialog scrims are lighter with a subtle blur. Tooltips use a neutral dark chip with a finer edge and shadow.
- Fixed a renderer crash when an Escape key event was dispatched directly on the document.

## Implementation

- `ThemeSpec` gains an optional `overlay` so Minimal light themes keep menus and dialogs as bright as the page. Presets gain a `group` field and the settings gallery renders by group. The new group titles are translated in all 13 locales.
- Floating surfaces use a 0.875rem radius with 0.5rem rows. `--overlay-shadow` is defined per mode as a hairline ring, a contact shadow, and a soft drop. `--backdrop` is lighter, opaque backdrops get a 3px blur, and the blur is disabled when reduced transparency is requested.
- `overlayEscapeStack` only calls `closest` on Element targets.

## Verification

- All six new themes pass the existing contrast tests (text, muted text, accent, status colors, and button fills). 499 tests across 55 theme, settings, sidebar, and Escape files, 16 changelog tests, `pnpm typecheck`, `pnpm lint`, and formatting checks passed. The new Escape regression test failed before the fix and passes after it.
- An isolated real Electron app was checked for the theme groups, Onyx light / dark, and Graphite dark across Settings, the select dropdown, the New menu, and a dialog: the dropdown radius is 14px, the backdrop is the `--opaque` variant with the 3px blur applied, and the dialog radius is 14px.
- Isolated-app changed-scope mock smoke: 8 automated scenarios and 3 mock gates passed with zero console/runtime errors. The first run's accessibility gate flagged two existing sliders named through `aria-labelledby` as unlabeled; the smoke script now resolves that per the accessible-name rules, and the rerun passed. The full test suite was not rerun.
- This patch ships Windows x64 installer and portable packages.
