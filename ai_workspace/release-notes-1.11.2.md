# CraftStation 1.11.2

## 用户可见

- 上下文容量优先使用 CLI 报告的窗口和占用。Kimi K3-256k 显示 256K，不再显示写在会话配置里的 Codex 默认 272K。
- Kimi 官方压缩完成后，占用改为它报告的压缩后 token；`Messages compacted`、`Tokens before`、`Tokens after` 不再混进聊天正文。
- 一轮对话结束后，侧栏、标题和输入栏停止转圈。仍在运行的后台 Agent 单独显示数量。

## 实现

- 提供者报告的窗口与模型名后缀一致时直接采用。没有报告时，用模型名上的窗口，不再沿用其他厂商留下的 `contextSize`。
- Kimi 的压缩状态行收成压缩记录，并用 `Tokens after` 更新占用。
- 线程级工作状态只看 `thread.status`。历史回放里的原生子代理需要本轮确实观察过才算仍在工作。
- Harness 能力改为显式声明，Recipe 要求的能力未声明或不匹配时拒绝编译。花费上限、工具调用上限和 shell 确认跟 Recipe 与会话策略走，在 ACP 权限请求处生效。
- Windows x64 提供 NSIS 安装包与便携版。

## 验证

- 上下文与压缩相关 122 项测试通过，完成状态相关 125 项测试通过，类型检查通过。未在本机重打安装包，正式包由发布流水线构建。未验证真实账号模型回合。

---

# CraftStation 1.11.2

## User-facing

- Context capacity now prefers the window and occupancy reported by the CLI. Kimi K3-256k shows 256K instead of the Codex default 272K stored on the thread.
- After Kimi's own compaction, occupancy follows the CLI's post-compaction token count. The `Messages compacted`, `Tokens before`, and `Tokens after` lines no longer appear in the chat text.
- When a turn finishes, the sidebar, header, and composer stop spinning. Background agents that are still running keep their own count.

## Implementation

- A provider-reported window that matches the model-id suffix is kept. Before a report arrives, the suffix is used instead of a `contextSize` left behind by another vendor.
- Kimi's compaction status lines become a compaction record, and `Tokens after` updates occupancy.
- Thread-level working chrome follows `thread.status` only. Replayed native sub-agents count as still working only when they were observed live.
- Harness capabilities are explicit declarations. A Recipe whose required capability is missing or different is refused at compile time. Spend caps, tool-call caps, and shell confirmation follow the Recipe and session policy, and are enforced on ACP permission requests.
- Windows x64 includes an NSIS installer and a portable package.

## Verification

- 122 tests covering context and compaction passed, 125 tests covering completion status passed, and type checking passed. The installer was not rebuilt locally; the release workflow builds the official packages. No real-account model turn was run.
