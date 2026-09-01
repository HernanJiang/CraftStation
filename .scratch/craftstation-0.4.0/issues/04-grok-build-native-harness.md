# 04 — Grok Build Native Harness

**What to build:** 使用官方 Grok Build runtime 的 machine-facing boundary 接入完整 Native Harness；优先实测 `grok agent stdio`/ACP，官方 CLI commands 仅承担 discovery/management 辅助。

**Blocked by:** 03 — Codex Native Baseline Guard

**Status:** completed

- [x] 官方 binary discovery/version/auth/profile 诊断可复现；本机 ACP readiness 未主动启动。
- [x] Native session、stream/event、tool/permission、send/interrupt/resume/cleanup 贯通 CraftPlan contract 与 fixture response。
- [x] ACP/stdio 的 native capability 与不支持项进入矩阵；不改走模型 API。
- [x] crash、协议不匹配、auth/rate-limit 与 no-leaked-process 有 adapter/diagnostic 测试；真实 provider smoke 仍需 opt-in。

交付证据：`craftstation/src/supervisor/agents/grok/`、
`craftstation/src/supervisor/runtime/nativeHarness/nativeHarnessProviderFixtures.test.ts`。
