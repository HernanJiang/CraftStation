# 05 — Kimi Code Native Harness

**What to build:** 审计并接入官方 Kimi Code 最稳定、最完整的 machine-facing interface，保持其原生 session/event/capability 语义并完成一条可验证的 Crafting vertical slice。

**Blocked by:** 04 — Grok Build Native Harness

**Status:** completed

- [x] 官方 runtime discovery、版本、认证/profile 与 readiness 有证据；本机 ACP readiness 未主动启动。
- [x] Native session/resume/multi-turn/stream、tool/file/permission（如支持）、interrupt/cleanup 可验证。
- [x] Kimi-specific native event 与 unsupported 状态不被公共 projection 抹平。
- [x] 未安装/未配置时返回 `runtime unavailable`，不得 synthetic PASS。

交付证据：`craftstation/src/supervisor/agents/kimi/`、
`craftstation/src/supervisor/runtime/nativeHarness/nativeHarnessProviderFixtures.test.ts`。
