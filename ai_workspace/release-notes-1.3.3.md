# Release 1.3.3 — Crossagents 统一寻址与 Devin 对等体支持

## 用户可见

- **跨线程消息可以用侧边栏 UUID 直接寻址**：Crossagents 的 `send_message` / `ask` / `get_peer` / `switch_peer_model` / `stop_peer` / `reply` 目标参数现在除了 `harness:nativeId` 地址（如 `kimi:K456`）外，也接受线程的侧边栏 UUID（或 `thread:<uuid>` 形式）——三种写法指向同一条会话，绝不复制出第二个 native session。
- **计划任务与 Crossagents 共享同一寻址空间**：Schedule 的 `threadTarget` / `targetThreadId` 同样接受侧边栏 UUID、`thread:<uuid>` 或 `harness:nativeId`，经同一解析器归一为线程 UUID 后落库；`get` / `list` / `list_runs` 现在返回每个任务/运行的 `boundThreadId` 与 `peerAddress`，便于核对绑定对象。
- **Devin 线程成为一等对等体**：`devin` 加入 native-messaging 范围，`spawn_peer` 可直接创建 `harness:"devin"` + `model:"swe-2-max"` 的线程；模型推断识别 `swe-*` / `cognition` / `devin` 字样，省略 harness 时 `swe-2-max` 自动落到 devin，`switch_peer_model` 跨 harness 切到 swe 模型同理。
- **分离式计划任务自动登记 peer 地址**：`threadTarget {kind:"new"}` 触发的运行线程在拿到 native session id 后自动绑定 `harness:nativeId` 地址，之后可被其他线程直接寻址发消息；绑定失败不影响运行本身。
- **计划任务的 agentKind/harnessItemId 提前校验**：显式指定的 `agentKind` 或 `harnessItemId` 若未注册对应 harness item，创建/更新时即报错（提示改用已探测到的 harness），不再等到触发时才失败或静默回落到调用线程的 harness。

## 实现

- `shared/nativeThreads.ts` 新增 `parseThreadUuidReference`：识别裸 UUID 与 `thread:<uuid>` 两种侧边栏引用形式。
- `InterHarnessMessageBus`：`resolveAddress` / `resolveExistingAddress` / `getPeer` 接受 UUID 引用；新增 `resolvePeerTarget`（Crossagents/Schedule 共用入口）、`peerAddressForThread`（只读取地址）、`bindNativeAddressForThread`（轮询等待新线程的 session id 并落绑定）。UUID 解析时顺带把合成地址写入绑定表，此后两种拼写收敛到同一行。
- `nativeThreadIndex`：`NATIVE_MESSAGING_HARNESSES` 加入 `devin`；`inferNativeHarnessFromModel` 识别 `swe` / `swe-*` / `cognition` / `devin`。
- Schedule MCP：`scheduleThreadTargetInputSchema` 放开 `existing.threadId` 的 uuid-only 限制，`resolveExistingThreadRef` 统一归一；`serializeTask` / `serializeRun` 注入 `boundThreadId` + `peerAddress`；`assertExplicitHarnessRegistered` 在 create/update 时校验注册表。
- `ScheduleRunCoordinator`：native 与 legacy 两条触发路径均 fire-and-forget 调 `bindRunThreadAddress`（由 `main.ts` / `createHeadlessRemoteHost.ts` 惰性接到 bus），绑定异常绝不使运行失败。
- `ScheduleMcpIngress` 新增 `resolvePeerTarget` / `peerAddressOfThread` 两个可选依赖，生产环境统一接到 `appControlsMcpIngress.getInterHarnessMessageBus()`。

## 验证

- 新增测试全过：`interHarnessMessageBus.test.ts` 新增 7 例（devin spawn/推断、三种拼写同会话、未绑定 app 线程 UUID 解析、无匹配 UUID fail-closed、stop_peer UUID 接受/自删拒绝）、`schedules.test.ts` 扩至 20 例、`ScheduleRunCoordinator.test.ts` 扩至 24 例、`nativeThreadIndex.test.ts` +`getNativeBindingByThread` 与 devin 推断、`toolRegistry.test.ts`（crossagents）9 例。
- `pnpm typecheck` PASS；pre-commit oxlint type-aware + oxfmt + tsc 全过。
- 既有基线：`interHarnessMessageBus.test.ts` 3 例失败（Test H / ask timeout / Test I，busy 目标应 queued 实为 delivered）经 stash 对照证实为 HEAD 既有问题，与本批无关（busy 判定在 `ThreadCollaborationService`，未触碰）。

