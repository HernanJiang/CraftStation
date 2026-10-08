# CraftStation v1.8.7

## 用户可见

- 修复 Antigravity 偶尔停在工具调用处，却显示“已完成”的问题。工具前的说明文字和重复的旧回复快照不再被当成最终回答。
- 工具后的网络失败、原生进程提前退出，以及缺少最终回复的提前成功信号，按已有重试次数与间隔续接原生会话。重试关闭或耗尽时明确显示失败；真正交付最终回答后的重复生成保护继续保留。

## 实现

- 完成判定同时检查工具状态、文字与工具的先后顺序，以及结束快照是否带来了新的可见回复。
- 新增共享传输中断错误类型，接入现有 Craft-Harness 重建与限次续接流程；用户主动停止的语义不变。

## 验证

- 104 项 Antigravity 会话、事件映射、重试与失败报告相关测试通过，涵盖正在运行及已完成工具、只收到工具完成事件、网络失败、旧快照、进程退出、最终回复与重试上限。
- 类型检查、两种 lint 通过；隔离 Electron 聊天、搜索、输入框及三个 mock 门禁通过，控制台和运行时错误为 0。
- 真实 Antigravity 验证受当前 `agy` 模型参数拒绝及模型列表获取超时阻塞，未记为通过。测试仅使用隔离项目和只读请求，测试窗口已重置并停止。
- Windows x64 NSIS 安装包与便携版构建通过，生产编译、17 项运行依赖及原生二进制检查通过；更新清单指向 1.8.7。

---

# CraftStation v1.8.7

## User-facing

- Fix Antigravity occasionally ending on tool calls while showing the turn as completed. Narration before tools and repeated old response snapshots no longer count as final answers.
- Network failures after tools, premature native process exits, and early success signals without a final reply resume the native conversation using the existing retry count and interval. Disabled or exhausted retries surface a failure; protection against regenerating delivered final answers remains in place.

## Implementation

- Completion checks consider tool state, the ordering of text and tools, and whether the closing snapshot delivers new visible reply content.
- A shared transport interruption error feeds the existing Craft-Harness rebuild and bounded continuation flow; intentional Stop behavior remains unchanged.

## Verification

- 104 related Antigravity session, event mapping, retry, and failure reporting tests passed, covering active and completed tools, completion-only tool updates, network failures, old snapshots, process exits, final replies, and retry limits.
- Type checking and both lint passes succeeded. Isolated Electron chat, search, composer, and three mock gates passed with zero console or runtime errors.
- Live Antigravity verification was blocked by the current `agy` rejecting model parameters and timing out while fetching its model list; it is not reported as passed. Checks used an isolated project and read-only prompts, and the test app was reset and stopped.
- Windows x64 NSIS installer and portable builds passed, including production compilation, 17 runtime dependency checks, and native binary checks. Update metadata points to 1.8.7.
