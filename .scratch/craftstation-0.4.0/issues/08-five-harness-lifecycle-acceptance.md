# 08 — Five-Harness Entity/Session/Lifecycle Acceptance

**What to build:** 用同一 capability acceptance matrix 对五个 Native Harness 做端到端验收，证明它们都能进入 Crafting、Runtime、Entity、Session 并保持 native identity/lifecycle。

**Blocked by:** 07 — DeepSeek / DSH Native Harness Re-audit & Integration

**Status:** completed

- [x] 五个 Harness 均完成 discovery/readiness、start/resume/multi-turn、stream、interrupt、cleanup 验收或明确 unavailable。
- [x] tool/file/shell、permission、workspace、MCP、Skills、Subagents、context/compaction、plan/task 按原生支持情况记录。
- [x] native session identity 持久化、restart/resume、crash recovery 与 no leaked process 有证据。
- [x] 每项能力状态为 supported+integrated、native unsupported、implementation missing、unavailable 或 error 之一。

交付证据：`src/supervisor/runtime/nativeHarness/nativeHarnessLifecycleAcceptance.test.ts`、
`ai_workspace/validation/v0.4.0-native-harness-audit.md`。
