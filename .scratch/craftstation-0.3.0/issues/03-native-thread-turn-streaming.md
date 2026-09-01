# 03 — 打通首条真实 Native Thread/Turn 流式链

**What to build:** 用户从 CraftStation Crafting UI 启动官方 Codex Thread/Turn，并在现有 Session UI 中实时看到真实 response 和原生工作事件。

**Blocked by:** 02 — 直接启动官方 app-server 并发现 Runtime 能力

**Status:** done

- [x] 真实官方 Codex binary 从 CraftPlan 创建 Thread 和首个 Turn。
- [x] assistant/reasoning/tool/file 等支持事件按顺序流式显示。
- [x] Turn terminal state 与最终 assistant message 可从官方事件恢复。
- [x] 实时 UI 不再以完整 \
      esponse: string\ 为事实来源。
- [x] 未知通知不会静默丢弃，也不会导致 Session 崩溃。
- [x] 产品调用链不经过 \ThreadSessionManager\、\SpawnPipeline\ 或 PoraCode CodexStructuredSession。
