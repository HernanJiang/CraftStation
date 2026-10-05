# v1.7 性能与结构优化 —— Profile 报告与可行性分析

> 版本目标：v1.7（性能优化专项）。本报告供其他 Agent 拆任务执行。
> 生成日期：2026-09-30。基线版本：`v1.6.6`（commit `b5d820e0`）。
> 生成方式：静态代码审计 + dist 产物测量 + sourcemap 归因。**未做真机计时**，所有"毫秒数"类结论均为待验证目标，不是已测事实。

---

## 0. TL;DR —— 一页结论

| 维度           | 现状判定                                                                                                    | 最大杠杆                              | 预期收益                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| **首屏加载**   | 🔴 首屏 JS ~9-10MB（min），vendor 5.37MB 含 ~5.7MB 源码的 deferred-only 依赖                                | **拆分 vendor catch-all**             | 首屏 JS 减半，冷启动 parse 时间可降 40-60% |
| **运行时内存** | 🟡 xterm dispose 路径完整，但 scrollback=5000/实例、LegendList `recycleItems=false`、隐藏终端持续绘制待验证 | 终端/长线程驻留审计                   | 长时驻留内存增量可控性提升                 |
| **链接稳定性** | 🟢 远程 socket 已有 25s 心跳 + full-jitter 指数退避；turn 级重试已存在                                      | transport 断链与 turn 重试分层统一    | 弱网下可感知失败率下降                     |
| **持久层**     | 🟢 WAL + NORMAL + busy_timeout + 关库 checkpoint 已配置                                                     | 高频写盘审计（settings/usage ledger） | 消除偶发 UI jank                           |
| **结构**       | 🟡 构建分层成熟（manualChunks/deferred/modulePreload 都在），但 catch-all vendor 破坏了分层意图             | 见 T03                                | —                                          |

**一句话：构建层基础设施已就位，问题集中在「catch-all vendor 把懒加载依赖又拉回首屏」这一件事上；运行时侧多是待验证的驻留与调度问题，不是明显的实现缺失。**

---

## 1. 执行环境与基线

- OS：Windows 11，Electron + Node >=24.10，pnpm 11.19
- 构建：Vite/Rolldown，`vite.config.ts` 395–467 行 manualChunks
- dist 总体：**~208 MB**（含 sourcemap/重复平台产物）
- 已测 dist 产物（`dist/renderer/assets/`）：

| Chunk                      | min 体积    | sourcemap 源码量 | 首屏加载?                                |
| -------------------------- | ----------- | ---------------- | ---------------------------------------- |
| `vendor-D-7O2p_A.js`       | **5.37 MB** | **12.23 MB**     | ✅ 是（index 静态 import）               |
| `git-diff-*.js`            | 1.02 MB     | —                | ✅ 是（index 静态 import + vendor 引用） |
| `shiki-*.js`               | 0.71 MB     | —                | ✅ 是（vendor 静态 import）              |
| `ui-*.js`                  | 0.48 MB     | —                | ✅ 是                                    |
| `app-*.js`                 | 0.43 MB     | —                | ✅ 是                                    |
| `xterm-*.js`               | 0.65 MB     | —                | 否（deferred）                           |
| `diffBuildWorker`          | 0.92 MB     | —                | worker 线程                              |
| `voiceTranscriptionWorker` | 0.50 MB     | —                | worker 线程                              |

### 1.1 首屏实际加载链路（实测 import 图）

```
index (entry)
 ├─ static: rendererGlobalErrors, framework, git-diff(1MB), bridge,
 │          vendor(5.4MB), sentry, channel, i18n, applyAppTheme
 └─ vendor 内部 static: shiki(0.71MB), ui, git-diff
app chunk
 └─ static: ~70 个 chunk（含 ItemMarkdown、各 store、view 组件）
```

**结论：首屏 JS ≈ 9–10 MB minified。** `modulePreload` 过滤只控制 `<link rel=modulepreload>` 预加载提示，静态 `import` 链照样下载执行——这是当前过滤失效的原因。

### 1.2 vendor 中确认的 deferred-only 依赖（sourcemap 归因）

| 依赖族                                                                       | 源码体积    | 实际使用路径                     | 首屏必需?           |
| ---------------------------------------------------------------------------- | ----------- | -------------------------------- | ------------------- |
| mermaid + `@mermaid-js/parser` + cytoscape + layout-base + cose-base + dagre | **~5.7 MB** | 仅 Markdown mermaid 渲染         | ❌                  |
| KaTeX                                                                        | 586 KB      | 仅 Markdown 公式                 | ❌                  |
| Tiptap + ProseMirror 全家桶                                                  | ~700 KB     | 仅 Notes 编辑器                  | ❌                  |
| jsqr + qrcode + parse5 链路                                                  | ~320 KB     | 仅 Remote Access 二维码          | ❌                  |
| streamdown                                                                   | 67 KB       | ItemMarkdownInner（已 deferred） | ❌ 但被 vendor 捕获 |
| `@huggingface/transformers`                                                  | (在 vendor) | voiceTranscriptionWorker         | ❌                  |
| `@legendapp/list`                                                            | 307 KB      | MessageList                      | ✅ 首屏需要         |
| lucide-react                                                                 | 309 KB      | 全局图标                         | ✅ 部分需要         |
| Sentry core                                                                  | 236 KB      | 全局错误监控                     | ✅ 需要             |
| Dexie                                                                        | 95 KB       | renderer 持久层                  | 待确认              |

