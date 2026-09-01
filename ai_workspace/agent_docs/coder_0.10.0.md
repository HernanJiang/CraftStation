# Coder Delivery — v0.10.0 Cross-Thread Model × Harness Dialogue

## Verdict

`T01–T07 IMPLEMENTED / FEATURE SELF-CHECK COMPLETE / T08 REAL ACCEPTANCE BLOCKED / READY FOR DEBUGGER`

本交付完成了 CraftStation-owned Thread Collaboration Module 及其 Desktop IPC、App Controls MCP、remote/headless 和 Renderer 投影。工程证据支持交给 Debugger 独立验收，但不支持把 Feature 或 T08 宣称为 PASS：当前没有真实 Codex source thread → Grok target thread → official Runtime reply → follow-up，也没有第二 Harness route、真实 Electron restart/recovery 或真实 provider credential 证据。

## Worktree Guard

- Product Git Root：`D:\Work\CraftStation`
- 唯一修改位置：`D:\Work\CraftStation\.worktrees\v0.10-cross-thread-collaboration`
- 实际分支：`dev/v0.10-cross-thread-collaboration`
- Plan baseline / 当前未提交实现的基线 HEAD：`0bbba5f66e5b7be782443206c02781ed6825ba77`
- `package.json` / `pnpm-lock.yaml`：无修改
- 未 merge main、未创建 tag、未 push

Manager 文档中的旧 `craftstation-dev\.worktrees` 路径、`feature/v0.10-...` 分支和旧 Dev baseline 已被项目 flat-worktree 迁移取代；本报告与 `PROJECT_STATUS.md` 使用 Git 实际状态。

## Ticket Delivery

### T01 — Thread Control Adapter

- 新增 `ThreadControlAdapter`，统一 live、idle、inactive-resumable、non-resumable、interrupt/stop confirmation 与 stable error 语义。
- legacy `send_to_thread` 保留工具合同，但通过 Thread Collaboration Module 投递，不再由 MCP handler 旁路复制 Supervisor/DB orchestration。
- working/attention target 的普通 delivery fail closed，不把 generic settled wait 误当作可发送状态。

### T02 — Idle Dialogue Tracer

- 新增 SQLite v37 schema、ConversationLink 与 ThreadExchange durable ledger。
- request 具有稳定 exchange id、request item anchor、delivery baseline 和 completed-turn reply anchor。
- reply 只接受目标 thread 在 delivery baseline 之后的 `completed` `assistant_message` anchor；不读取目标最后一条 message，不接受 reasoning/tool/streaming assistant item。
- source/target provenance 与 exchange view 可在双方 timeline 投影并互跳。

### T03 — Busy Queue and Ordering

- 默认 `after-current-turn` 对 working target durable queue，不 steer、不 interrupt。
- claim token、idempotency payload equality、expired-claim fail-closed 与 recovery 防止并发/重启重复发送。
- 同一 ConversationLink 按 sequence 串行，前一 exchange 未 settled 前后续 exchange 不投递。
- 支持 delivery 前取消；幂等重试在 queue limit 前解析；同 key 不同 payload 返回 `THREAD_COLLABORATION_IDEMPOTENCY_CONFLICT`。

### T04 — Interrupt, Attention and Failure

- `interrupt-and-send` 要求显式二次 UI 确认，并等待 official settled confirmation；stop confirmation 失败时不发送。
- `needs_approval` / `needs_reply` 投影为 durable `needs_attention`，不会 auto-answer；attention 清除后可重新入队。
- auth、quota、binary、capability、runtime、interrupt、delivery 与 uncertain claim 使用稳定、redacted error codes。
- wait timeout 不 interrupt target；delivery 后 cancel 只停止 source 等待/投影；late reply 仍可从 timed-out 状态被确定性捕获。

### T05 — Context and Provenance

- 默认 context capsule 为 null；只有显式 selection 才生成 portable context。
- context 先执行 API key、Bearer token、credential field 和 hidden-reasoning redaction，再应用 12,000 字符预算。
- provenance 包含真实可用的 Recipe、Model、Harness、native session、worktree identity；optional `RuntimeProvenanceResolver` 可补 v0.9 Segment/runtime epoch，无硬依赖。
- base resolver 对 agent-facing App Controls MCP support 默认 `false`；只有观察到实际 launch/acceptance 的 optional resolver 才可报告 `true`。
- cross-worktree target 显示警告，不暗示文件同步。

### T06 — App Controls MCP

- 新增 high-level `ask_thread`、`read_thread_exchange`、`wait_for_thread_reply`。
- 三个工具与 UI/IPC/remote 共用同一个 Thread Collaboration Module，不以 target latest message 猜 reply。
- legacy `send_to_thread` 映射到相同 delivery contract；Crossagents 保持独立 ephemeral subagent lane。
- self-target、cross-project、unauthorized actor/participant、causal loop 与 hop limit 均 fail closed。

### T07 — UI, Remote and Recovery

- Renderer 新增 target picker、Model/Harness/status/worktree filter、delivery mode、interrupt confirmation、context summary、exchange activity/card、cancel/wait/jump actions。
- 使用 HeroUI v3 compound components、`onPress` 和 ARIA label/listbox/option semantics；所有新增可见文案使用 Lingui macro。
- Desktop IPC、remote HTTP/client、remote procedure router、snapshot/projection、headless host 共享同一 policy/service，不允许 remote 绕过 same-project/participant policy。
- recover 扫描 created/queued/attention/delivered/working/timed-out 状态，expired claim 标记 delivery uncertain，避免 stale worker 覆盖或重复投递。

### T08 — Real Multi-Harness Acceptance

状态：`BLOCKED`。

