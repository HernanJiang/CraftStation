# 06 — Antigravity Native Harness

**What to build:** 将官方 Antigravity runtime 作为 Google/Gemini 侧平级目标接入 CraftStation；不以 Gemini CLI 替代，完整记录其可用的 machine-facing native boundary。

**Blocked by:** 05 — Kimi Code Native Harness

**Status:** completed

- [x] Antigravity 官方 runtime discovery/auth/profile/session/stream 证据可复现；provider keyring 认证仍为 soft signal。
- [x] `Crafting -> CraftPlan -> Entity -> Session`、send/interrupt/resume/cleanup 贯通 PTY contract 与 fixture。
- [x] 原生不支持、实现缺失、运行时不可用、错误状态明确区分。
- [x] Antigravity 与其它四个 Harness 平级注册，不成为汇聚/转发层。

交付证据：`craftstation/src/supervisor/agents/antigravity/`、
`craftstation/src/supervisor/runtime/nativeHarness/nativeHarness.test.ts`。
