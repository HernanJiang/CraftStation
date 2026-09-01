# v0.9/T04 — Queue Switch at Turn Boundary

## Goal

实现 busy Runtime 默认排队，并在当前 Turn 的真实 safe boundary 自动切换。

## Scope

- Safe-boundary detector。
- Queued、cancel 与 replace-latest semantics。
- Tool/permission/question/request/steer/subagent/compaction gates。
- Next-Prompt routing guard。

## Depends On

T03。

## Acceptance

- [ ] working Turn 中请求只进入 queued。
- [ ] completed Turn 持久化后自动开始 handoff。
- [ ] 任一 pending/active gate 阻止 activation。
- [ ] 新 Prompt 不抢跑给旧 Segment。
- [ ] queued request 可取消或可审计地 replace latest。

## Evidence

状态机、并发、boundary、cancellation 与 routing focused tests。
