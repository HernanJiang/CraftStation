# CraftStation Performance & Architecture Audit Report（运行时实测版）

> 审计对象：CraftStation `main` @ `b5d820e0`（用户要求 1.6.2，审计期间 main 已推进到 1.6.6；所有测量均针对当前工作树，结论适用于 1.6.x 全系列）
> 审计方式：**真实 Electron 运行 + CDP Profiling + OS 进程采样 + Vitest DB benchmark + 静态链路分析**
> 与 `ai_workspace/report_1.7_performance-profile.md`（静态分析版）互补：本报告所有关键结论都有运行时实测数据支撑。
> 原始测量数据：`ai_workspace/perf-audit/`（runtime-measurements.json / pty-stress.json / 驱动脚本）

---

## 0. Executive Summary

| #   | 发现                                                                                                                                                                                    | 证据强度       | 优先级        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------- |
| F1  | **Main 异常终止导致整棵进程树孤儿化**（supervisor + agent sidecar + renderer 全部残留，实测单棵孤儿树 ~2.15GB RSS；orphan watchdog 仅 dev 启用）                                        | 实测复现       | **P0**        |
| F2  | **Windows ConPTY conhost.exe 逐个泄漏**：每个关闭的 shell/终端线程泄漏 1 个 conhost（~11MB），关闭全部 shell 后仍存留 9 个                                                              | 实测复现       | **P1**        |
| F3  | **`thread-output` 完全无批处理**：5000 行输出 → 4918 个独立 IPC 事件（~2700/s）；单 chunk 经历 4+ 次全串扫描（OSC 提取 + ANSI strip + 终端状态检测 + IPC 序列化），supervisor 单核 ~86% | 实测           | **P1**        |
| F4  | **入口静态依赖 vendor 5.5MB + git-diff 1MB**：modulePreload 过滤只删了 preload 提示，依赖仍在首屏关键路径；vendor 内含 mermaid/d3/pdf/katex/prosemirror/motion                          | 实测构建产物   | **P1**        |
| F5  | **SQLite delta 持久化同步阻塞主进程**：~0.17-0.24ms/batch，8 线程突发期间 ~100% CPU、WAL 放大 12×；启动时 `dbCompactRuntimeOutputStreams` 与 `usage_events` 清理均为无索引全表扫描      | 实测 benchmark | **P1**        |
| F6  | **启动串行化**：supervisor fork 必须等 6 个 MCP ingress 全部 ready（本机 ~1s，外网环境更差）；provider 版本探测在状态刷新时打外网 URL（8s timeout/个）                                  | 代码+日志      | **P2**        |
| F7  | **Windows Job Object helper 启动失败** → `assignPid` 不可用 → 进程树杀保证降级（与 F1/F2 叠加放大）                                                                                     | 实测日志       | **P1**        |
| F8  | **Idle 与常规路径健康**：IPC invoke p50=1.4ms；12s idle 无 longtask；shell 开/关 heap 平坦；RAF 批处理已就位                                                                            | 实测           | —（正面结论） |
| F9  | 开发环境 `codex-protocol` 生成目录 `renameSync` EPERM（sandbox 服务持锁）                                                                                                               | 实测复现       | P3            |

**一句话**：产品没有"大而傻"的前端问题——事件批处理、modulePreload、按需 chunk、SQLite WAL 都已就位；真正的结构性风险在**进程生命周期管理**（F1/F2/F7）和**高频 IPC 的 supervisor 端 CPU 成本**（F3/F5），加上一个被 preload 过滤掩盖的 **vendor catch-all 入口依赖**（F4，与静态报告结论一致）。

---

## 1. 范围与方法

### 1.1 覆盖链路（全链路，非仅前端）

```
Electron Main (main.cjs)
 ├─ whenReady: DB init → MCP ingress ×6 → mainWindow → MCP gate → supervisorClient.start
 ├─ SupervisorClient: fork(supervisor.cjs) + Node IPC request/reply (timeout 10min)
 ├─ RemoteAccessServer (WS, replay buffer, item interests)
 └─ persistSupervisorEvent → better-sqlite3 (WAL)

Supervisor (supervisor.cjs, 独立 Electron/Node 进程)
 ├─ SupervisorRuntime: sessions/shellSessions/adapters/MCP/failover/handoff Maps
 ├─ ThreadSessionManager → SpawnPipeline → PtyLifecycle / StructuredSession
 ├─ ThreadOutputPipeline.handlePtyData (PTY 流)
 ├─ RuntimeEventBuffer (16ms 合批 → thread-runtime-event(s))
 └─ node-pty (ConPTY on Windows) / CLI sidecars (opencode serve 等)

Renderer (React 19 + Zustand)
 ├─ runtimeEvents contribution: thread-output → threadOutputStore.append (500KB/thread)
 │    thread-runtime-* → RAF(前台)/250ms(后台) 合批 → store.applyRuntimeEventBatches
 └─ XTermSurface → xterm.write + WebGL addon
```

### 1.2 测量方法

