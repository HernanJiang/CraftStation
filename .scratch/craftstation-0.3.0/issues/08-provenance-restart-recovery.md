# 08 — Composition Provenance 与重启恢复

**What to build:** 应用重启后可以根据不可变 CraftPlan provenance、Runtime/protocol identity 和官方 Thread ref 恢复同一 Entity/Session。

**Blocked by:** 07 — MCP、Skills 与高级原生能力

**Status:** done

- [x] 重启后可从持久化记录 resume 同一官方 Thread 并继续新 Turn。
- [x] 恢复后的 model、settings、usage 与 provenance 可解释且不被静默重写。
- [x] 缺失或损坏记录不会生成错误 Composition。
- [x] protocol/runtime incompatibility 有稳定错误和用户可执行 remediation。
- [x] 不持久化 credential、Token、Cookie 或完整敏感 Prompt。
- [x] persistence tests 覆盖版本迁移与 legacy v0.1 provenance 的明确处理。