**机制根因**：`vendor` 组 `test: /node_modules/` 是 catch-all——**它不按是否懒加载区分**。streamdown/mermaid 等虽然宿主组件走 `Deferred*`，但依赖本身被 vendor 捕获 → vendor 被首屏静态引用 → 全量进首屏。

---

## 2. 各维度详查

### 2.1 启动链路（已测结构，未测时延）

链路：`app.whenReady` → main 建窗 → preload/bridge 注入 → renderer document → `useAppHydration`（store 水合 + `runtimeSnapshotsReady` 两阶段闸门）→ `MainView` 挂载 → 各 Deferred 组件按需拉取。

已具备的计时点：`loadT0` + `[renderer] +Xms` 打点日志已存在。
**缺口**：打点没有汇聚成指标、没有覆盖 main 进程段落、没有持久化/上报。

### 2.2 运行时内存

| 对象           | 现状                                                                                                                            | 风险                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| xterm          | `scrollback: 5000`/实例；WebGL addon + `dispose()` 在 unmount 完整调用（XTermSurface.tsx:836-857）；context-loss 有兜底 dispose | 🟡 **每个驻留终端 ~5000 行缓冲 × N 终端**；隐藏终端是否暂停绘制未验证；GPU 进程合成纹理驻留待测 |
| MessageList    | 已用 `@legendapp/list`（真虚拟化），但 **`recycleItems={false}`** —— 不回收 DOM 节点                                            | 🟡 万级消息线程滚过后 DOM 节点数持续增长；注释显示是为了修「测量顺序」问题，回收开启可能回归    |
| Zustand stores | `providerUsage`/`agentStatuses`/`gitRefresh` 等多个全局 store                                                                   | 待验证：组件订阅是否都走 selector/`useShallow`，粗粒度订阅会造成无关重渲染                      |
| Provider usage | ✅ **手动刷新为主**（`useProviderUsageRefresh` 仅 on-demand），无后台轮询                                                       | 低                                                                                              |
| 定时器         | `gitRefresh` PR pending 30s 轮询；`remoteServers` healthPing 25s；`agentLoginActions` pollTimer（登录流程内）                   | 🟡 **均未发现 `document.visibilityState` 门控**——窗口最小化/隐藏时照跑                          |

### 2.3 链接稳定性

| 链路                 | 现状                                                                                                          | 缺口                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Remote socket        | ✅ 25s 心跳 + full-jitter 指数退避（`backoff.ts`: `min(max, base*2^attempt)`）+ `RemoteSocketReconnectPolicy` | 退避上限/无限重试语义待确认；断线时 UI 状态降级待验证                                                      |
| renderer↔supervisor  | IPC/contextBridge 为主                                                                                        | turn 级 `turnRetryCoordinator` 与 transport 断链分属两层，未统一——transport 断开的恢复不在 turn 重试覆盖内 |
| ACP/provider session | `provider-chat-smoke` 技能已覆盖 Qwen/Kimi/ACP 端到端                                                         | 断线 resume、消息重放、去重语义需 case 化                                                                  |
| WSL/SSH              | 有 bridge                                                                                                     | keepalive 与重连参数待审                                                                                   |

### 2.4 持久层

✅ SQLite 已配置：`journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`、`busy_timeout=5000`、关库 `wal_checkpoint(TRUNCATE)`、多条线程表索引（`idx_thread_native_sessions_thread`、`idx_thread_exchanges_*` 等）。
🟡 **缺口**：settings 写频未审——若 zoom/token delta/provider snapshot 等高频变化直接穿透写盘，会产生周期性 jank；usage_events 有定期清理（`DELETE WHERE ts < cutoff`）但 batch/阈值策略待确认。

---

## 3. 优化建议（按优先级）

### 🔴 P0 —— 高收益低风险，先做

**T03｜Vendor chunk 拆分（本报告最大发现）**

- 文件：`vite.config.ts` codeSplitting groups + `modulePreload.resolveDependencies`
- 改法：给 `mermaid`/`@mermaid-js/*`/`cytoscape`/`*-base`/`dagre-d3-es`、`katex`、`@tiptap/*`+`prosemirror-*`、`qrcode`/`jsqr`/`parse5`、`@huggingface/transformers`、`streamdown` 单独建 priority>10 的 group；vendor catch-all 保持兜底
- 验收：构建后 vendor chunk ≤1.5MB；`index` entry 静态 import 链中不再出现这些 chunk；首屏 JS 总量 ≤4MB；开一条含 mermaid+KaTeX 的消息、开 Notes、开 Remote Access 二维码各自确认 lazy 加载成功
- 风险：分组边界写错会拆出循环 chunk——构建后必须检查 import 图无环
- 预估工作量：0.5–1 天

