# CraftStation 1.11.19

## 用户可见

- 修复消息中的 `<u>下划线</u>` 等内联 HTML 被原样显示的问题。
- `u / ins / del / mark / sub / sup` 以及 `b / strong / i / em / s / strike / small / code` 现在都会渲染为正确格式，不再泄露开始或结束标签。
- `<plan>`、`<update>` 等伪 XML 占位符仍按纯文本显示，代码块、公式、表格与 Mermaid 渲染行为保持不变。

## 实现

- 原始 HTML 预处理只放行常见的安全内联格式标签，其余疑似伪 XML 的内容继续转义。
- Markdown sanitizer 增补 `u`、`mark`、`small` 标签；属性与其他 HTML 仍由安全 schema 清理。
- 回归同时断言最终 DOM，而不是只检查文本预处理结果；`<strong>` 接受 Streamdown 的语义化粗体 `span`。

## 验证

- 新增回归在修复前失败、修复后通过；Markdown 相关 127 项测试、changelog 16 项、typecheck 与 lint 通过。
- 真实 Electron 消息中确认 `u / ins / del / mark / sub / sup / strong / em / code` 均生成正确元素，未泄露原始标签。
- changed-scope mock smoke 的 welcome、baseline、thread-search、composer-caret、preview-close 及全部 mock gate 通过，控制台/运行时错误 0。
- 截图 `C:/Users/Haona/.craftstation-smoke/debug-1793272606274-53572/artifacts/inline-html.png`，报告 `C:/Users/Haona/.craftstation-smoke/debug-1793272606274-53572/artifacts/smoke-report.json`。
- 本补丁仅发布 Windows x64 安装包与便携版。

---

# CraftStation 1.11.19

## User-facing

- Fixed inline HTML such as `<u>underlined</u>` appearing as raw source in chat messages.
- `u / ins / del / mark / sub / sup` and `b / strong / i / em / s / strike / small / code` now render with their intended formatting instead of leaking opening or closing tags.
- Pseudo-XML placeholders such as `<plan>` and `<update>` remain plain text. Code blocks, math, tables, and Mermaid rendering are unchanged.

## Implementation

- Preserve only common safe inline formatting tags during raw-HTML preprocessing; continue escaping other tag-like pseudo-XML.
- Add `u`, `mark`, and `small` to the Markdown sanitizer schema. Attributes and all other HTML remain subject to the safe schema.
- Assert the final DOM in regression coverage, not just the preprocessing output. `<strong>` accepts Streamdown's semantic bold `span`.

## Verification

- New regressions failed before the fix and pass after it. All 127 Markdown tests, 16 changelog tests, typecheck, and lint passed.
- A real Electron message produced the expected elements for `u / ins / del / mark / sub / sup / strong / em / code` without leaking raw tags.
- Changed-scope mock smoke passed welcome, baseline, thread-search, composer-caret, preview-close, and every mock gate with zero console/runtime errors.
- Screenshot: `C:/Users/Haona/.craftstation-smoke/debug-1793272606274-53572/artifacts/inline-html.png`. Report: `C:/Users/Haona/.craftstation-smoke/debug-1793272606274-53572/artifacts/smoke-report.json`.
- This patch ships Windows x64 installer and portable packages.
