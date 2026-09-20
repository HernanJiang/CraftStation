# CraftStation v1.4.1 — 号池轮换、渠道切换与方舟修复

## 用户可见

- crafted 会话补上同回合号池轮换：Grok / Kimi / Codex / Antigravity 订阅号额度耗尽时自动切到同池下一可用号并弹 toast，只剩空池才报错；已知死绑定直接跳过，不再烧一次失败。
- 第三方渠道（ChatGPT 等经中转的模型）同模型自动切换：渠道额度用尽或被限流时切到服务同一模型的下一验证渠道；坏 key、未知模型、坏请求保持 fail-closed。单渠道即单行号池，走一遍后诚实报错，不做单账号特殊路径。
- 火山方舟渠道的 Kimi 模型可用：方舟 coding 端点拒收 Responses 负载时，自动在同一渠道翻到 chat_completions 并重放（每回合最多翻一次），无需改配置。
- Grok 403 带配额文案时同样会切号；`permission-denied: I can't help…` 类内容拒绝原文透出，不重试不换号（换号也会原样再拒）。
- resume 时 stored 死绑定自动回退（订阅走池、渠道走下一验证渠道），不再重启即砖；Stop 并发的竞态回合静默丢弃。

## 实现

- crafted lane 新增 `runCraftedTurnWithPoolFailover`（tried 集合、6 次上限、epoch 守卫、segment 原位更新 binding）；`createCraftingAdapter` 支持排除集与第三方协议覆盖。
- 第三方渠道调度：同模型 + 协议一致 + 行序，额度死行冷却（复用 6h 家规 TTL，不写 store），限流只转不记。
- 共用 `runtime/poolQuota.ts` 分发 matcher（传统 lane 改引，零行为变化）；Grok 403 配额投影复用 402 通路。
- Kimi provider 表支持 responses ↔ chat 重写（仅 kimi，grok/deepseek 的 env 本就无类型）。

## 验证

- 新增定向用例 60+：crafted 订阅 9、crafted 渠道 7（含翻转后 config 实为 chat）、legacy 渠道 8、复现 4、matcher 与渠道查询 20+；全部通过。
- `runtime.test.ts` 124、threadSession 等 31 文件 442 例全过；`pnpm typecheck` + `pnpm lint` PASS。
- 真实证据：用户方舟渠道隔离 home 的 Kimi CLI 日志（Responses 400 ×7）与翻转后 chat 配置已在测试中复现验证；其余为 mock 覆盖，外部全量验收仍以用户为准。

Windows x64 提供 NSIS 安装版和便携版。

---

# CraftStation v1.4.1 — Pool rotation, channel switching and Ark fix

## User-facing

- Crafted sessions now rotate within the turn when a Grok / Kimi / Codex / Antigravity subscription account runs dry: the next usable row takes over with a toast, and only a truthfully empty pool surfaces the error. Already-dead bindings are skipped without burning a turn.
- Third-party channels (ChatGPT and other relayed models) switch automatically to the next validated channel serving the same model on quota exhaustion or throttling; bad keys, unknown models and bad requests stay fail-closed. A single channel is a one-row pool: it is tried once, then the original error surfaces — no single-account special path.
- Volcengine Ark channels work with Kimi models: when the Ark coding endpoint rejects the Responses payload, the Kimi provider table flips to chat_completions on the same channel and replays (at most one flip per turn), no configuration change needed.
- Grok 403 responses carrying quota wording now rotate as well; `permission-denied: I can't help…` refusals surface verbatim with no retry and no rotation (another account would refuse identically).
- Resume with a dead stored binding falls back automatically (pool for subscriptions, next validated channel for relays) instead of bricking the thread; turns raced by an explicit Stop are dropped silently.

## Implementation

- Crafted lane adds `runCraftedTurnWithPoolFailover` (tried set, 6-attempt cap, epoch guard, in-place segment binding update); `createCraftingAdapter` accepts exclusion sets and a third-party protocol override.
- Third-party channel scheduling matches model plus protocol in row order; quota-dead rows cool down (shared 6h house TTL, never store-marked); throttling rotates without marking.
- Shared `runtime/poolQuota.ts` dispatch matchers (legacy lane reuses them with no behavior change); Grok 403 quota responses reuse the 402 projection path.
- Kimi provider tables support responses ↔ chat rewrites (Kimi only; Grok/DeepSeek env carries no type).

## Verification

- 60+ new targeted tests: 9 crafted subscription, 7 crafted channel (including asserting the flipped config is chat), 8 legacy channel, 4 production-shape reproductions, 20+ matcher and catalog tests; all passing.
- `runtime.test.ts` (124 tests) and 31 threadSession-family files (442 tests) all pass; `pnpm typecheck` and `pnpm lint` pass.
- Live evidence: the reporter's isolated Kimi CLI log (7× Responses 400s on Ark) and the flipped chat config are reproduced in tests; remaining coverage is mock-based and awaits user acceptance.

Windows x64 NSIS and portable artifacts are provided.