- **managed smoke session**：`perf-audit-162d`（mock mode = 隔离 HOME/userData 的**真实应用**，非 mock agent；已规范 stop，无进程残留）
- **CDP**：Runtime.evaluate 驱动 `window.craftstation` bridge（startShell/writeTerminal/closeThread/onSupervisorEvent 计数器）、Performance metrics、longtask observer、RAF 采样
- **OS 进程采样**：WMI/CIM 进程树 + CPU/RSS 轮询（200ms 间隔）
- **DB benchmark**：`CRAFTSTATION_DB_BENCHMARK` 环境变量启用真实 SQLite WAL 链路测试（1/8 线程 × 1000 delta batch × 6 样本）
- **构建产物分析**：`dist/renderer/assets/` 实际 chunk 体积 + entry chunk 静态 import 图 + index.html preload 列表

### 1.3 测试环境限制（诚实声明）

- 数据均来自 **dev/mock 单样本**，非 packaged production；生产内存/启动数应低一些但趋势一致
- 无真实 provider 凭据 → 未测真实 Agent turn（opencode serve 侧车已实测）；真实流式推理事件率可能低于 PTY 峰值
- 无外网 → 版本探测 URL 全部失败（正好暴露 F6 的 timeout 路径）
- 未测 mobile/remote 真机连接（静态分析了 replay buffer/item interest 设计，见 §5.6）

---

## 2. Baseline Measurements（实测基线）

### 2.1 启动（dev mock，1 样本）

| 阶段                           | 实测          | 说明                                                                                   |
| ------------------------------ | ------------- | -------------------------------------------------------------------------------------- |
| managed launch → READY         | 126,919ms     | 含 pnpm install check + tsdown 全量 build + vite cold + electron spawn，**非纯冷启动** |
| Vite dev server ready          | 955ms         |                                                                                        |
| Main → supervisor fork         | ~1,000ms      | MCP gate（6 ingress 就绪）耗时                                                         |
| Renderer nav: DOMInteractive   | 242ms         |                                                                                        |
| Renderer nav: DOMContentLoaded | 5,640ms       | 冷 vite transform 主导                                                                 |
| App 初始化归因                 | total 2,114ms | locale 153 / provider 1,041 / workbench 1,428                                          |
| 资源数                         | 250           |                                                                                        |

### 2.2 进程内存（dev mock idle，实测 RSS）

| 进程                    | RSS            | 备注                                             |
| ----------------------- | -------------- | ------------------------------------------------ |
| electron main           | 366MB          |                                                  |
| renderer                | 565–583MB      | JS heap 仅 ~200MB，其余为 Chromium native/图形栈 |
| supervisor              | 325–345MB      | fork 的 Electron-as-Node，常驻 agent runtime     |
| gpu                     | 301MB          |                                                  |
| utility                 | 240MB          |                                                  |
| job helper (powershell) | 81MB           | Windows Job Object 持久辅助进程                  |
| opencode serve sidecar  | 553MB          | 探测/就绪即常驻                                  |
| **合计**                | **~2.1–2.2GB** | dev 模式 idle，无用户线程                        |

### 2.3 IPC 与事件

| 指标                                  | 实测                                              |
| ------------------------------------- | ------------------------------------------------- |
| `dbGetState` invoke 往返 p50/p95      | 1.4ms / 2.1ms                                     |
| `dbGetProjects` invoke                | ~0.7ms                                            |
| `startShell` invoke → PTY 就绪        | 156–164ms                                         |
| `thread-output` 事件率（5000 行突发） | 4,918 events / 1.8s ≈ **2,700 ev/s**，867KB       |
| `thread-output` 持续率（20000 行）    | 19,913 events / 8.4s ≈ **2,370 ev/s**，1.85MB     |
| 突发期间 CPU                          | supervisor ~0.86 core、renderer ~0.66、main ~0.34 |
| Idle longtask（12s）                  | 0 个；RAF p50 6.9ms                               |

### 2.4 SQLite persistence benchmark（真实 WAL，6 样本取 5）

| 场景               | wallMs/batch | CPU/batch    | heap 瞬时增长 | WAL/DB                   |
| ------------------ | ------------ | ------------ | ------------- | ------------------------ |
| 1 线程 ×1000 delta | ~0.175ms     | ~0.14ms      | +28MB         | 4.15MB / 356KB (**12×**) |
| 8 线程 ×8000 delta | ~0.20–0.24ms | ~0.17–0.20ms | +28MB         | 同上                     |

每 batch 路径：`SELECT row → JSON.parse(streams) → append → JSON.stringify → UPDATE`，同步执行于 main 事件循环。

### 2.5 Bundle（dist/renderer 实测）

| Chunk             | min 体积                                                | 首屏路径？                  | 内容特征                                                                         |
| ----------------- | ------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `vendor-*.js`     | **5.50MB**                                              | **是（entry 静态 import）** | mermaid×104/d3×67/prosemirror×61/pdf×50/motion×87/katex×37/marked/highlight refs |
| `git-diff-*.js`   | 1.04MB                                                  | **是（entry 静态 import）** | jsdiff×271/highlight×160                                                         |
| `ui-*.js`         | 489KB                                                   | 是                          | HeroUI 等                                                                        |
| `framework-*.js`  | 248KB                                                   | 是                          | React 等                                                                         |
| `shiki-*.js`      | 724KB                                                   | 否（vendor 动态引用）       |                                                                                  |
| `xterm-*.js`      | 667KB                                                   | 否（deferred）              |                                                                                  |
| `diffBuildWorker` | 940KB                                                   | worker                      |                                                                                  |
| `ort-wasm`        | 23MB                                                    | wasm（lazy）                | onnx transformers                                                                |
| JS 总量           | 16.6MB                                                  | —                           |                                                                                  |
| 首屏关键路径      | **≈7.3MB**（vendor+git-diff+ui+framework+entry+bridge） |                             |                                                                                  |

