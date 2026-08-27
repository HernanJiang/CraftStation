# 08 — Tokscale adapter 与 packaging

**What to build:** 将 Tokscale 或等价 scanner 通过正式 deep module 接入，完成能力探测、版本/二进制定位、profile scope、normalization 和打包验证。

**Blocked by:** 01 — Audit baseline 与迁移契约；06 — Identity、alias 与 Account Row 2×2；07 — Account-scoped quota/status/reset

**Status:** ready-for-agent

- [ ] `inspectCapabilities()`/`scan(scope)` 通过统一 contract 工作
- [ ] TokenUsage 标记 exact/derived/estimated 并执行 provenance/dedup
- [ ] dev 与 packaged build 均能定位 helper/scanner
