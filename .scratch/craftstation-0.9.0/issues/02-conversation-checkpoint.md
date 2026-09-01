# v0.9/T02 — Build Versioned ConversationCheckpoint Projection

## Goal

从 canonical ledger 生成可预算、脱敏、可追溯的 portable continuation context。

## Scope

- Summary、state、decisions、important results、workspace changes、recent completed turns、anchors 与 provenance。
- Target-aware budget/truncation、schema migration 与 redaction。
- `extractContext` 只可作为可选摘要来源。

## Depends On

T01。

## Acceptance

- [ ] 默认不复制或注入全量 transcript。
- [ ] 固定 ledger 输入得到确定投影。
- [ ] 超预算按集中策略截断并保留 anchors。
- [ ] credentials、hidden reasoning、pending runtime handles 不出现。
- [ ] checkpoint 可追溯 source Segment/native ref。

## Evidence

Projection golden tests、budget boundary tests、secret negative tests 与 schema migration tests。
