# Release 1.3.4 — 公式内 `<` 渲染修复

## 用户可见

- **修复公式整段变原文乱码的问题**：模型输出的 LaTeX 公式中含 `y_{<t}`、`x<y` 这类 `<` 紧跟字母的写法时，整条公式原样显示（能看到 `&lt;` 实体或 `\mathcal` 源码），不含 `<` 的公式正常 —— 表现为时好时坏。现在公式内的 `<` 走 `\lt` TeX 命令路径，KaTeX 正常渲染为 `<`。
- **模型直接输出 `&lt;` 的公式也能恢复**：实体先解码，再走同一路径。

## 实现

- 根因有两层：① `escapeBareAngleTags` 把公式内 `<`+字母 转义成 `&lt;`（KaTeX 遇 `&` 抛 ParseError，整段回退原文）；② Streamdown 的 `remend` 不完整 markdown 处理把 `<t` 当未闭合标签，从 `<` 起截断数学段（`$x<y$` → `$x`），即使不转义，KaTeX 拿到的也只是截断后的公式。
- `escapeBareAngleTags` 拆分保护区域时把 `$…$`/`$$…$$`/`\(…\)`/`\[…\]` 数学段一并跳过（`\(`/`\[` 按 `LATEX_MATH_SIGNAL_RE` 判定；无信号括号仍按 prose 处理）。
- 新增 `protectMathSpans` 归一化（在 `normalizeLatexMathDelimiters` 之后运行）：数学段内先解码 `&lt;`/`&gt;`/`&amp;`，再把 `<`+`[A-Za-z/!?]` 改写为 `\lt ` —— remend 不再截断，KaTeX 渲染为 `<`。
- FileEditorOverlay 的 MarkdownPreview 走 react-markdown 独立管线，不受影响。

## 验证

- `ItemMarkdown.test.ts` +5 例（数学段 `<` 保护、信号判定、`\lt` 改写、实体解码、代码/prose 不受影响）；`ItemMarkdownInner.test.tsx` +2 例渲染级（含 `<` 的 display 公式经 KaTeX 渲染、源含 `&lt;` 的公式恢复），文件 63/63 全过；`pnpm typecheck` PASS。
- 直接用项目依赖复现根因：remend 把 `$$y_{<t}$$` 截成 `$$y_{$$`；KaTeX 对 `\lt` 渲染正确。

---

# Release 1.3.4 — Formula `<` Rendering Fix

## User-facing

- **Fixed formulas collapsing to raw source**: when a model emitted LaTeX containing a `<` immediately followed by a letter (`y_{<t}`, `x<y`), the whole formula fell back to raw text (showing `&lt;` entities or `\mathcal` source) while `<`-free formulas rendered fine — the intermittent garbled-formula symptom. `<` inside math now takes the `\lt` TeX-command path and KaTeX renders it as `<`.
- **Formulas whose source already contains `&lt;` entities recover too**: entities decode first, then follow the same path.

## Implementation

- Two layered root causes: ① `escapeBareAngleTags` rewrote `<`+letter inside math to `&lt;` (KaTeX throws on `&` outside alignment, dropping the whole formula to raw text); ② Streamdown's `remend` incomplete-markdown pass treats `<t` as an unclosed HTML tag and truncates the math span from `<` on (`$x<y$` → `$x`), so even an unescaped `<` never reached KaTeX intact.
- `escapeBareAngleTags` now skips `$…$`/`$$…$$`/`\(…\)`/`\[…\]` math spans like code spans (`\(`/`\[ ` judged per `LATEX_MATH_SIGNAL_RE`; signal-less brackets stay prose).
- New `protectMathSpans` normalizer (runs after `normalizeLatexMathDelimiters`): inside math spans, decode `&lt;`/`&gt;`/`&amp;` first, then rewrite `<` + `[A-Za-z/!?]` to `\lt ` — remend no longer truncates and KaTeX renders `<`.
- FileEditorOverlay's MarkdownPreview uses a separate react-markdown pipeline and is unaffected.

## Verification

- `ItemMarkdown.test.ts` +5 cases (math `<` protection, signal check, `\lt` rewrite, entity decode, code/prose untouched); `ItemMarkdownInner.test.tsx` +2 render-level cases (display formula containing `<` renders via KaTeX, `&lt;`-source formula recovers) — file 63/63 green; `pnpm typecheck` PASS.
- Root cause reproduced directly against project deps: remend truncates `$$y_{<t}$$` → `$$y_{$$`; KaTeX renders `\lt` correctly.
