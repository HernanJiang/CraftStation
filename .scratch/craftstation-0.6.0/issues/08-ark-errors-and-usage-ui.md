# 08 — Ark Error Mapping & Usage Projection

**What to build:** 将 Ark collector 的认证、签名、无效凭据、限流、额度耗尽、网络和服务不可用状态映射为稳定 Usage 状态，并在现有 usage IPC/UI 显示脱敏窗口、reset 与错误提示。

**Blocked by:** 07 — Ark Token Plan Collector & Parsers

**Status:** ready-for-agent

- [ ] 每类 provider failure 映射到稳定 code/status，区分可重试与不可重试。
- [ ] UI/IPC 仅接收 normalized UsageSnapshot，不显示 raw provider response。
- [ ] 窗口、reset、plan identity 与错误状态在 provider catalog 中可查询。
- [ ] renderer、main IPC 和 collector 回归测试覆盖主要错误路径。
