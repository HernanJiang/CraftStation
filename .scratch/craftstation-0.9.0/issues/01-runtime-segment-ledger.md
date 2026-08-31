# v0.9/T01 — Expand Durable Runtime Segment Ledger

## Goal

建立多 Runtime Segment history 与唯一 active binding epoch 的持久化基础，同时保持旧 Thread 行为。

## Scope

- Segment schema、DB migration、repository API 与 initial Segment lazy bootstrap。
- ordinal、bindingEpoch、status、CraftPlan/provenance、Entity/native Session refs 和 lifecycle timestamps。
- restart recovery 与脱敏 persistence。

## Depends On

None。

## Acceptance

- [ ] migration 与 lazy bootstrap 幂等。
- [ ] 同一 Thread 不能持久化两个 active Segment。
- [ ] 重启恢复 Segment order、active epoch 和 native refs。
- [ ] 既有单 Session regression 不变。
- [ ] 不持久化 credentials。

## Evidence

Schema/migration/repository focused tests、restart fixture、credential scan 与 diff check。
