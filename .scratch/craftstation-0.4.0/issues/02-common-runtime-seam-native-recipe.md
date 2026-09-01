# 02 — Common Runtime Seam & Native Recipe Contract

**What to build:** 形成跨五 Harness 的最薄 runtime interface，使 Native Recipe/CraftPlan 能绑定 workspace、profile/environment 并执行 start/resume/send/interrupt/dispose，同时保留 native event 与 capability 语义。

**Blocked by:** 01 — Native Harness Audit & Compatibility Matrix

**Status:** completed

- [x] `crafting -> CraftPlan -> harness-runtime -> Entity -> Session` contract 可测试。
- [x] 公共 interface 不拥有 Agent Loop、Skills、MCP、Subagents、Permissions 或 Context 实现。
- [x] provider Adapter 可独立持有 protocol、transport、session mapping、event parser、capability、auth、error、version。
- [x] native envelope/诊断引用和稳定错误 code 可跨 UI/IPC 传递。
- [x] architecture guard 阻止 renderer deep-import implementation、CLIProxyAPI execution 与 provider if/else 扩散。

交付证据：`craftstation/src/shared/crafting/runtimeInterface.ts`、
`craftstation/src/shared/crafting/nativeHarness.ts`、
`craftstation/src/shared/crafting/nativeHarnessArchitectureGuard.test.ts`。
