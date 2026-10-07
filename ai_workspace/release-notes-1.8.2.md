# CraftStation v1.8.2

## 用户可见

- 修复粘贴含多处 Markdown 公式的文本后，继续输入时光标跳回前面公式附近的问题。
- 保留原本的粘贴位置：在末尾粘贴后可以接着输入，在文本中间粘贴后也可以原地续写。

## 实现

- 公式转换完成后重新同步浏览器 Selection，避免后续 DOM 替换留下过期的原生输入位置；没有发生公式转换时不改动光标。
- 真实 Chromium 冒烟增加“粘贴两处公式后再输入一个字符”的回归检查，覆盖行内公式、块公式及混合文本。

## 验证

- 46 项输入框、公式转换与 HTML 剪贴板测试通过；类型检查、普通及类型感知 lint 通过。
- 隔离 Electron 验证粘贴后续写、文本中间粘贴、含行内代码及三处箭头公式的 HTML 剪贴板回放，光标位置均正确。
- 聊天相关冒烟及确定性 mock 门禁通过，控制台和运行时错误为 0。

---

# CraftStation v1.8.2

## User-facing

- Fix the cursor jumping back near an earlier formula when typing after pasting text with multiple Markdown formulas.
- Preserve the paste position so you can continue typing both at the end of a message and in the middle of existing text.

## Implementation

- Resynchronize the browser Selection after all formula conversions finish, avoiding a stale native editing position after subsequent DOM replacements; leave the cursor untouched when no formula is converted.
- Add a real Chromium smoke regression that pastes two formulas and types another character, covering inline formulas, display formulas, and mixed text.

## Verification

- All 46 composer, formula conversion, and HTML clipboard tests passed, along with type checking, standard lint, and type-aware lint.
- Isolated Electron checks covered continued typing, pasting in the middle of text, and an HTML clipboard replay with inline code and three arrow formulas; all retained the correct cursor position.
- Chat smoke tests and relevant deterministic mock gates passed with zero console or runtime errors.
