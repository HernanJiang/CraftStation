# CraftStation 1.10.2

修复聊天正文与思考内容的流式拼接丢字符问题。

## 用户可见

- 连续 `.next.next`、多级代码链和重复文字不再被当作重复输出删除。
- 单独传来的反引号与相邻空格保持完整，避免行内代码损坏及 `as slow` 变成 `asslow`。
- 修复适用于后续收到的消息；已经保存的缺字符历史消息不会自动恢复。

## 实现

- 标准 ACP 正文和思考 chunk 按增量原样追加，不再套用累计快照去重。
- 非标准嵌入式 `reasoning_content` 保留累计快照兼容，取消仅凭后缀相同就丢弃片段的判断。
- 技能目录过滤不再将只有 Markdown 分隔符的片段识别为目录标题。

## 验证

- 774 项相关回归测试通过，覆盖 ACP、Kimi、消息渲染、思考显示和流式事件处理。
- 覆盖重复后缀、多级链、空格、带空格的反引号、逐字符拆分及所有两段切分位置；断言渲染前字符串与 DOM 文本逐字符一致。
- 完整类型检查及变更文件的普通、类型感知 lint 通过。
- 真实隔离 Electron 界面验证正文、折叠与展开的思考、粗体、列表、表格和代码块；基线与三项 mock 门禁通过。
- 对照截图对应的 Kimi 原生记录，确认原始 `.next.next` 和 `as ` 后的空格完整，丢失发生在 CraftStation 的流式映射阶段。
- 本补丁提供 Windows x64 安装包与便携版；未发起真实账号的付费对话。

---

# CraftStation 1.10.2

Fixes dropped characters while assembling streamed chat messages and reasoning.

## User-facing

- Consecutive `.next.next` suffixes, chained member access, and repeated text are no longer removed as duplicate output.
- Standalone backticks and adjacent spaces remain intact, preventing broken inline code and `as slow` becoming `asslow`.
- The fix applies to subsequently received messages. Previously stored messages with missing characters are not automatically restored.

## Implementation

- Standard ACP message and thought chunks are appended as deltas without cumulative snapshot deduplication.
- Non-standard embedded `reasoning_content` retains cumulative snapshot compatibility, while suffix equality alone no longer causes a chunk to be discarded.
- The skill catalog filter no longer classifies Markdown delimiter fragments as catalog headers.

## Verification

- 774 relevant regression tests passed, covering ACP, Kimi, message rendering, reasoning display, and streamed event handling.
- Tests cover repeated suffixes, chained access, spaces, space-prefixed backticks, character-by-character streaming, and every two-part split, comparing both pre-render strings and DOM text exactly.
- Full type checking and standard and type-aware lint for the changed files passed.
- An isolated real Electron app verified message text, collapsed and expanded reasoning, bold text, lists, tables, and code blocks; the baseline and three mock gates passed.
- The screenshot's Kimi native record retains `.next.next` and the space following `as`; characters were lost in CraftStation's stream mapping.
- This patch provides Windows x64 installer and portable packages. No paid conversation with a real account was initiated.