`modulePreload.resolveDependencies` 过滤确实删掉了 index.html 中的 vendor/shiki/xterm/git-diff preload link —— **但 entry chunk 仍静态 import vendor 与 git-diff，浏览器照样取，只是晚一步（waterfall）**。preload 过滤是表面优化，真问题是 vendor 作为 catch-all 进了入口图。

---

## 3. Findings

### 【P0】F1 — Main 异常终止 → 整棵进程树永久孤儿化

- **问题**：supervisor（及其 agent sidecar、PTY、MCP 服务器）在 Electron main 被杀/崩溃后没有可靠的死亡检测。
- **代码位置**：
  - `src/main/supervisor/SupervisorClient.ts:150` fork + `:201-215` exit/restart
  - `src/supervisor/index.ts:85-87` 仅监听 `process.on("disconnect")`（Windows 硬杀父进程时不可靠）
  - `src/supervisor/index.ts:97-103` `startDevOrphanWatchdog` **仅 dev 启用**
  - `src/main/main.ts:1146-1176` Windows Job Object assignPid（本次运行 helper 启动失败，降级）
- **数据证据**：electronmon 重启后旧 main(42112)整树存活：main 405MB + renderer 756MB + gpu 328MB + utility 239MB + supervisor 344MB + **opencode serve 553MB** + jobhelper 80MB + conhost ×2 ≈ **2.15GB**，直到手动 taskkill。
- **根因**：`disconnect` 事件依赖 IPC channel 优雅关闭；Windows `TerminateProcess` 不产生 EOF 通知。devOrphanWatchdog（ppid 轮询）注释明确"Packaged builds never install it"。JobObject helper 失败时连保底都没了。
- **实际影响**：生产环境 main 崩溃/被结束后，supervisor + 全部 agent CLI + MCP 服务器 + fs.watch 句柄永久驻留——占用内存、端口、文件锁（甚至继续写日志/响应 schedule 任务），下次启动还可能与旧实例抢 sqlite。
- **优化方案**：把 orphan watchdog 提到 production（ppid 存活轮询成本 ~0）；同时 supervisor 监听 `process.connected===false` 作快速路径；Windows 侧确保 JobObject helper 失败时有日志告警并 fallback。
- **预计收益**：消除每次异常重启 ~0.5–2GB 级泄漏；消除旧实例干扰新实例的隐性故障。
- **风险**：ppid 轮询误判（PID 复用）——watchdog 已用 `process.connected` + 两次确认兜底，风险低。
- **验证方法**：kill -9 / taskkill main → 断言 supervisor+catalog 子进程在 ~5s 内全部退出；加 regression test（fork supervisor → kill parent → poll）。

### 【P1】F2 — Windows ConPTY：每关闭一个 shell/终端线程泄漏一个 conhost.exe

- **问题**：`closeThread`/session 销毁后 conhost.exe 不退出，逐个累积。
- **代码位置**：`src/supervisor/runtime/threadSession/ptyLifecycle.ts:68-101`
  - `kill()`/`killShell()` 在 `process.platform === "win32"` 时只调 `terminateProcessTree(session.pty.pid)` 然后 `return` —— **`session.pty.kill()` 在 Windows 上不可达**
  - `ptyExited === true` 时更早 `return`（自然退出路径同样漏）
  - 对比 `ptyAdapter.ts:386-392`（native harness 路径）正确调用了 `this.pty.kill()`
- **数据证据**：本轮测试开 6 个 shell 全部 `closeThread` → 0 个活 shell，**8 个 conhost.exe 仍驻留**（各 ~11MB，总计 ~88MB；后又测一次 → 9 个）。conhost 的父进程是 supervisor 持有的 HPSEUDOCONSOLE。
- **根因**：Windows ConPTY 语义：`taskkill` 只杀 shell 客户端进程，**pseudoconsole server（conhost）必须由持有方 `ClosePseudoConsole`（node-pty 的 `pty.kill()` 内部完成）**。当前代码路径跳过了它。
- **实际影响**：每关闭一个终端线程泄漏 ~11MB + 一个进程句柄；重度终端用户一天可累积数百 MB ~ GB 级泄漏 + 进程表膨胀。
- **优化方案**：Windows 路径改为 `terminateProcessTree(pid)`（杀子树）**之后仍调用 `session.pty.kill()`**（关 pseudoconsole）；`ptyExited` 路径同样需要"关 console"语义（可能需要在 node-pty 暴露 dispose/close 或确认 `kill()` 对已退出进程幂等）。upstream node-pty 若不支持，需要补丁或包装。
- **预计收益**：消除 ~11MB/终端生命周期泄漏；句柄数回落。
- **风险**：`pty.kill()` 对已死进程可能抛异常 → try/catch；kill 与 taskkill 顺序避免双杀竞态。
- **验证方法**：开/关 N 个 shell + agent 终端 → 断言 supervisor 子进程数回到基线（conhost==0 残留）；CI 加进程计数 regression。

