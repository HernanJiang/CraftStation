# v1.6.7 性能热修：顺手修复与待确认项

基线：v1.6.6（`b5d820e0`）。本次提交：`f3a564cf` T-01、`250c78d9` T-03、`dc8e0da2` T-05、`cad043c5` T-08、`067ec88d` T-02。T-02 因 B2 的 hook 问题，经用户授权用 `--no-verify` 提交；提交前已手动跑过 oxfmt、typecheck、lint 和 migrations 相关测试。

## A. 顺手修复 / 相对 Brief 的偏离（均在任务模块内）

本次没有超出五项任务之外的独立顺手修复。以下是实现时相对 Brief 的偏离，每项都有证据：

| #   | 问题                                                             | 根因 / 证据                                                                                                                                                                                                                                                                                                                                                                                                                                      | 改动文件                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Brief 为 T-01 指定的"taskkill 后补 `pty.kill()`"不能回收 conhost | node-pty 1.1.0 `src/win/conpty.cc` 中，`SetupExitCallback` 在客户端退出时直接 `remove_pty_baton`，不调 `ClosePseudoConsole`；此后 `PtyKill` 找不到 baton，成为 no-op。探针 `ai_workspace/perf-audit/conpty-kill-order.cjs`（每轮 5 个 shell）实测：只 taskkill → 5 个泄漏；taskkill 再 `pty.kill()` → 5 个泄漏；先 `pty.kill()` 再 taskkill → 0 个泄漏，但 detached 子孙存活 5 个（taskkill 执行时 shell 已死，退出码 128）；自然退出 → 5 个泄漏 | 保留 taskkill 树杀，新增 `conptyConhostReaper.ts`：按 spawn 前后的 `Date.now()` 时间窗唯一匹配 supervisor 名下的 conhost 子进程后回收。探针 `conpty-spawn-window.cjs`：连续 spawn 12 次，12/12 精确唯一命中 |
| A2  | Brief 说"ptyExited 路径补一次幂等 `pty.kill()`"                  | 原因同 A1，在该路径上是 no-op                                                                                                                                                                                                                                                                                                                                                                                                                    | 自然退出也经 `PtyLifecycle.resolveExit` 走 reaper（e2e：自然退出后残留 0）                                                                                                                                  |
| A3  | migration 47 只建索引会让旧测试基线报错 `no such table`          | `migrations.test.ts` 用最小基线（v36）跑迁移，基线里没有 `usage_events`                                                                                                                                                                                                                                                                                                                                                                          | migration 47 先 `CREATE TABLE IF NOT EXISTS`，沿用 v45/v46 的写法；真实库上为 no-op                                                                                                                         |
| A4  | T-03 的延迟维护要能观测                                          | 需要输出 changes 计数                                                                                                                                                                                                                                                                                                                                                                                                                            | `dbCompactRuntimeOutputStreams` 改为返回更新行数；headless remote host 同样调用延迟维护                                                                                                                     |
| A5  | 原 watchdog 默认值最坏约 6s，达不到"5s 内退出"                   | 2s 轮询 × 2 次确认 + 2s 硬退出                                                                                                                                                                                                                                                                                                                                                                                                                   | 轮询间隔 2s → 1s；JobObject helper 运行中退出、supervisor 分配 Job 失败两处同样改为结构化日志（`windowsJobObject.ts`、`SupervisorClient.ts`）                                                               |

## B. 已确认、未修（超出本次模块范围，建议另行立项）

- **B1 其他 node-pty spawn 点同样泄漏 conhost**（机制与 A1 相同；已读代码确认，并由探针自然退出 / taskkill 两条路径佐证）：
  - `src/supervisor/oneShotSpawn.ts` `spawnAgentPty`（antigravity models 探测）：进程自然退出，win32 下超时走 taskkill；
  - `src/supervisor/crossagentMcp/oneShotChild.ts` PTY transport；
  - `src/supervisor/agents/acp/terminalManager.ts` ACP terminal：退出后再 `pty.kill()` 无效；
  - `src/supervisor/runtime/nativeHarness/ptyAdapter.ts` `terminate()`：进程已退出时无效。
  - 修法：各点记录 spawn 时间窗，退出时复用 `ConptyConhostReaper.schedule`。每个点都需要单独做 e2e，所以本次没有扩大改动面。
- **B2 【已修，`dbcddc33`，经用户要求】`.oxlintrc.json` / `.oxlintrc.type-aware.json` 的 `ignorePatterns: ["main"]` 会匹配任何名为 `main` 的路径段**：结果整个 `src/main/**` 不在两遍 oxlint 的覆盖范围内；pre-commit 时如果暂存区只有 `src/main/**` 文件，会报 "No files found to lint"。这一项原本是 1.0.2（`6d40cea0`）为忽略根目录 `/main/` 残留目录加的，写法没锚定。现已改为 `"/main"`：实测根目录 `main/` 仍被忽略，`src/main` 恢复被 lint。解除忽略后冒出的 lint 债一并按不改行为的方式修掉（生产代码 1 处 `progressiveToolCatalog.ts` 改用 `Array.from`，其余 12 个都是测试文件）。两遍 lint 对已跟踪源码都已清零。

## C. 待确认（怀疑但未证实，未改）

- **C1 node-pty conout Worker 线程可能泄漏**：非 DLL 模式下只有 `kill()` 会调 `_conoutSocketWorker.dispose()`，自然退出路径 `_cleanUpProcess` 只销毁 socket。每个退出的 PTY 可能留下一个进程内 Worker。未实测。验证方法：反复开关 N 个 shell，观察 supervisor 的线程数和 heap。
- **C2 Windows 上 `pty.kill()` 的附带开销**：它会 fork `conpty_console_list_agent`。如果 shell 已经退出，agent 会以 "AttachConsole failed" 崩溃，并把堆栈打到继承来的 stderr（探针 A 策略可见）。受影响的调用方：`ptyAdapter.terminate`、ACP `terminalManager`、`oneShotChild`。影响未在应用内量化。
- **C3 延迟维护仍在主线程同步执行**：200k usage / 20k items 下约 305ms，主要是 compaction 的 `length(streams)` 全表扫描。已移出启动关键路径，但大库用户启动 10s 后会有一次性卡顿。可选做法：按 rowid 分片，或加一个"需 compact"标记列。
- **C4 合批后突发期 supervisor 仍约 67% 单核**（原 136%）：剩余开销没有 profile，推测是 1.8MB 数据的 JSON 序列化加 node-pty conout worker。
- **C5 e2e 没法区分"生产门控"**：managed smoke 跑的是 Vite dev 模式（isDev=true），而且 kill-main 时 JobObject 在 354ms 内就把整棵树杀掉了，早于 watchdog 最快 1s 的探测。生产环境 watchdog 路径目前只由进程级回归测试 `devOrphanWatchdog.process.test.ts` 覆盖。要补全，需要在打包构建中禁用 JobObject helper 后再测一次。
- **C6 Round B 的"基线"conhost 场景跑在已含 T-01 的代码上**（结果为 0 残留）。修复前的数据以审计 F2 和 A1 探针为准。

## D. 超出范围的大问题（仅上报，不立项）

审计 F4（vendor 5.5MB 首屏 chunk）、F5 的 delta 同步持久化、F6（MCP gate 串行启动）、F6b（opencode serve 常驻 553MB）均按 Brief 保持未动。
