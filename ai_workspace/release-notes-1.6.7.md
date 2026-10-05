# CraftStation v1.6.7

## 用户可见

- **合成台与配方页面改版**：底部「模型」和「Harness」的方格与 3×3 合成台的格子一样大；右侧整栏改为「原料」，MCP 服务器、Skills 和策略都用同尺寸的原料格展示，并带启用状态点；右栏加宽，「合成结果 / 配方」一栏缩窄约一半，腾出的空间给原料栏；各区块统一为同一种卡片外观。
- **终端大量输出更省资源**：构建日志、安装、`cat` 大文件等突发输出按帧合批，supervisor 的 CPU 占用约减半，主进程几乎不再被拖累，滚动时界面更跟手。
- **启动不再随历史数据变慢**：数据库的例行清理（过期用量记录、旧输出压缩）改在启动后执行，不再挡在窗口出现之前。
- **Windows：回收终端退出后遗留的进程**：关闭终端或 Agent 线程后，自动回收能够唯一匹配到该会话的 conhost.exe（每个约 11MB）。
- **强制关闭 / 崩溃后的后台退出保护**：生产环境也会检测主进程是否退出，并关闭 supervisor，减少后台 Agent、终端和辅助服务长期残留。
- **号池限额自动换号**：ChatGPT 账号达到 usage limit 后，线程自动切换到号池中的下一个账号并重放当前提示，不再把限额错误直接抛给用户。
- **跨 Harness 权限保持**：线程在不同 Agent 间切换时保留「完全访问权限」，不再因为两边权限叫法不同（bypass/auto 等）被静默降级成「请求批准」。

## 实现

- ConPTY：node-pty 1.1.0 在客户端退出时不会关闭伪控制台，之后调 `pty.kill()` 也是空操作。改为保留 taskkill 树杀，再按 spawn 时间窗唯一匹配 supervisor 名下的 conhost 并回收；匹配不唯一时只记日志、不杀（`conptyConhostReaper.ts`）。
- `thread-output`：在 pty.onData 绑定处按会话做 16ms 合批（`PtyOutputBatcher`）；一批只走一次原有的解析 / 转录 / 发送路径，退出前先 flush。
- 数据库：新增 migration 47，给 `usage_events(ts)` 建索引；runtime 输出压缩和 retention 清理从 `initDatabase` 移出，启动 10s 后执行，失败带结构化日志。
- 进程生命周期：supervisor 的 orphan watchdog 改为生产环境也启用（1s 轮询，最坏 5s 内退出）；JobObject helper 启动失败、运行中退出、分配失败三种情况都输出带稳定错误码的结构化日志。
- 工具链：oxlint 的 ignore 改为只匹配根目录的 `/main`，`src/main/**` 重新纳入 lint，顺带修掉由此暴露的历史 lint 问题（行为不变）。
- 号池 failover：Codex 的配额错误常在 `turn/completed(failed)` 结算之后才经 `thread/error` 到达，或在 sibling turn 仍被追踪时到达——原闸门要求 turn 仍存活，配额文本被去重烧毁而 failover 永不触发。改为按 live turn 自身的 failed completion 锚定 15 秒宽限；同时修复额度轮询刷新 `quota-exhausted` 时误抹 `lastError` 导致推理标记失去 6 小时保护、死账号被翻回 `available` 重新当选的问题。

## 验证

- managed mock 会话，同一脚本测改前 → 改后：20k 行输出事件数 19,501 → 123，supervisor CPU 136% → 67%（单核占比），main 44% → 2%；scrollback 与输出流一致。
- 关闭 5 个 shell 以及 shell 自然退出后，conhost 残留均为 0；`taskkill /F` 主进程后，supervisor 子树 354ms 内全部退出。
- `initDatabase` 耗时：1 万条用量 / 1 千条 item 为 3.25ms，20 万 / 2 万为 3.68ms，基本不随表规模增长；`EXPLAIN QUERY PLAN` 确认 retention 删除走 `idx_usage_events_ts`。
- typecheck 通过；本轮合成台及 changelog 相关测试 13 文件、79 项通过。普通及 type-aware lint 排除既有未跟踪临时文件后通过；原始 `pnpm lint` 仍有 3 个既有错误（`packages/codex-protocol/generated.tmp/**` 两个、`ai_workspace/probe-chunks.cjs` 一个）。
- 全范围 managed mock 冒烟通过，renderer console/runtime 错误 0；浏览器页面有一张截图超时，其余功能检查及截图通过。该模式不代表真实账号、设备或模型推理验收。
- 合成台实测：模型、Harness、MCP、Skills 均为 72×72；选择模型及 Harness、合成保存配方、清空均通过；已保留 1280 宽与默认宽度截图。

