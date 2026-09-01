# 05 — CraftPlan Runtime Configuration Propagation

**What to build:** Model/Harness Recipe 生成的 CraftPlan 能把 workspace、model、profile/account binding、权限、MCP、Skills、context/compaction 和其他 runtime overrides 完整传递到两个 Native Adapter。

**Blocked by:** 04 — Native Event 与 Lifecycle Canonicalization

**Status:** ready-for-agent

- [ ] 不再只传 model
- [ ] Session sticky 绑定 provider session/account
- [ ] 新增缺失字段的 contract/validation 与回归测试
- [ ] Renderer 不接收凭据或原始 provider 配置
