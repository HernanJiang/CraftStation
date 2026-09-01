# 03 — 通过 Codex Runtime 运行 Entity Session

**What to build:** 把有效 CraftPlan 交给生产 Codex runtime Adapter，复用 PoraCode 现有 execution path 创建或恢复 Entity Session，并完成 prompt、events/streaming、response 与资源清理。

**Blocked by:** 02 — Craft OpenAI + Codex Native Recipe.

**Status:** ready-for-agent

- [ ] CraftStation 上层只通过最小 `harness-runtime` Interface 提交 CraftPlan、Workspace、可选 Session reference 与 Prompt。
- [ ] 生产 Adapter 复用 Supervisor process ownership、ThreadSessionManager、SpawnPipeline 与 Codex structured session implementation，不创建第二套 process/session owner。
- [ ] Runtime 返回稳定的 Entity identity、Session identity、canonical runtime events 和 lifecycle result。
- [ ] Session 支持 create、resume、prompt、events/streaming、response 与 terminate，正常终止清理必要进程、连接和订阅资源。
- [ ] runtime unavailable、authentication、startup、connection、execution 与 recovery failure 穿过 seam 被上层感知，不静默 fallback。
- [ ] 自动化集成测试锁定 event mapping、session lifecycle、错误透传与资源清理，并保持既有 Codex/session regression surface。
