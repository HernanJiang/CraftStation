# 03 — Codex Native Baseline Guard

**What to build:** 固化 v0.3 官方 Codex app-server 为五 Harness 兼容性 baseline，确保新 seam 不改变 Codex 的原生 session、stream、tool、permission、MCP、Skills、subagent、context/compaction 行为。

**Blocked by:** 02 — Common Runtime Seam & Native Recipe Contract

**Status:** completed

- [x] Codex 通过 CraftStation-owned adapter 进入 `Crafting -> Runtime -> Entity -> Session` contract；真实 response 仍需 opt-in smoke。
- [x] native thread/session identity、resume、multi-turn、stream、interrupt、cleanup 有 contract/fixture evidence。
- [x] 现有 official app-server path 无 legacy PoraCode/API-proxy fallback。
- [x] Codex 原生能力在公共 UI 与 native-specific projection 中不被静默丢弃。

交付证据：`craftstation/src/supervisor/runtime/nativeCodex/nativeCodexRuntimeAdapter.ts`、
`craftstation/src/supervisor/runtime/nativeCodex/nativeCodexBaselineGuard.test.ts`。
