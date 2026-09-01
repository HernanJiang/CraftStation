# 04 — React Crafting Grid 到真实 Session

**What to build:** 让用户在 React Crafting Grid 中选择 OpenAI Model、看到 `auto -> Codex` 的解析结果和 Recipe/Result preview，Craft 后进入真实 Entity Session 并完成一次 Codex prompt round-trip。

**Blocked by:** 03 — 通过 Codex Runtime 运行 Entity Session.

**Status:** ready-for-agent

- [ ] React UI 提供 Model Slot、Harness Slot、Recipe/Result preview 与 Craft action，默认 Harness 为 `auto` 并展示其确定性解析结果。
- [ ] 可执行状态、不可执行原因和 Craft action 来自 CraftStation contracts，不由组件内部硬编码 Codex transport 逻辑。
- [ ] Craft 成功后进入现有稳定 chat/session experience，并完成真实 prompt、events/streaming 与 response 工作流。
- [ ] resolve、validate、runtime unavailable、auth 和 execution failure 按稳定错误语义呈现，并保留可重试路径和诊断上下文。
- [ ] React/UI/shared contracts 不导入 Codex app-server、stdio、RPC、server pool 或 Codex-specific session implementation。
- [ ] UI 测试覆盖默认 auto、显式 Codex、无效组合、runtime failure、成功 handoff 与 Session 展示。
