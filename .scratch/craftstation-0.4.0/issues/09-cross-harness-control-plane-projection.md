# 09 — Cross-Harness Control Plane & Native Capability Projection

**What to build:** 将已选择的 Account/Profile/Environment、权限控制、MCP/Skills 入口、诊断与公共 UI shell 贯通五个 Adapter，同时保留 provider-specific native semantics。

**Blocked by:** 08 — Five-Harness Entity/Session/Lifecycle Acceptance

**Status:** completed

- [x] Harness Runtime 只消费已解析的 profile/environment，不负责账号排序、额度 fallback 或账号池策略。
- [x] Renderer 不 spawn process；公共 shell 通过 typed IPC 获取安全投影，native runtime 仍由 Supervisor 管理。
- [x] native event envelope、capability descriptor、auth/rate-limit/error/diagnostic 在安全 UI/IPC projection 中可解释。
- [x] 不构建 Universal Skill/MCP/Subagent/Permission/Context runtime，不引入 CLIProxyAPI execution path。

交付证据：`src/supervisor/runtime/nativeHarness/controlPlane.ts`、
`src/supervisor/runtime/nativeHarness/controlPlane.test.ts`、
`src/shared/ipc/procedures/nativeHarness.ts`。
