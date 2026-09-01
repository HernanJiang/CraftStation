# 06 — Ark Credential Contract

**What to build:** 建立 Volcengine Ark Token Plan 的 provider-native credential 契约，支持 API Key 与 AK/SK V4 两种模式、Coding Plan/Agent Plan 选择和安全存储；所有字段以 T01 官方核验为准。

**Blocked by:** 01 — Baseline Audit & Execution Gate

**Status:** ready-for-agent

- [ ] API Key、Access Key/Secret Key、region/endpoint 等字段按官方事实校验。
- [ ] Coding Plan 与 Agent Plan 的选择和 capability inspection 有明确状态。
- [ ] 凭据只进入主进程安全存储/provider seam，不进入 renderer、日志或提交。
- [ ] 缺失、无效、冲突凭据有稳定错误语义和测试。
