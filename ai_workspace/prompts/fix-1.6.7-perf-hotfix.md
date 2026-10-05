# CraftStation v1.6.7 性能热修 —— 执行 Prompt

你是一名负责修复 CraftStation 性能缺陷的 Agent。以下 5 个问题已在真机性能审计中**实测确认**，不要重新"找瓶颈"或质疑数据；你的任务是把它们修好、验证、收口。

## 基线与工作区

- **基线版本**：`v1.6.6`（tag 已发布，对应 commit `b5d820e0`，main 分支）
- **工作目录**：`D:\Work\CraftStation`（Product Git Root，直接在 `main` 上修——AGENTS.md 的 hotfix 约定）
- **项目 ID**：`16cc8579-4db8-4ce6-89c3-a12a48187705`
- **先读证据**（动手前必读，含完整测量数据与字段定义）：
  - `ai_workspace/reports/performance-architecture-audit.md` —— §3 Findings
  - `ai_workspace/perf-audit/` —— 原始测量数据
- Node >= 24.10，包管理器 `pnpm@11.19.0`

## 实测基线数据（修复后要回到这些数字附近验收）

| 指标                                        | 当前实测             | 目标                                    |
| ------------------------------------------- | -------------------- | --------------------------------------- |
| PTY 突发 5000 行 → `thread-output` IPC 事件 | ~4918 个（~2700/s）  | 等比缩到 <150（对 20k 行）              |
| supervisor 突发期 CPU                       | ~86% 单核            | 显著下降（合批后 parse/序列化次数锐减） |
| 关闭 6 个 shell 后残留 conhost.exe          | +5~8 个（~11MB/个）  | 增量 = 0                                |
| taskkill /F 主进程 → supervisor+agent 子树  | 孤儿化驻留 ~2.15GB   | 5s 内全部退出                           |
| `initDatabase` 耗时随 usage_events 表规模   | 线性增长（全表扫描） | 恒定/亚线性                             |

## 修复任务（按序执行，每项独立可验）

### T-01 Windows ConPTY conhost 泄漏

文件：`src/supervisor/runtime/threadSession/ptyLifecycle.ts:68-101`

`kill()` / `killShell()` 的 win32 分支调 `terminateProcessTree(session.pty.pid)` 后直接 `return`，`session.pty.kill()` 不可达（node-pty conpty 后端的 `ClosePseudoConsole` 不执行 → conhost 驻留）；`ptyExited===true` 也提前 return。

**改法**：taskkill 杀子树后仍 try/catch 调 `session.pty.kill()`；`ptyExited` 路径补一次幂等 `pty.kill()`。参考正确实现：`src/supervisor/runtime/nativeHarness/ptyAdapter.ts:386-392`。

**验收**：脚本开/关 5 个 shell 后 supervisor 子进程 conhost 增量 = 0。

### T-02 `usage_events.ts` 索引

文件：`src/main/db/migrations.ts`（**新增** migration，追加下一个整数 version——migrations 为 append-only，禁止复用/重排已有版本号）

`CREATE INDEX idx_usage_events_ts ON usage_events(ts)`。若同一范围清理还涉及 `remote_command_receipts.updated_at`，可同 migration 补 `idx_remote_command_receipts_updated_at`。

**验收**：`EXPLAIN QUERY PLAN DELETE FROM usage_events WHERE ts < ?` 走索引。

### T-03 启动清理/compaction 移出同步路径

文件：`src/main/db/connection.ts:386-399`

`dbCompactRuntimeOutputStreams`、`usage_events` 730 天清理、`remote_command_receipts` 清理目前都在 `initDatabase` 返回前同步跑。改为 app `whenReady` 后延迟执行（timer/setImmediate/idle），不阻塞 `initDatabase` 返回；失败日志可观测、不得静默吞掉。

**验收**：注入大表后 `initDatabase` 耗时不再随表规模线性增长；清理仍会在启动后完成。

### T-05 `thread-output` 16ms 合批

