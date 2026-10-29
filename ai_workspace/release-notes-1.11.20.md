# CraftStation 1.11.20

## 用户可见

- 中文加粗不再露出星号：`**注意：**正文`、`**（重点）**后面`、`这是**“引用”**文字` 这类加粗内容以中文标点开头或结尾、外侧紧跟中文的写法，在聊天消息和 Markdown 文件预览中都能正确加粗。
- `价格 $5 到 $10` 这类金额不再被误当成公式；真正的 `$E=mc^2$`、`$x^2$` 公式照常渲染。
- 消息中的 `<kbd>`（按键样式）、`<abbr>`、`<q>`、`<samp>`、`<var>`、`<tt>`、`<hr>`、`<details>/<summary>` 折叠块，以及带 `href` 的 `<a>` 链接和带 `src` 的 `<img>` 图片现在能正确渲染，不再原样露出标签或被拆成乱码链接。正文里随口提到的 `<details>`、不带地址的 `<a>` 等仍按文本显示，不会把后文折叠或吞掉。
- DeepSeek Harness：Auto 模式不再把 OpenCode Zen（`opencode/…`）、OpenRouter 等 dsh 没有接入通道的 DeepSeek 模型改派到 dsh，避免切换时报 `DSH model binding failed`；这些模型留在原 Harness（如 OpenCode）运行。OpenCode Go、Command Code 与已绑定的第三方自定义 API 账号仍走 dsh。
- DSH 模型绑定失败的提示中，可用模型列表改为 `deepseek-official/deepseek-v4-flash` 这样的可读格式。

## 实现

- 聊天渲染与 Markdown 文件预览接入 `remark-cjk-friendly` 2.3.3，修正 CommonMark 强调符号在中文标点旁的左右侧判定。
- 新增 `escapeCurrencyDollars`：单 `$` 公式按 Pandoc 规则判定（公式内容首尾不能是空白，闭合 `$` 后不能紧跟数字），不满足的 `$` 转为 `\$` 字面量；`$$` 块、行内代码与代码围栏不受影响。
- 原始 HTML 预处理放行 GitHub 安全 schema 内的上述标签；`<a>` 仅在带 `href`、`<img>` 仅在带 `src` 时放行；`<details>/<summary>` 按出现顺序栈式配对，只放行成对标签。sanitizer 增补 `abbr`。`<script>` 仍被转义，`javascript:` 链接与事件属性仍被清除。
- `kbd` 增加按键样式，`summary` 显示可点击光标。
- `shouldAutoRemapToDeepseekHarness` 只在模型渠道前缀属于 dsh 可服务集合（无前缀、`deepseek`、`commandcode`、`opencode-go`）时改派；第三方账号路由不受影响。

## 验证

- Markdown 渲染、文件预览、Harness 路由与 DSH 模型绑定相关 13 个测试文件、267 项测试通过；`pnpm typecheck`、`pnpm lint` 与格式检查通过。新增回归覆盖中文标点加粗、金额与公式、各 HTML 标签、`<details>` 配对（含同一消息中正文提及与真实折叠块并存）、渠道改派与报错格式。
- 完整 `pnpm test`：12828 通过、54 失败（24 个文件）。撤回本次改动后同样是这 24 个文件、54 项失败，均位于本次未修改的模块（WSL 启动确认、Agent 命令构建、ChatPane / SubAgent 等），不宣称全量测试全绿。
- 隔离的真实 Electron 应用中注入同一条 assistant 消息，DOM 断言：中文标点加粗 4 处、`kbd` 2 个、`abbr[title]`、`q`、HTML 链接、`hr`、`u` 下划线、`mark` 均生成正确元素；`<details>` 仅 1 个且内含代码块；正文提及 `<details>` 的句子可见；金额按原文显示且只渲染 1 个 KaTeX 公式；未泄露 `**` 或原始标签。截图 `C:/Users/Haona/.craftstation-smoke/render-1120-1793276743/render-real4.png`。
- changed-scope mock smoke 的 welcome、baseline、thread-search、composer-caret、preview-close、collaboration-layout、responsive-layout 与全部 mock gate 通过，控制台/运行时错误 0。报告 `C:/Users/Haona/.craftstation-smoke/automated-1793277502752-24328/artifacts/smoke-report.json`。
- OpenCode Zen 免费模型直连 API 返回 `FreeUsageLimitError`（提示免费模型仅在 OpenCode 中可用），因此本版不为 dsh 新增 Zen 通道，而是让这些模型留在 OpenCode。
- 本补丁仅发布 Windows x64 安装包与便携版。

