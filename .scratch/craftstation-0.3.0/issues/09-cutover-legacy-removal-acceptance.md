# 09 — 产品切换、Legacy 移除与 Feature Acceptance

**What to build:** 把 Codex Native Recipe 的唯一生产路径切换到 CraftStation-owned Runtime，移除 legacy fallback，并以真实双轮 Session 和架构证据关闭 Feature。

**Blocked by:** 08 — Composition Provenance 与重启恢复

**Status:** done

- [x] Codex 产品路径不存在对 \ThreadSessionManager\、\SpawnPipeline\、PoraCode \AgentAdapter\、\CodexStructuredSession\、PoraCode canonical event mapping 或 Codex hook plugin 的依赖或 fallback。
- [x] 依赖守卫能在重新引入 legacy import 时失败。
- [x] 真实 \Model -> Recipe -> CraftPlan -> official app-server -> Session -> streaming -> response -> second turn\ 通过。
- [x] 配置、usage、compaction、approval、MCP、Skills、resume、interrupt、long turn 与 cleanup 的最低支持矩阵通过。
- [x] typecheck、lint、tests、build 和受影响 Desktop regression 通过，或非 Feature 基线失败有可复现证据。
- [x] 未识别事件、官方错误和 legacy provenance 不会静默 fallback。
- [x] Coder 文档完整，Feature 可交 Debugger；没有真实证据不得声明 PASS。
