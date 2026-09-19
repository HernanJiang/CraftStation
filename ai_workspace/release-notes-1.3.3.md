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
