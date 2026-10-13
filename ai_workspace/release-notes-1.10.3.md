# CraftStation v1.10.3

## 用户可见

- 修复复制代码块中的部分行或行内代码后，粘贴到输入框时多出单反引号与三反引号的问题。粘贴直接显示选中的原文，保留换行与行内缩进。
- 复制渲染后的公式仍会恢复 TeX 并显示为公式；代码内容本身包含的反引号继续保留。

## 实现

- 剪贴板 HTML 转文本时，`pre` 与 `code` 不再添加 Markdown 分隔符，避免嵌套标签生成重复包装。
- 增加覆盖两行代码、语法高亮、行内代码、原文反引号，以及输入框粘贴和提交的回归测试。

## 验证

- 相关回归测试、完整类型检查及变更文件两种 lint 通过。
- 隔离 Electron 验证代码与公式粘贴，以及输入框光标位置；使用测试数据，未发起真实账号回合。
- 提供 Windows x64 安装包、更新附件与便携版。

---

# CraftStation v1.10.3

## User-facing

- Fixed extra single backticks and triple-backtick fences when pasting selected code lines or inline code into the composer. Pasted text displays the selected contents directly, preserving line breaks and indentation within the selection.
- Copied rendered formulas still recover their TeX source and display as formulas. Backticks that belong to the selected code remain intact.

## Implementation

- Clipboard HTML conversion no longer adds Markdown delimiters for `pre` and `code`, avoiding duplicate wrappers from nested tags.
- Added regression coverage for two-line code, syntax highlighting, inline code, literal backticks, and composer paste and submission.

## Verification

- Related regression tests, full type checking, and both lint modes for changed files passed.
- Isolated Electron checks cover code and formula pasting and caret placement with fixture data. No real account turns were started.
- Includes the Windows x64 installer, updater assets, and portable build.