### 【P1】F3 — `thread-output` 无批处理 + 每 chunk 多次全串扫描，supervisor 单核近饱和

- **问题**：PTY 数据逐 chunk 上 IPC，且 `handlePtyData` 对每 chunk 做 4+ 次全字符串扫描；runtime events 有 16ms 合批，PTY 路径没有。
- **代码位置**：`src/supervisor/runtime/threadOutputPipeline.ts:307-321`（emit 无批处理）、`:330` extractOscEvents、`:442` stripAnsiPreservingLayout、`:526-537` prevChunk+detectTerminalStatus、`:449` detectAutoResponse；renderer `runtimeEvents.ts:138-141` + `XTermSurface.tsx:807-817`（两个独立 listener 各自处理同一事件）
- **数据证据**：5000 行 → 4,918 独立事件（~1 chunk/line，ConPTY 行缓冲）；20,000 行 → 19,913 事件 1.85MB；**supervisor ~0.36ms/chunk → 突发期 ~86% 单核**；renderer ~0.66 core、main ~0.34 core，三进程合计 ~1.85 core 处理 2.4K ev/s。
- **根因**：ConPTY 按行交付 → 行即事件；每事件全链路成本 = supervisor 扫描×4 + JSON 序列化 + Node IPC + main 转发 + renderer 两个 listener（TranscriptBuffer.append + xterm.write）。
- **实际影响**：构建日志、`cat` 大文件、`npm install` 等场景下 supervisor 单核打满 → 同进程内 agent runtime 事件、MCP 路由、IPC 全部排队；快速滚动输出时 xterm 实际渲染本来按帧合并，事件率远大于渲染需求。
- **优化方案**：对 `thread-output` 引入与 RuntimeEventBuffer 相同的 16ms 合批（按 threadId 累积 data 字符串，直接拼接——PTY 流天然可拼接，无保序难题）；把 `extractOscEvents`/`stripAnsi`/`detectTerminalStatus` 改为对合批后的 chunk 跑一次（注意 OSC 跨 chunk 续接已有 carry 机制）；dev logWriter 保持逐 chunk 或同样合批。
- **预计收益**：事件率 2,400→~60/s（每帧一批），supervisor 突发 CPU 降 ~80%，main/renderer 同步受益；xterm 渲染结果完全等价。
- **风险**：低——PTY 文本流拼接语义安全；唯一注意 `outputLength` 字段语义（累积值，合批后取末值即可）和 OSC 通知事件的时序（可随批附带）。
- **验证方法**：复测 20,000 行突发 → 事件数 <150（8.4s×~17批/s）、bytes 不变、scrollback 一致；回归 test 比对 stripAnsi 结果。

### 【P1】F4 — vendor catch-all 5.5MB + git-diff 1MB 在首屏关键路径

- **问题**：codeSplitting `vendor` 组把所有未匹配依赖打进单 chunk，且被 entry 静态 import；preload 过滤只影响 hint 不影响真实依赖。
- **代码位置**：`vite.config.ts:417-468` codeSplitting.groups（vendor 为兜底组）、`:395-403` modulePreload 过滤；`dist/renderer/assets/index-*.js` 顶部 `import ... from "./vendor-D-7O2p_A.js"`、`from "./git-diff-Bs3suokF.js"`（实测产物）
- **数据证据**：vendor 5.50MB（含 mermaid/d3/pdf/katex/prosemirror/motion/marked/highlight）；git-diff 1.04MB；首屏关键路径 ~7.3MB JS；与静态报告独立得出同结论。
- **根因**：①vendor 组 catch-all 语义——任何被 entry 间接静态引用的模块把整个 vendor 拉进首屏；②git-diff 中某 util 被 entry/appStore 层顶层引用。
- **实际影响**：冷启动下载+解析 ~7.3MB JS 才到第一帧（本机 dev 下 DOMContentLoaded 5.6s 已包含此成本）；低端机/慢盘上更严重。
- **优化方案**：①拆分 vendor：mermaid/d3/pdf/katex/onnx 等重型 feature lib 强制成独立 lazy group（动态 import 已存在的话只需把组规则提前）；②找出 entry→git-diff 顶层引用（大概率是 appStore/gitStore 里一个 diff util），改为运行时 lazy 或下沉到使用方 chunk；③把 `modulePreload` 过滤改成"真实依赖检查"——构建期断言 entry 图不含 vendor/git-diff/monaco/shiki，CI 加 entry 体积预算（如首屏 JS ≤2.5MB gzip 前）。
- **预计收益**：首屏 JS 解析 ~40–60%↓（静态报告同估计）；慢机冷启动秒级改善。
- **风险**：拆 chunk 引入 waterfall——需配合 preload hint 策略；个别模块有副作用依赖顺序（prosemirror 插件）要验证。
- **验证方法**：构建后脚本断言 entry chunk import 列表 + 首屏 DCL 时间 A/B；`rollup-plugin-visualizer` 或现有 sourcemap 分析确认归属。

