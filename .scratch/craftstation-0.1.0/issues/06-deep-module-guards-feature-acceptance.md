# 06 — Deep-module Guards 与 Feature Acceptance

**What to build:** 对完整 OpenAI + Codex Native Recipe 链执行架构、回归、诊断和真实 Codex 验收，并建立自动 guard，确保第一阶段 deep-module 重构可持续交给 Debugger 独立审查。

**Blocked by:** 05 — 持久化 Composition Provenance 与 Session Recovery.

**Status:** ready-for-agent

- [ ] 自动检查或测试阻止 React UI 与 Crafting domain accidental deep imports 到 Codex app-server、stdio、RPC、server pool 和 Codex-specific session implementation。
- [ ] `crafting`、`registry`、`harness-runtime` 与 provider/API concern 的 Interface、依赖方向、错误语义和主要 test surface 与 Manager Spec 一致。
- [ ] application startup、workspace、Codex startup、session、terminal、IPC、persistence 与 shutdown/cleanup 回归通过；任何基线失败都有可复现证据和影响判断。
- [ ] 关键日志能从一次失败定位 phase、operation、object identity、error code、cause 与 next action，并覆盖成功、跳过、降级和失败。
- [ ] 完成真实 `React -> Recipe -> CraftPlan -> Codex -> Entity -> Session -> response` 验收证据；没有真实 Codex round-trip 时不得声明 Feature Ready for Debugger。
- [ ] Coder 文档记录全部 Ticket 结果、实际验证、依赖链自检和未解决风险，并明确 `Ready for Debugger: Yes`。
