# v0.9/T08 — Real Codex → Grok → Codex Continuation Acceptance

## Goal

用真实官方 Runtime 证明同 Thread、同 workspace 的跨 Harness continuation，并关闭 Feature-level evidence gate。

## Scope

- Codex 多轮与真实 workspace read/change。
- After-turn 切 Grok，验证 checkpoint 理解与真实 response。
- Grok 产生新内容后切回新的 Codex continuation Segment。
- Abort、target failure rollback、late event、restart recovery、credential scan 与既有 Harness/Fork regression。

## Depends On

T07。

## Acceptance

- [ ] 三段均为官方 Runtime non-synthetic response。
- [ ] 目标理解 task/state/decisions/relevant workspace facts。
- [ ] `Codex A -> Grok B -> Codex C` 中 C 是新 Segment/native Session。
- [ ] restart 后唯一 active binding 正确。
- [ ] abort/rollback/late-event 场景有独立证据。
- [ ] artifacts 无凭据；未验证 Provider/Harness 不升格。
- [ ] Debugger 独立验收，不以 Coder self-check 代替 PASS。

## Evidence

Debugger report、脱敏 events/checkpoints、真实响应摘要、tests/static checks/build 与原生 Electron 最短手工验证路径。