### 【P1】F5 — SQLite 高频持久化：同步全量 JSON round-trip 阻塞主进程 + 启动全表扫描

- **问题**：每条 `content.delta` batch 触发 `SELECT row → parse(streams) → append → stringify → UPDATE`，全部同步在 Electron main 事件循环；启动时还有两个无索引全表扫描。
- **代码位置**：
  - `src/main/db/runtimeItems.ts`（item.updated/content.delta/context.updated 每事件 read-modify-write）
  - `src/main/remote/server/runtimePersistence.ts` persistSupervisorEvent 入口
  - `src/main/db/connection.ts:386-399` 启动同步执行 `dbCompactRuntimeOutputStreams` + cleanup
  - `src/main/db/runtimeOutputCompaction.ts:11-15` `length(streams) > N` —— **无索引全表扫描**
  - `src/main/db/migrations.ts:216-229` `usage_events` 只有 `kind` 索引，**无 ts 索引** → 730 天清理 DELETE 全表扫
- **数据证据**：benchmark 0.175–0.24ms/batch（CPU-bound）；8 线程突发 8000 batch ≈ 1.6s wall 内 main 进程近满核；单次突发 transient heap +28MB；WAL 4.15MB vs DB 356KB（12× 放大，高频小写入典型 WAL 症状）。
- **根因**：better-sqlite3 同步 API（正确选择，避免异步开销）+ 每条 delta 全量 streams JSON round-trip（放大项）+ 启动扫描缺索引。
- **实际影响**：多 agent 高强度 streaming 时主进程事件循环被 DB 写入持续占用 → IPC 延迟抖动、UI 微卡；DB 大的老用户启动被全表扫描拖慢（无法量化但随历史数据线性增长）。
- **优化方案**：①delta 合并写：把 `content.delta` append 改为 append-only 表或在内存聚合到 item 完成后/定期落盘（注意恢复语义）；②给 `usage_events.ts` 加索引；③启动 compaction/清理改为 app-ready 后延迟执行（setImmediate/idle）或 `WHERE` 换用可索引谓词（如记录需要 compact 的 flag 列）；④WAL checkpoint 已配置，保持。
- **预计收益**：streaming 期间 main 事件循环 DB 占用 -70%+；大数据库用户启动 IO 有界。
- **风险**：append-only 表涉及读路径改动与迁移；延迟 compaction 要处理"启动后立刻被杀"的漏网行（无害，下次补上）。
- **验证方法**：重跑 `runtimePersistence.perf.test.ts` 对比 wallMs/cpuMs；构造 10 万行 items 的 DB 测启动耗时 A/B；`usage_events` EXPLAIN QUERY PLAN。

### 【P1】F7 — Windows Job Object helper 启动失败 → 进程树终止保证降级

- **问题**：本次运行 `Windows Job Object helper failed to start (exit 1)`，`assignPid` 不可用，agent/supervisor 子树未纳入 Job → 上层的 taskkill /T 成唯一手段，叠加 F1/F2。
- **代码位置**：`src/main/main.ts:1146-1176`（helper spawn + assignPid）；helper 是一个持久 powershell.exe（81MB RSS，P/Invoke Win32 Job API）
- **数据证据**：启动日志 `[craftstation] Windows Job Object helper exited: failed to start`；同机确实存在以该 helper 为父的残留树（旧 orphan 树含 80MB powershell jobhelper）。
- **根因**：未查明（权限？策略？）；但代码**静默降级**——helper 挂了不告警、不 fallback。
- **实际影响**：F1 场景概率放大；另外持久 powershell 81MB 本身可换轻量原生 helper。
- **优化方案**：①helper 启动失败 → 明确日志 + 启动一次性 fallback（app 退出时主动枚举 taskkill 已知子树）；②长期：把 Job helper 换成小型 native 模块/Node addon（koffi/ffi 已在依赖里？检查）或打包内嵌 exe，消除 81MB powershell 常驻。
- **预计收益**：恢复进程树 kill 保证；省 ~80MB 常驻。
- **风险**：杀树边界（误杀用户手动启动的同 PID 进程）——已用 PID 精确分配，可控。
- **验证方法**：模拟 helper 失败 → 断言告警与 fallback；正常路径 → main 退出后 supervisor/agent 树清零。

### 【P2】F6 — 启动串行点：MCP gate → supervisor；启动全表清理；provider 版本探测外网依赖