文件：`src/supervisor/runtime/threadOutputPipeline.ts:307-321`（emit 点）；参考现成模式 `src/supervisor/runtime/threadSession/runtimeEventBuffer.ts`。

per-threadId 累积器：PTY data 字符串直接拼接（流天然可拼接）、16ms flush、`outputLength` 取末值。`extractOscEventsFromPtyStream`/`stripAnsiPreservingLayout`/`detectTerminalStatus` 改为对合批后 chunk 各跑一次（`ptyOscCarry` 跨 chunk carry 机制已存在，保留语义）。OSC 通知/标题/shell 事件随批或即时均可（16ms 延迟无感）。renderer 无需改（拼接语义等价）；dev `logWriter` 可同样合批。transcript append 保持 per-chunk 即可（内存操作，便宜）。

**验收**：20,000 行突发 → 事件数 <150；bytes 与 scrollback 完全等价；`stripAnsi`/OSC 现有单测全过；**新增合批单测**（flush 窗口、跨 flush 的 OSC carry、最终 flush 兜底、threadId 隔离）。

### T-08 生产启用 orphan watchdog

文件：`src/supervisor/index.ts:97-103`（去掉 `isDev` 门控）、`src/supervisor/devOrphanWatchdog.ts`；`src/main/main.ts` JobObject helper 启动失败处加结构化告警日志（含 phase/operation/status/error code）。

watchdog 已有 ppid 轮询 + `process.connected` + 双确认 + 2s 硬退出兜底，直接生产启用。

**验收**：`taskkill /F` main 进程 → supervisor 及其子树 5s 内全部退出；回归测试可用 fork+kill 模拟。

## 自主修复授权（有边界）

你在实现过程中**发现的其他确凿 bug 可以顺手修**，但需遵守：

- 只修你**亲眼证实**的缺陷（读代码确认 / 复现），不凭推测改动
- 限于本次任务涉及的模块及周边（pty 生命周期、输出管线、db 层、supervisor 进程生命周期）——不要跑去改 UI 或其它不相关子系统
- 每个顺手修复单独记录：问题、根因、改动文件，汇总写进 `ai_workspace/reports/fix-1.6.7-extra-findings.md`
- 怀疑但不确证的问题：只记录不修改，写进同一报告"待确认"区
- 明显超出范围的大问题：记录并上报，不自行立项

## 约束

- 工作区可能有用户未提交修改（`git status` 的 `M` 项），**不要还原、不要格式化无关文件、不要顺手重构**；只改任务涉及行
- 不加注释，除非语义不直观
- 日志不记 API key、Token、Cookie、完整敏感 Prompt
- 遵循 AGENTS.md 可观测性约定：关键路径日志含 phase/operation/status/对象 id/稳定 error code
- 验证用 managed smoke session（`.agents/skills/interactive-testing/` 脚本，`--mode mock`）；结束后必须 managed stop，**禁止全局杀 Electron/Node 进程**（开发机上跑着用户的 dev 实例）

## 验证与收口

每项修复完成后：

1. `pnpm typecheck`、`pnpm lint` 通过
2. 相关单测全过：`ptyLifecycle`、`runtimeOutputCompaction`、`runtimeItems`、`threadOutputPipeline`、migrations 相关测试文件 + 你的新增测试
3. `PROJECT_STATUS.md` 追加一段记录（不覆盖现有条目）
4. 提交：每项修复一个独立 commit，message 格式 `fix(scope): 简述`，正文含动机与实测收益预期

全部完成后输出总结报告：各任务改动文件清单、验证证据、顺手修复清单、遗留风险。

## 完成定义

- [ ] T-01/T-02/T-03/T-05/T-08 全部落地且各自验收标准达成
- [ ] typecheck + lint + 相关测试全绿
- [ ] 每项一个 commit
- [ ] `PROJECT_STATUS.md` 已更新
- [ ] `ai_workspace/reports/fix-1.6.7-extra-findings.md` 已产出（含顺手修复与待确认项）