---

# Release 1.3.3 — Crossagents unified addressing & Devin peer support

## User-facing

- **Cross-thread messaging now accepts sidebar UUIDs**: the `send_message` / `ask` / `get_peer` / `switch_peer_model` / `stop_peer` / `reply` target parameters accept a thread's sidebar UUID (or the `thread:<uuid>` form) in addition to `harness:nativeId` addresses (e.g. `kimi:K456`) — all three spellings name the same conversation and never duplicate a native session.
- **Schedules share the Crossagents address space**: Schedule `threadTarget` / `targetThreadId` accept the same three spellings, canonicalized to the thread UUID through the same resolver before persistence; `get` / `list` / `list_runs` now report each task/run's `boundThreadId` and `peerAddress` so you can verify the binding.
- **Devin threads are first-class peers**: `devin` joined the native-messaging scope — `spawn_peer` can create a `harness:"devin"` + `model:"swe-2-max"` thread directly; model inference recognizes `swe-*` / `cognition` / `devin` markers, so omitting the harness with `swe-2-max` lands on devin, and cross-harness `switch_peer_model` to a swe model works the same way.
- **Detached schedule runs self-register their peer address**: threads fired by `threadTarget {kind:"new"}` bind their `harness:nativeId` address as soon as the native session id appears, so other threads can address them right away; a binding failure never fails the run.
- **Schedule agentKind/harnessItemId validated up front**: an explicit `agentKind` or `harnessItemId` with no registered harness item now fails at create/update time with a clear message (suggesting a detected harness), instead of failing at fire time or silently drifting onto the calling thread's harness.

## Implementation

- `shared/nativeThreads.ts` gained `parseThreadUuidReference`, recognizing bare UUIDs and the `thread:<uuid>` sidebar reference forms.
- `InterHarnessMessageBus`: `resolveAddress` / `resolveExistingAddress` / `getPeer` accept UUID references; new `resolvePeerTarget` (the shared Crossagents/Schedule entry), `peerAddressForThread` (read-only address lookup), and `bindNativeAddressForThread` (polls for a fresh thread's session id and writes the binding). UUID resolution also records the synthesized address binding, so both spellings converge on the same row from then on.
- `nativeThreadIndex`: `NATIVE_MESSAGING_HARNESSES` gained `devin`; `inferNativeHarnessFromModel` recognizes `swe` / `swe-*` / `cognition` / `devin`.
- Schedule MCP: `scheduleThreadTargetInputSchema` relaxed the uuid-only restriction on `existing.threadId`, canonicalized by `resolveExistingThreadRef`; `serializeTask` / `serializeRun` inject `boundThreadId` + `peerAddress`; `assertExplicitHarnessRegistered` checks the registry at create/update.
- `ScheduleRunCoordinator`: both fire paths (native craftAgent and legacy) fire-and-forget `bindRunThreadAddress` (wired lazily to the bus in `main.ts` / `createHeadlessRemoteHost.ts`); binding failures never fail the run.
- `ScheduleMcpIngress` gained the optional `resolvePeerTarget` / `peerAddressOfThread` deps, wired in production to `appControlsMcpIngress.getInterHarnessMessageBus()`.

## Verification

- New tests all green: `interHarnessMessageBus.test.ts` +7 cases (devin spawn/inference, three spellings → same conversation, unbound app-thread UUID resolution, unmatched UUID fails closed, stop_peer accepts UUID / refuses self-delete), `schedules.test.ts` now 20, `ScheduleRunCoordinator.test.ts` now 24, `nativeThreadIndex.test.ts` +`getNativeBindingByThread` and devin inference, crossagents `toolRegistry.test.ts` 9.
- `pnpm typecheck` PASS; pre-commit oxlint type-aware + oxfmt + tsc all green.
- Pre-existing baseline: 3 `interHarnessMessageBus.test.ts` failures (Test H / ask timeout / Test I — busy target should queue but delivers) confirmed pre-existing on HEAD via stash comparison, unrelated to this batch (the busy check lives in `ThreadCollaborationService`, untouched).