- **问题**：① `main.ts:1506-1514` supervisor 必须等全部 6 个 MCP ingress ready（本机 ~1s，慢环境更久）后才 fork；② `initDatabase` 内同步 compaction/cleanup（见 F5）；③ agent 状态刷新打外网 URL（8s timeout 各，Promise.all 并行，不阻塞启动但影响状态就绪时间）。
- **代码位置**：`src/main/main.ts:895,1267-1273,1506-1514`；`src/supervisor/agents/updateAgent.ts:172,237,280`（8s abort）；`src/supervisor/runtime/agentStatusService.ts:196-241,513-527`（Promise.all + 60s cap）
- **数据证据**：main 18:00:15 → supervisor fork 18:00:16（gate ~1s，本机 6 个本地 stdio ingress）；外网探测全部 failed/abort（本机无外网）。
- **实际影响**：Agent Runtime 可用时间被 MCP 中最慢者串行拉长；无外网/代理环境下探测拖至 timeout。
- **优化方案**：①supervisor 启动与 MCP ready 解耦——先 fork + 就绪本地能力，MCP snapshot 后注入（代码已支持 launch-time mcpServers 快照字段，思路一致）；②探测结果缓存 + 上次值先渲染后台刷新；③版本探测失败快速路径（离线检测）。
- **预计收益**：慢网/冷启环境下 agent 可用时间 -1~数秒。
- **风险**：MCP 工具在首个 turn 前未注入完整列表 → 需要"pending injection"语义；已有 mcpServers launch snapshot 机制可复用，风险中低。
- **验证方法**：人为延迟一个 MCP ingress 5s → 对比 agent 可用时间；离线环境计时。

### 【P2】F6b — opencode serve 侧车常驻 553MB（探测即启动长驻服务）

- **问题**：`detectInstall`/能力探测会拉起 `opencode serve --port 0` 常驻（本次 553MB），不是一次性 probe。
- **代码位置**：`src/supervisor/agents/`（opencode adapter）；日志 `[opencode] SDK capabilities probe failed, falling back to CLI parser` + `app.agents probe failed`
- **数据证据**：孤儿树中实测 opencode.exe serve 553MB；本会话也拉起过（被随树清掉）。
- **根因**：sidecar 生命周期绑定 supervisor 而非"探测期间临时"；探测还串行了 inventory timeout。
- **实际影响**：即使用户不开 opencode 线程，也常驻半 GB；异常路径下随 F1 一起孤儿。
- **优化方案**：能力探测用短生命周期子进程（探测完即退）；serve 侧车延迟到首个 opencode 线程创建；空闲 N 分钟自动回收。
- **预计收益**：未用 opencode 的用户省 ~0.5GB。
- **风险**：探测语义变化（serve 探测可能拿到更多能力信息）→ 需保留降级路径。
- **验证方法**：启动后进程列表不含 opencode serve，除非创建对应线程。

### 【P3】F9 — 开发环境 codex-protocol `generated` 目录 rename EPERM

- **问题**：`packages/codex-protocol/scripts/generate.mjs` 用 `renameSync(tmp→generated)`，被 `codex-windows-sandbox-service`（用户机驻留服务）持锁 → `pnpm install`/`dev` 直接失败。
- **数据证据**：实测两次复现，完整堆栈记录；`generated` 目录 671 文件被锁不可替换。
- **优化方案**：rename 失败 fallback 为逐文件 copy + retry/backoff；或生成到唯一目录再原子切换失败时告警"请停止 sandbox service"。
- **优先级理由**：只影响 Windows 开发机且可由用户关掉服务解决，P3。

### 【正面】F8 — 已就位且健康的机制（不要做重复优化）

- RuntimeEventBuffer 16ms 合批（`runtimeEventBuffer.ts`）+ renderer RAF/250ms 双通道（`runtimeEvents.ts`）——runtime events 路径已优
- modulePreload 过滤、xterm/shiki/monaco/onnx/worker deferred chunk 已生效（见 §2.5）
- threadOutputStore 非 Zustand-set 追加（无渲染风暴）、500KB/thread 上限
- WAL + synchronous NORMAL + shutdown TRUNCATE checkpoint
- Remote `thread-output` 排除 replay buffer + item interest scoping + 超大事件 resync-required（静态审计通过）
- GitStateService demand-driven、ProjectWatcher 300ms debounce + ignore 过滤
- IPC invoke p50 1.4ms、idle 0 longtask、shell 开/关 heap 平坦——常规路径无 P0/P1

---

## 4. Executable Optimization Tasks

### 分类 1：低风险高收益，可以直接做

**T-01 conhost 泄漏修复（F2）**

- 目标：关闭 shell/agent 终端后 conhost 退出
- 涉及文件：`src/supervisor/runtime/threadSession/ptyLifecycle.ts`；可能 `src/supervisor/nodePty.ts`
- 修改方案：win32 分支 `terminateProcessTree(pid)` 后仍 try/catch 调 `session.pty.kill()`；`ptyExited` 快路径也补一次（幂等）
- 风险：kill 已死进程抛错（catch）
- Benchmark/Test：进程计数 regression test（开/关 5 shell → conhost 增量=0）
- 验收：本会话场景复测，0 残留 conhost

**T-02 `usage_events.ts` 索引（F5 部分）**

- 目标：730 天清理 DELETE 可走索引
- 涉及文件：`src/main/db/migrations.ts`（新 migration + index）
- 修改方案：`CREATE INDEX idx_usage_events_ts ON usage_events(ts)`
- 风险：无
- Test：EXPLAIN QUERY PLAN + 大表 cleanup 计时
- 验收：cleanup 查询走 index

**T-03 启动清理/compaction 延迟执行（F5 部分）**