---

# CraftStation 1.11.20

## User-facing

- Chinese bold text no longer leaks asterisks: patterns such as `**注意：**正文`, `**（重点）**后面`, and `这是**“引用”**文字`, where the bold run starts or ends with CJK punctuation next to CJK text, now render as bold in chat messages and the Markdown file preview.
- Currency such as `价格 $5 到 $10` is no longer rendered as a formula; real `$E=mc^2$` and `$x^2$` math still renders.
- `<kbd>` (keycap style), `<abbr>`, `<q>`, `<samp>`, `<var>`, `<tt>`, `<hr>`, `<details>/<summary>` collapsibles, `<a>` links with an `href`, and `<img>` images with a `src` now render correctly instead of leaking raw tags or turning into garbled links. A `<details>` or address-less `<a>` merely mentioned in prose stays plain text and never folds away or swallows the rest of the message.
- DeepSeek Harness: Auto mode no longer remaps DeepSeek models from channels dsh has no lane for (OpenCode Zen `opencode/…`, OpenRouter, …) onto dsh, which caused `DSH model binding failed` on switch; those models stay on their own Harness (such as OpenCode). OpenCode Go, Command Code, and bound third-party custom API accounts still run on dsh.
- The DSH model-binding error now lists available models in a readable form such as `deepseek-official/deepseek-v4-flash`.

## Implementation

- Wire `remark-cjk-friendly` 2.3.3 into the chat renderer and the Markdown file preview to fix CommonMark emphasis flanking next to CJK punctuation.
- Add `escapeCurrencyDollars`: single-dollar math follows Pandoc's rule (the body must not start or end with whitespace, and the closing `$` must not be followed by a digit); failing `$` signs become literal `\$`. `$$` blocks, inline code, and code fences are untouched.
- Raw-HTML preprocessing now preserves the tags above from GitHub's safe schema. `<a>` is kept only with an `href` and `<img>` only with a `src`; `<details>/<summary>` are matched stack-wise in document order and only paired tags are kept. The sanitizer schema adds `abbr`. `<script>` is still escaped, and `javascript:` links and event attributes are still stripped.
- Style `kbd` as keycaps and give `summary` a pointer cursor.
- `shouldAutoRemapToDeepseekHarness` remaps only when the model's channel prefix is one dsh can serve (none, `deepseek`, `commandcode`, `opencode-go`); third-party account routing is unchanged.

## Verification

- 267 tests across 13 files covering Markdown rendering, file preview, Harness routing, and DSH model binding passed, along with `pnpm typecheck`, `pnpm lint`, and the format check. New regressions cover CJK-punctuation bold, currency versus math, each HTML tag, `<details>` pairing (including a prose mention next to a real collapsible in the same message), channel remapping, and the error format.
- Full `pnpm test`: 12828 passed, 54 failed (24 files). With this change reverted, the same 24 files and 54 tests fail; all are in modules this release does not touch (WSL startup confirmation, agent command building, ChatPane / SubAgent, …). The full suite is not claimed green.
- In an isolated real Electron app, an injected assistant message produced the expected DOM: 4 CJK-punctuation bold runs, 2 `kbd`, `abbr[title]`, `q`, the HTML link, `hr`, underlined `u`, and `mark`; exactly one `<details>` containing a code block; the sentence mentioning `<details>` stays visible; currency renders verbatim with exactly one KaTeX formula; no `**` or raw tags leak. Screenshot: `C:/Users/Haona/.craftstation-smoke/render-1120-1793276743/render-real4.png`.
- Changed-scope mock smoke passed welcome, baseline, thread-search, composer-caret, preview-close, collaboration-layout, responsive-layout, and every mock gate with zero console/runtime errors. Report: `C:/Users/Haona/.craftstation-smoke/automated-1793277502752-24328/artifacts/smoke-report.json`.
- A direct API call to an OpenCode Zen free model returns `FreeUsageLimitError` (free models only work inside OpenCode), so this release keeps those models on OpenCode instead of adding a Zen lane to dsh.
- This patch ships Windows x64 installer and portable packages.
