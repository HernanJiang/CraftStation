# 06 — Native Capability Matrix 与 Readiness

**What to build:** UI 和诊断面能准确显示两个 Harness 的官方能力、已集成能力、原生不支持能力和当前不可用状态，不以 fixture 或 adapter 存在冒充 PASS。

**Blocked by:** 04 — Native Event 与 Lifecycle Canonicalization; 05 — CraftPlan Runtime Configuration Propagation

**Status:** ready-for-agent

- [ ] 更新 transport、capability 和 readiness descriptor
- [ ] 对未安装、未认证、协议不匹配提供稳定状态
- [ ] 兼容未知 CLI/SDK 版本并保留证据
- [ ] 不把 Antigravity stream-json 标为 ACP/JSON-RPC