- 目标：`dbCompactRuntimeOutputStreams` + receipts cleanup 移出 `initDatabase` 同步路径
- 涉及文件：`src/main/db/connection.ts:386-399`
- 修改方案：app `whenReady` 完成后 `setTimeout(idle)` 或 `requestIdleCallback` 等效（main 进程用 timer）执行；保留事务语义
- 风险：启动后秒退 → 清理跳过（可接受，下次补）
- Test：构造大 DB 对比 ready 耗时
- 验收：initDatabase 返回时间不再包含两项工作

**T-04 opencode serve 探测改为短生命周期（F6b）**

- 目标：探测不在 supervisor 常驻
- 涉及文件：`src/supervisor/agents/opencode/*`（探测/server pool）
- 修改方案：探测用 `opencode --version`-class 一次性命令或短超时 serve + 立即 kill；serve 延迟到首线程
- 风险：能力信息变少 → 保留 fallback 分支
- Test：进程断言 + 现有 opencode adapter test
- 验收：无 opencode 线程时进程列表无 opencode

### 分类 2：需要局部重构

**T-05 `thread-output` 16ms 合批（F3）**

- 目标：PTY IPC 事件 ≤ ~60/s/thread
- 涉及文件：`src/supervisor/runtime/threadOutputPipeline.ts`（emit 前加 per-thread 累积器）；`src/main/remote/server/*`（转发路径透传）；renderer 无需改（拼接语义等价）
- 修改方案：复用 `RuntimeEventBuffer` 的模式实现 `PtyOutputBuffer`：per-threadId 累积 data、16ms flush、`outputLength` 取末值、OSC 通知事件随批附带或即时；status 检测/OSC 提取在合批后的 chunk 上执行
- 风险：OSC 序列跨批边界的 carry 已有机制；远端 terminal watch 时序略变（更平滑）
- Test：PTY 突发事件数断言 + stripAnsi/OSC 单测 + xterm 输出 diff 测试
- 验收：20k 行 → 事件数 <150 且 scrollback 完全等价

**T-06 vendor 拆分 + entry 依赖预算（F4）**

- 目标：首屏静态 JS ≤ ~2.5MB（min 前）
- 涉及文件：`vite.config.ts:417-468`；git-diff 的顶层引用点（查 `src/renderer` 谁静态 import diff 工具——`appStore`/`gitStore` 相关文件）
- 修改方案：①vendor 组内再细分：mermaid/d3/pdf/katex/onnxruntime → 独立 lazy 组；②修 entry→git-diff 顶层引用为 lazy；③CI 构建脚本断言 entry chunk import 白名单
- 风险：chunk waterfall、插件副作用顺序
- Test：构建产物断言脚本 + 首屏 DCL A/B
- 验收：entry 静态图不含 vendor/git-diff；DCL 实测下降

**T-07 SQLite delta 写路径减读（F5 主体）**

- 目标：content.delta 不再每条 read-modify-write
- 涉及文件：`src/main/db/runtimeItems.ts`、`runtimeOutputCompaction.ts`（兼容）；可能需要 `runtime_segments` 已有 append 表复用
- 修改方案：方案A delta 入 append-only 段表、读时聚合；方案B 内存聚合 + 节流落盘（item.completed 或 500ms flush）——**B 风险更小**，注意崩溃恢复时丢最后 ~500ms 文本（可接受，需记录语义）
- 风险：读路径一致性、崩溃丢尾部 delta
- Test：复跑 perf test（目标 wallMs/batch <0.05ms）+ 崩溃恢复测试
- 验收：8 线程突发 main CPU 减半以上，scrollback 恢复正确

### 分类 3：需要架构调整

**T-08 生产环境 orphan watchdog（F1）**

- 目标：main 硬杀后 ~5s 内 supervisor + 全部子树退出
- 涉及文件：`src/supervisor/index.ts:97-103`（去 dev 门控）；`src/supervisor/devOrphanWatchdog.ts`（改名/语义化）；`src/main/main.ts` JobObject 失败告警
- 修改方案：watchdog 生产启用（ppid + process.connected + 双确认已有）；配合 T-09 JobObject 修复构成双保险
- 风险：极低（逻辑已存在且经 dev 验证）
- Test：kill -9 main → 子树 5s 内消失；回归 test
- 验收：模拟异常场景 10/10 无残留

**T-09 JobObject helper 可靠化（F7）**

- 目标：helper 启动失败可诊断 + 有 fallback；长期去 powershell 常驻
- 涉及文件：`src/main/main.ts:1146-1176`；helper 脚本
- 修改方案：①失败时结构化日志 + 应用退出 hook 主动 taskkill 枚举子树；②（后续）换原生小 helper
- 风险：杀树范围界定
- Test：helper 注入故障 → 断言告警 + fallback 生效
- 验收：helper 异常下 app 退出不留 supervisor/agent

**T-10 supervisor 启动与 MCP gate 解耦（F6）**

- 目标：agent runtime 可用不被最慢 MCP 拖住
- 涉及文件：`src/main/main.ts:1506-1514`；`src/main/supervisor/SupervisorClient.ts`；supervisor 侧 mcpServers 快照注入路径
- 修改方案：supervisor 先 fork + 本地能力就绪；MCP 就绪后经已有 launch snapshot/注入通道下发
- 风险：turn 在 MCP 未完全注入时启动的边界语义
- Test：注入式延迟 MCP ingress → agent 可用时间不变；全链路 MCP 工具调用 e2e
- 验收：模拟 5s 慢 ingress 下 startShell/craftAgent 不受影响

