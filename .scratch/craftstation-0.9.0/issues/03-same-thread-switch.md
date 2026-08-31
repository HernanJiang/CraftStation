# v0.9/T03 — First Same-Thread Safe Switch Tracer Bullet

## Goal

完成 idle Codex Segment 到 Grok Segment 的 Supervisor-owned 同 Thread vertical slice。

## Scope

- 最小 `requestSwitch` Interface 与 per-thread lock。
- Target preflight、spawn/bootstrap/readiness。
- 最小 active epoch CAS、source deactivation、failure rollback 与原 timeline event provenance。

## Depends On

T01、T02。

## Acceptance

- [ ] Thread ID 与 workspace 不变。
- [ ] target Ready 前不成为 active。
- [ ] activation 后 Prompt 只进入 target epoch。
- [ ] target failure 时 source 仍 active 或可恢复。
- [ ] 任一路径无双 active writer。

## Evidence

Supervisor integration tests、adapter failure tests 与受控非 synthetic tracer evidence。