**T01｜性能埋点基线**

- 在 `loadT0` 打点基础上汇聚：main `whenReady`→窗创建→renderer DOMContentLoaded→hydration 两阶段→first paint→可交互 各 `performance.mark`，输出到 dev bridge/日志
- 验收：冷启动一次能产出分段毫秒表；四进程 RSS 基线（空闲/10 线程/开终端）可复现
- 工作量：0.5 天

### 🟡 P1 —— 中收益，需要验证支撑

**T04｜消息列表内存**

- 审计 `recycleItems=false` 的取舍（当初为什么关）；测 1k/5k/10k 消息线程滚到底后 DOM 节点数与 renderer RSS；评估按 `itemId` key 稳定 + 开启回收的可行性
- 验收：长线程滚动后 DOM 节点数有界；滚动帧率 ≥55fps
- 工作量：1–2 天（含回归测试）

**T05｜终端驻留与 GPU 内存**

- 测 N 个终端并存时的 renderer/GPU RSS；验证隐藏终端是否还在 paint（WebGL 合成器帧）；评估隐藏时 `webglAddon` 降级 canvas 或暂停渲染
- 验收：隐藏终端不产 GPU 帧；关闭终端后 RSS 回落到基线 ±10%
- 工作量：1–2 天

**T07｜轮询统一调度 + 可见性降频**

- 把 `gitRefresh`(30s)、`remoteServers` healthPing(25s)、`agentLoginActions` pollTimer 收敛到一个调度器；`document.hidden` 时降频或暂停
- 验收：窗口 hidden 后定时器触发次数显著下降；恢复可见时状态最终一致
- 工作量：0.5–1 天

### 🟢 P2 —— 结构性，排最后

**T02** renderer 启动/hydration 优化（依赖 T01 数据定位瓶颈后再动）
**T06** Zustand 订阅粒度审计（selector/useShallow 覆盖检查）
**T08** SQLite 高频写盘审计（settings/usage/token delta 是否每笔落盘 → debounce/batch）
**T09** transport 断链与 turn 重试分层统一（把 WS/IPC 断链纳入统一恢复语义，扩大 `turnRetryCoordinator` 覆盖或在其旁建 transport 层重试）
**T10** 全功能回归 + interactive-testing 套件（每次合并前跑）
**T11** 前后对照 benchmark 并设为 release gate（T01 产出的指标跑前后对比）

---

## 4. 不建议动 / 已够好

- ❌ 不要重写虚拟列表——`@legendapp/list` 已是正确选型，问题是 `recycleItems` 配置
- ❌ 不要动 SQLite pragmas——WAL/NORMAL/busy_timeout/checkpoint 已经是教科书配置
- ❌ 不要引入新的懒加载框架——`Deferred*` + codeSplitting 机制已存在，只是分组不完整
- ❌ 不要为了"可能的"内存问题提前重构——先跑 T01/T04/T05 的测量
- ❌ 不要把 `lucide-react`/`@legendapp/list`/Sentry 移出 vendor——首屏真需要

---

## 5. 待验证假设（报告中未测量的）

1. mermaid/katex 拆出后 vendor 是否真的降到 ~1.5MB（取决于 rolldown 的 chunk 归并行为）
2. 隐藏终端是否仍在绘制（需 GPU 进程 profile）
3. `recycleItems=false` 当初修复的「测量顺序」问题在开启回收后是否复现
4. settings/zoom/token delta 是否每笔写盘（需追踪 `dbSetState` 调用频率）
5. transport 断链后的实际恢复行为（需断网测试）

## 6. 需要用户提供

- 无阻塞项。所有测量可在本机完成；真实 provider 链路验证需要可用的 Qwen/Kimi/OpenCode 凭据（`provider-chat-smoke` 用）。

---

## 7. 任务派发清单（可直接开线程）

每个 ticket 建议独立 Agent 线程，命名 `Coder-1.7-<ShortDesc>`，projectId `16cc8579-4db8-4ce6-89c3-a12a48187705`：

```
v1.7/T01  Performance instrumentation and baseline     [先做，输出指标给其他 ticket]
v1.7/T02  Renderer startup and hydration optimization  [依赖 T01]
v1.7/T03  Vendor chunk and deferred dependency splitting  [P0，可并行]
v1.7/T04  Chat timeline virtualization and long-thread memory
v1.7/T05  Terminal lifecycle and GPU memory
v1.7/T06  Zustand subscription and rerender audit
v1.7/T07  Polling scheduler consolidation and visibility throttling
v1.7/T08  SQLite query/index and persistence write audit
v1.7/T09  IPC/WS/ACP reconnect and session recovery
v1.7/T10  Full functional regression and interactive smoke suite
v1.7/T11  Before/after benchmark and release gate        [最后收口]
```

建议执行顺序：**T01 + T03 并行 → T04/T05/T07 并行 → T06/T08/T09 → T10/T11 收口**。