缺失的必要证据：

- 真实 Codex source 与 Grok target 的 non-synthetic official Runtime request/reply/follow-up；
- busy queue、explicit interrupt failure、attention、restart、stale-worker 的真实 UI/runtime 行为；
- 第二 Harness route；
- managed Electron smoke 的 screenshot、runtime error 与 report artifacts。

`interactive-testing` 要求真实 Electron 验收走托管启动器并编译 runtime/native resources；Manager 当前暂停任何可能触发 native build/postinstall/protocol generation 的操作，因此 Coder 没有启动该路径。`provider-chat-smoke` 也要求真实 credential/provider session 证据，当前没有在安全范围内取得。以上均不得由单元测试或 mock 结果替代。

## Verification Evidence

### Focused tests

- Collaboration core：`5 files passed / 1 skipped`，`113 passed / 14 skipped`。
- 覆盖 Adapter、Service/Repository、provenance/context、runtime reply anchors、App Controls tool registry、UI status/a11y labels。
- Remote/IPC/migration 扩展组：五个独立文件最终 `195 passed`。
- `RemoteAccessServer.test.ts` 首轮有 1 个 `fetch failed / bad port`（Windows/Node 随机分配到 Fetch forbidden port）；单文件复跑 `82/82` 通过，没有源码修改来掩盖该环境抖动。

### Static checks

- `oxfmt --check`：46 个触及 TS/TSX 文件通过。
- `oxlint --deny-warnings`：46 个触及 TS/TSX 文件通过。
- `git diff --check`：通过。

### TypeScript boundary

直接调用已有 `tsc` 后，v0.10 触及范围没有 TypeScript error。全仓仍失败于：

```text
packages/codex-protocol/index.ts(8,8): Cannot find module './generated/index'
packages/codex-protocol/index.ts(9,15): Cannot find module './generated/v2/index'
node_modules/@craftstation/codex-protocol/index.ts: 同样缺失 generated 输出
```

其余 `src/supervisor/agents/codex/**` 错误是缺失 protocol exports 的级联。Manager 明确暂停 protocol generation；Coder 未生成、复制或伪造这些文件。

### Full-suite/build boundary

- 未运行 build：项目 build script 会进入被暂停的依赖/runtime 编译链。
- 一次直接全量 Vitest 意外触发既有 `prepare-server-native` / `better-sqlite3` rebuild；发现后立即中止测试及 `node-gyp`/MSBuild 子进程。
- 中止后确认没有 v0.10 路径的 native build/postinstall/protocol-generation 后台进程，Git 状态未新增产品文件，`package.json`/lockfile 无变化。
- worktree ignored `dist/server-native/build/better-sqlite3` 留下约 59 MB 构建中间物。根据 Manager “不要删除共享 store 或宽泛目录”的指令保留，未清理。

### i18n boundary

- collaboration UI 全部新增可见文案已进入 Lingui macro。
- 一次直接 `lingui extract` 显示 13 个 catalog 各约 150 条跨版本缺失，并机械改写大量与 v0.10 无关条目。
- 已精确撤销 locale catalog 的全部无关机械差异，避免把 v0.7/v0.8/v0.9 并行漂移混入本 Feature；未声称全仓 catalog 已同步或所有语言已翻译。

## Security Review

- exchange request、context、reply excerpt 和 diagnostics 在 durable persistence/projection 前执行 redaction/budget。
- context capsule 默认空，业务日志只输出 thread/exchange/status/error code，不输出 request/context/reply。
- 源码扫描仅命中预期 redaction regex、假 token 测试 fixture 与 stable auth error classifier；没有硬编码真实 credential。
- hidden reasoning 不进入 capsule/reply projection；`assistantText` 只读取 completed `assistant_message` 的 text blocks/streams。
- remote/IPC/MCP 所有入口均在共享 service 内执行 actor、participant、same-project、causal policy。

## Feature-level Self-check

- T01 → T07 dependency chain：完成，且核心与 remote/IPC/migration 定向回归通过。
- 默认 busy queue、不 stealth steer：完成。
- explicit interrupt confirmation/fail-closed：完成。
- deterministic reply correlation：完成。
- optional v0.9 adapter/no hard dependency：完成。
- credentials/hidden reasoning leakage：源码与测试证据未发现。
- T08 real acceptance：BLOCKED，未降级标准。
- Debugger 应独立复核所有实现，并保留 T08/TypeScript/full-suite/real-Electron 的证据边界；不能仅因 focused tests 通过就给 Feature PASS。

## Debugger Handoff

已创建目标任务：`Debugger-0.10-Cross-Thread Collaboration`，thread `01a057e4-fb70-7e52-b8a5-f68691c4c33f`，项目绑定 CraftStation，`grok-4.6 / high`，完整指令要求验收同一 worktree。Debugger 应首先读取 `PROJECT_STATUS.md`、本报告、Manager Plan、source review 与 T01–T08；独立检查源码、测试、真实运行可行性和 artifacts。Coder 不执行 merge、tag 或 push。

任务创建成功后，首个 turn 与一次同任务重试都在本地模型路由 `http://127.0.0.1:28082/v1/responses` 返回 `HTTP 422 Unprocessable Entity`，没有生成任何 Assistant message、源码 review、Findings 或 verdict。因此：

- Debugger 当前为 `INFRASTRUCTURE BLOCKED / NO VERDICT`；
- 不能把任务创建成功表述为 Debugger 已验收；
- 不能把路由错误表述为源码 FAIL；
- 路由恢复后应继续复用这个已配对任务，不创建第二个 Debugger；
- 在有效 Debugger verdict 之前，候选不做 merge/tag/push。
