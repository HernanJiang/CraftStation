# v0.9/T05 — Abort Current Turn and Transactional Rollback

## Goal

实现用户主动终止当前 Turn 后切换，并在任何失败阶段安全回滚和清理。

## Scope

- Official Runtime interrupt handshake 与 stopped confirmation。
- Phase-specific timeout/cancellation。
- Target prepare/start/bootstrap failure rollback。
- Correlation、stable error code 与 cleanup diagnostics。

## Depends On

T04。

## Acceptance

- [ ] interrupt 未确认时 fail closed。
- [ ] source stopped 后 target 失败可恢复 source，或给出明确不可恢复状态。
- [ ] 资源与 subscriptions 被清理。
- [ ] 始终最多一个 active writer。
- [ ] diagnostics 包含 phase、operation、code 与 rollback result。

## Evidence

Abort success/failure、target failure、timeout、cancel 与 resource-leak tests。
