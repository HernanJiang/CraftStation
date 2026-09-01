# 07 — DeepSeek / DSH Native Harness Re-audit & Integration

**What to build:** 重新核验最新官方 DeepSeek Harness/DSH upstream 与真实 native runtime boundary，接入 Native Harness；旧 `deepseek-harness/` 只读、superseded，不得复活。

**Blocked by:** 06 — Antigravity Native Harness

**Status:** completed

- [x] 记录当前 upstream、版本、安装/认证和 machine-facing runtime 证据。
- [x] Native Agent/Session/Tool/event/lifecycle 通过 CraftStation adapter 接入；运行时不可用时保留明确 unavailable adapter。
- [x] 禁止纯 Model API、OpenAI-compatible gateway 或 CLIProxyAPI 假装 Harness。
- [x] 原生能力差异、错误、协议 mismatch、crash、cleanup 与 unavailable reason 可审计。

交付证据：`ai_workspace/validation/v0.4.0-native-harness-audit.md`、
`src/supervisor/runtime/nativeHarness/nativeHarness.test.ts`。