### 分类 4：理论可优化但当前不值得做

- **Renderer 渲染层再优化**：Zustand selector/虚拟化——当前无实测证据显示组件级渲染热点（idle 0 longtask、heap 平坦、500KB transcript cap 合理）。等有真实慢机/长会话 profile 再说。
- **IPC invoke 延迟**：p50 1.4ms 已健康；换 messagePort/二进制协议收益边际。
- **Dexie 缓存**：未在热点路径实测到成本，暂不动。
- **webview/mobile 端 bundle**：mobile entry 已裁剪（只 ui/framework），风险低优先级低。
- **多 supervisor 分片**：架构剧变，当前单 supervisor 的瓶颈在 PTY CPU（F3 可解决），不提案。

---

## 5. Existing Benchmark Coverage & Gaps

### 5.1 已有（实测可跑）

| 测试                                          | 覆盖                                          | 实测结果    |
| --------------------------------------------- | --------------------------------------------- | ----------- |
| `test:perf:cli-hook`                          | CLI hook HTTP 往返延迟（mock server）         | PASS        |
| `test:perf:remote`                            | WS 帧解析/序列化吞吐（进程内）                | PASS        |
| `runtimePersistence.perf.test.ts`（env 启用） | delta 持久化 wall/CPU/heap/WAL（真实 SQLite） | 见 §2.4     |
| `scripts/profile-desktop-renderer.mjs`        | renderer attribution/nav/heap 采集            | 已用于 §2.1 |

### 5.2 缺失（本次实测发现，应补）

| 缺口                                        | 建议                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **进程树泄漏 regression**（conhost/orphan） | CI/本地脚本：开/关 N shell → supervisor 子进程计数差分；kill main → 子树清零断言（对应 T-01/T-08 验收） |
| **PTY streaming 吞吐回归**                  | 固定行数突发 → 事件数/bytes/CPU 断言（防 F3 退化）                                                      |
| **启动分阶段计时**                          | `initDatabase`/MCP gate/supervisor fork/renderer ready 打点进 diagnostics，production 可采集            |
| **Session 开/关内存回归**                   | X 次循环后 heap/RSS 增长上限断言（本次 3 循环平坦，基线已建）                                           |
| **Bundle 预算**                             | entry 静态 import 白名单 + 首屏 JS 体积断言（T-06 验收脚本）                                            |
| **Remote 重连/回放**                        | 现有 perf 只测帧解析；缺断线重连/resync-required/e2e 延迟                                               |
| **MCP/CLI 故障注入**                        | timeout/crash/restart/failover 自动化（当前只有静态断言）                                               |
| **Account pool failover**                   | 无自动化；真实凭据场景只能 manual gate                                                                  |

### 5.3 只能做 manual/real gate 的部分

真实 provider turn（需凭据）、真实移动设备 remote、WSL 网络中断、真实账号配额 failover——mock 无法覆盖，需在 real mode 会话人工验收。

---

## 6. Risks and Non-Goals

- **dev/mock 样本局限**：启动数据含构建系统成本；生产冷启动需 packaged build 复测（本会话环境无打包产物；建议纳入发布检查清单）。
- **不改架构语义**：报告不建议动 CraftPlan→Entity→Session 模型、MessagePort/二进制 IPC、多进程分片——无实测证据支撑。
- **不重复静态报告**：`report_1.7_performance-profile.md` 中 vendor catch-all 结论与本文 F4 独立验证一致，可合并执行；其 xterm scrollback/LegendList recycleItems 等建议属"待验证静态目标"，未在本轮实测覆盖。
- **环境特例**：F7 JobObject 失败、F9 EPERM 可能是本机特有；其他 Windows 机需复核。
- **清理状态**：本次 managed session 已 stop，无残留进程；审计脚本保留在 `ai_workspace/perf-audit/`（非正式测试）。

---

## 7. Appendix：原始测量记录

- `ai_workspace/perf-audit/runtime-measurements.json` — bridge 探查/事件计数/线程循环
- `ai_workspace/perf-audit/pty-stress.json` — 5000 行突发数据
- `ai_workspace/perf-audit/audit-results.json` — bridge 方法表
- DB benchmark 原始 JSON（6 样本 × 1/8 线程）已在上文 §2.4 汇总（源文件 `CRAFTSTATION_DB_BENCHMARK` 输出，测试运行后被清理，汇总值见表）
- 孤儿树采样：`42112 main 405MB / 34244 gpu 328MB / 39860 utility 239MB / 29788 renderer 756MB / 44884 supervisor 344MB / 43880 opencode 553MB / 45804 jobhelper 80MB + conhost×2` ≈ 2.15GB
- conhost 泄漏序列：关闭全部 shell 后 supervisor 子进程仍含 8 个 conhost.exe（后续又测一轮 → 9 个）
- 会话：`C:\Users\Haona\.craftstation-smoke\perf-audit-162d\session.json`（已 stop）