---

# CraftStation v1.6.7

## User-facing

- **Crafting workbench redesign**: model and harness cells now match the 3×3 grid's slot size; the right column becomes an "Ingredients" panel where MCP servers, skills and policies appear as same-size ingredient slots with an enabled-state dot; the right column is wider and the result / recipes column is about half as wide to make room; every block shares one card style.
- **Lighter terminal output**: bursts of output (build logs, installs, large files) are delivered in frame-sized batches, cutting supervisor CPU roughly in half and taking almost all of the load off the main process, so scrolling stays smooth.
- **Startup no longer slows with history**: routine database cleanup (expired usage events, old output compaction) now runs after launch instead of before the window appears.
- **Windows: reclaim leftover console hosts**: after a terminal or agent thread exits, CraftStation reclaims a conhost.exe (about 11 MB each) when it can be uniquely matched to that session.
- **Background shutdown protection after a force-close or crash**: production builds now detect when the main process exits and shut down the supervisor, reducing lingering background agents, terminals and helper services.
- **Automatic account-pool failover**: when a ChatGPT account hits its usage limit mid-task, the thread rotates to the next pool account and replays the prompt instead of stopping on the error.
- **Permissions preserved across agents**: switching a thread between agents keeps full access — it no longer silently drops to Ask for approval because the two agents spell the permission differently (bypass/auto and friends).

## Implementation

- ConPTY: node-pty 1.1.0 does not close the pseudoconsole when the client exits, and a later `pty.kill()` is a no-op. The taskkill tree kill stays, and the conhost under the supervisor is then reaped by a unique match against the spawn time window; non-unique matches are logged and never killed (`conptyConhostReaper.ts`).
- `thread-output`: 16 ms per-session batching at the pty.onData bindings (`PtyOutputBatcher`); each batch runs the existing parse / transcript / emit path once, and pending output is flushed before exit handling.
- Database: migration 47 adds an index on `usage_events(ts)`; runtime output compaction and retention pruning moved out of `initDatabase` and run 10 s after startup, with structured failure logs.
- Process lifecycle: the supervisor orphan watchdog now also runs in production builds (1 s polling, worst case under 5 s); Job Object helper start failure, runtime exit and assignment failure all emit structured logs with stable error codes.
- Tooling: the oxlint ignore now matches only the root-level `/main`, so `src/main/**` is linted again, and the lint debt this uncovered is fixed without behavior changes.
- Pool failover: Codex's quota error often lands on `thread/error` after the failed `turn/completed` already settled, or while a sibling internal turn is still tracked — the old gate required the turn to still be live, so the text was deduped away and failover never fired. A 15 s grace now anchors on the live turn's own failed completion. The quota poller also no longer wipes `lastError` when refreshing `quota-exhausted`, which had silently stripped the inference mark's 6 h protection and let dead accounts flip back to `available` and get re-elected.

## Verification

- Managed mock session, same script before → after: 20k-line burst 19,501 → 123 events, supervisor CPU 136% → 67% of one core, main 44% → 2%; scrollback matches the output stream.
- Zero conhost left after closing 5 shells and after a natural shell exit; `taskkill /F` of the main process takes the supervisor subtree down in 354 ms.
- `initDatabase` takes 3.25 ms at 10k usage events / 1k items and 3.68 ms at 200k / 20k, essentially flat across table sizes; `EXPLAIN QUERY PLAN` confirms the retention delete uses `idx_usage_events_ts`.
- Typecheck passes; this round's workbench and changelog tests pass across 13 files and 79 tests. Regular and type-aware lint pass with existing untracked temporary files excluded; the unfiltered `pnpm lint` still reports 3 existing errors (two in `packages/codex-protocol/generated.tmp/**`, one in `ai_workspace/probe-chunks.cjs`).
- Full managed mock smoke passes with zero renderer console/runtime errors; one embedded browser screenshot timed out while the other functional checks and screenshots passed. This mode does not validate real accounts, devices or model inference.
- Workbench measurements confirm that model, harness, MCP and skill slots are all 72×72; selecting a model and harness, crafting and saving a recipe, and clearing the grid pass. Screenshots are retained at 1280 and default window widths.
