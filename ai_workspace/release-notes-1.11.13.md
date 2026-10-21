# 1.11.13 临时对话窄窗口可以点选模型（2026-10-21）

## 用户可见

- 临时对话这种窄窗口里，打开参数菜单后可以直接点模型。点下去会换成底部那一栏显示的模型，菜单随后关上。
- 上下文窗口、推理强度、快速模式仍是原来的二级菜单。它们打开时不再挡住模型点击。

## 实现

- 窄窗口的模型选择画在参数菜单外面，用按钮接收点击。宽度超过 760px 时仍使用左侧的模型二级菜单。

## 验证

- `pnpm typecheck` 通过。`pnpm lint` 0 警告 0 错误。`DraftParameterMenu.test.tsx` 26 项通过。新增断言：窄窗口里模型不在菜单节点内，点击后调用 `onChange`。
- 正在运行的 1.11.12 窗口没有这版源码，安装前无法在那个窗口里点到修复后的列表。

---

# 1.11.13 Narrow temporary chat can pick a model (2026-10-21)

## User-facing

- In the narrow temporary-chat window, opening the parameter menu lets you click a model. The pick replaces the model shown on the bottom bar, and the menu closes.
- Context size, reasoning, and fast mode stay in their existing submenus. Opening those no longer blocks a model click.

## Implementation

- On a narrow window the model choices are buttons drawn outside the parameter menu. Above 760px the model list remains the left-side submenu.

## Verification

- `pnpm typecheck` passed. `pnpm lint` reported 0 warnings and 0 errors. `DraftParameterMenu.test.tsx` passed 26 tests. New assertion: in a narrow window the model choice is outside the menu node, and a click calls `onChange`.
- The running 1.11.12 window does not contain this source, so the fixed list could not be clicked there before install.
