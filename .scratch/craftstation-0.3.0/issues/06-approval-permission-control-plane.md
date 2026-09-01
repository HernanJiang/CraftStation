# 06 — Approval 与 Permission Control Plane

**What to build:** 把官方 Codex 的 server-initiated approval、permission 和用户输入请求完整投影到 CraftStation UI，并把用户决定准确发回官方 Runtime。

**Blocked by:** 05 — 完整 Native Session 生命周期与长任务控制

**Status:** done

- [x] command/file/patch/tool approval 请求完整进入 UI pending request 状态。
- [x] request-user-input 支持 1-3 个问题并在 UI 中收集提交。
- [x] accept、decline、cancel 与 session-wide decision 准确发回官方 Runtime。
- [x] prompt/turn 完成或中断后，悬挂的 approval 请求自动清理。
- [x] approval payload 不把敏感凭据或无关参数混入持久化。
