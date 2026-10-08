# CraftStation v1.8.5

## 用户可见

- 修复 Gemini 等模型的多行公式偶尔显示成 LaTeX 源码的问题，嵌套分段公式可以完整渲染，首行的等式和括号结构不再丢失。
- 公式结束在回复末尾、没有最后换行时，也能正常识别结束定界符。

## 实现

- 在现有公式预处理中，将多行公式中带有数学内容的起始定界符拆到独立一行，避免 Markdown 将首行当作元信息而丢弃；同时处理末尾没有换行的结束定界符。
- 保留单行公式、定界符元信息、代码块和原有定界符修补行为；新增实际 Gemini 输出和简化分段公式的渲染回归。

## 验证

- 98 项 Markdown 预处理与渲染测试、20 项 changelog 相关测试通过，包含用户截图对应的嵌套分段公式。
- 隔离 Electron 回放实际持久化公式，验证完整显示、流式前缀更新到最终内容、代码块和行内公式，公式渲染错误为 0。
- 相关聊天冒烟及三个确定性 mock 门禁通过，控制台和运行时错误为 0；类型检查、普通及类型感知 lint 通过。

---

# CraftStation v1.8.5

## User-facing

- Fix multiline formulas from Gemini and other models occasionally appearing as raw LaTeX. Nested piecewise expressions render completely, retaining the equation and opening structure on their first line.
- Recognize closing delimiters when a formula ends at the end of a response without a final newline.

## Implementation

- Extend the existing formula preprocessing to place a math-bearing opening delimiter on its own line, preventing Markdown from discarding the first line as metadata. Also separate closing delimiters when there is no final newline.
- Preserve single-line formulas, delimiter metadata, code blocks, and existing delimiter repairs. Add rendering regressions for the actual Gemini output and a minimal piecewise expression.

## Verification

- All 98 Markdown preprocessing and rendering tests and 20 changelog-related tests passed, including the nested piecewise formula from the user's screenshot.
- Isolated Electron replayed the persisted formula and checked complete rendering, streamed prefixes updating to final content, code blocks, and inline formulas, with zero formula rendering errors.
- Relevant chat smoke checks and three deterministic mock gates passed with zero console or runtime errors; type checking, standard lint, and type-aware lint passed.
