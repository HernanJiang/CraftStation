# v1.4.0 第二轮：资源占用、文件引用、权限与 Recipe 执行

本报告补充[第一轮实施报告](report_1.4.0_architecture.md)及[1,277 ID 功能与历史账本](report_1.4.0_coverage.md)。第二轮依据实际源码、自动测试与隔离应用运行证据继续修复。第一轮关于 Codex 配额和 Kimi 无有效凭据的结论仅描述当时选中的账号；第二轮已从用户 1.3.4 的托管账号中导入有效凭据，验证结果另列。没有修改原账号目录、读取用户会话内容作测试，或在报告中保存密钥。

## 1. 代码与边界

### 文件引用

修复 Windows Markdown 文件链接中的 `/D:/...` 盘符前导斜杠；URI 只解码一次，中文、空格、`%2520`、UNC、项目相对路径分别处理。普通路径中的 `%20` 不擅自替换，POSIX 大小写与绝对路径语义保持。链接解析、自动链接和点击打开沿同一解析边界；不修改截图里的外部 EQ-Agent 文件。

### 权限

提取共享默认权限解析，依目标 CLI 公布的能力选择其权限 ID。显式选择优先于全局默认；非法字段逐项保守降级，不能因某一个字段不支持就把其余字段重置为完全访问。Home 中显式权限也保留；旧版没有任何权限选择的 Home 路径保持兼容。

Recipe → CraftPlan → Entity → Session 增加结构化 `permissionConfig`，涵盖审批、审批者与 sandbox。Codex owned app-server、native OpenCode、structured/PTY、首轮/后续轮/恢复均继续传递适用配置。审批拒绝、Stop 与账号错误仍是不同语义，不能自动提权或把用户中断当网络失败重试。

### 自定义 Recipe 与 CPA

- 模型来源与执行 Harness 分离。自定义模型从当前目录读取精确 `modelId`/来源账号；选择的 Recipe Harness 不能被模型来源偷偷替换。保留旧配方恢复信息与失效时的明确错误。
- CPA 只负责认证和协议转换，实际会话复用目标 Harness 的正式 structured 接口；Codex 继续使用 owned native app-server。会话、MCP、技能、权限、Stop、恢复属于目标 Harness。
- Codex endpoint 配置使用隔离 profile，启动时不再被订阅模式配置重写，不继承宿主路由覆盖。第三方 key 只进入所属子进程环境。
- Kimi endpoint 写入其实际读取的 provider/model 表；保留含 `/` 的模型别名，包含必填 `max_context_size`。未知窗口采用本机 CLI 相同的 262,144 客户端默认预算，不代表服务商保证该上下文长度。
- OpenCode endpoint 中的 `vendor/model` 作为目标 endpoint 的模型身份，不转去宿主同名供应商鉴权。
- CPA OAuth 投影兼容 Codex nested tokens、Kimi 与 Grok OIDC，保留刷新、到期与设备标识。源凭据不变时不重写 CPA 已轮换的副本；CPA 写入中的空文件或半 JSON 也不能触发旧 token 覆盖。
- CPA 启动去重，同账号同配置并发共享，运行/启动中切账号或改路由明确拒绝。最后一个使用者退出才停止共享桥。
- CPA 显式复用应用代理解析结果并写入 `proxy-url`。实机上仅设置 `HTTP_PROXY` 不足以让 CPA 的上游传输生效，修复后同一订阅经 CPA 在 Kimi、OpenCode 中均返回正确回答；凭据没有重录。
- runtime 按实例拥有资源，不能按 Harness 名称覆盖后丢失旧进程。创建失败、关闭以及启动中迟到 Session 均回收；不同线程分别释放。

真实运行还发现并修复三个串联问题：技能片段遮蔽用户 Prompt；OpenCode `promptAsync` 的接收回执被当作回答结束；晚到的账号绑定用启动旧快照覆盖最新状态和 Session 引用。分别通过原始文本保全、显式回合完成契约、只合并当前线程字段修复。自动可发现技能与用户显式调用技能分离，不把所有已启用技能自动解释成用户要求执行的任务。

后续真实双线程验证补齐了以下防线：

- WAL 双连接写入：批事务在读位置/旧条目前取得写锁，避免默认 deferred 事务升级时抛 `SQLITE_BUSY_SNAPSHOT`。新增独立 Worker 持写锁、生产持久化连接写完整回答的回归；旧实现稳定失败，修复后成功，保留原子回滚与连接重开隔离。
- 首轮与追问的 `userMessageItemId` 经 IPC → CraftSession → native handle 传递，消除 optimistic 文本与 provider echo 双行。structured runtime 同时发布完整用户条目供数据库/配对客户端使用；不能仅在 renderer 去重而丢失落盘记录。
- 合成会话沿公共 `thread-state` 通道发布启动、审批/问答和终态，native Session 引用持久化；不为每个 token 复制全量历史。
- OpenCode 快速 Stop 与 prompt admission 竞态：受理之前收到的中断要在受理后再次发送；abort 回执不能提前将回合标记为已中断而使 watchdog 失效。超时还要退出无响应 Session，不能只更新 UI 而让后台继续运行。
- 更早的桌面发送前检查点等待也可取消。界面已 optimistic 标记工作中、实际 Prompt 尚未发出时点击 Stop，会终止本地待发送项；检查点晚到或晚失败均不能重新发出已取消 Prompt，也不能覆盖下一轮状态。
- 重载恢复保留首个 Segment 的完整脱敏 CraftPlan 和账号绑定。原实现只有切换 Harness 后才保存完整计划，首次合成重载却生成随机 recovered ID，触发 `HANDOFF_ACTIVE_PLAN_MISMATCH`。旧记录仅在 Recipe、Result、模型、Harness、Vendor、路由与 native Session 均匹配时恢复原计划 ID；原有防串线校验不放宽。
- renderer 重载复用仍然存活的同一 Session，不再重复 spawn 同 native ID 的对象而保留旧订阅；恢复也透传 optimistic 消息 ID，避免双行。相同 ID 但不同模型、配方、来源账号或 native Session 仍拒绝恢复。
- Codex `declined` 终态不能映射成命令执行成功；拒绝命令明确标记错误及拒绝原因。修改不等于证明每个外部模型都能按要求触发审批。

## 2. 性能与代价

以下是局部生产链路基准，不能折算为整机占用或模型回答速度。机器为 Windows，Node `v24.18.1`。数据库每个场景预热一次、采样五次取中位数；内存试验使用独立 Node 进程及显式 GC。具体原始数值见第二轮证据文件。

| 场景                                    |       改造前 |      改造后 | 解释                                                                                         |
| --------------------------------------- | -----------: | ----------: | -------------------------------------------------------------------------------------------- |
| 1 线程 / 1,000 次持久化 wall time       |    210.42 ms |   145.45 ms | 同一连接复用 prepared statements，约减少 30.9%                                               |
| 同场景 CPU 时间                         |       187 ms |      110 ms | 约减少 41.2%，不是任务管理器 CPU 百分比                                                      |
| 8 线程交错 / 8,000 次持久化 wall time   |  1,652.50 ms | 1,645.15 ms | 约减少 0.4%，无明显改善；单连接交错，不是假称 8 核并行                                       |
| 同场景 CPU 时间                         |     1,359 ms |    1,360 ms | 无改善；最终版本包含双连接写入正确性修复                                                     |
| 高亮 80 个 JSON 块后保留堆增量          |    24.72 MiB |    4.39 MiB | 实际 Shiki；缓存增加 8 MiB 保守字符串预算及 200 项 LRU，内容仍完整渲染                       |
| 10,000 个短生命周期日志路径后保留堆增量 |  2,684,632 B |    71,152 B | 生产 writer、模拟磁盘；空闲 entry 从 10,000 个降到 0                                         |
| 安装包 SQLite build 子树                | 36,932,928 B | 2,024,448 B | 最终 NSIS 包后核验：去掉 55 个编译中间文件，减少 34,908,480 B（33.29 MiB），保留两个 `.node` |

数据库事务原子性、WAL、rollback 与内容保留；事务取得写锁提前到读操作之前。中间版 8 线程 CPU 曾为 938 ms，但包含 WAL 正确性修复的最终实测为 1,360 ms，以最终数据为准，不沿用中间版收益。8 线程场景峰值 heap 增量中位数 **23.82 → 26.77 MiB**，未证明这项优化降低内存；数据库大小与 WAL 大小不变。高亮试验每种配置一次，CPU **1,907 → 2,031 ms**，未证明 CPU 改善；内存预算可能增加再次访问被驱逐代码块时的渲染计算。日志试验的文件系统为模拟，不将它当作磁盘吞吐数据。

第一轮 15,000 事件增量广播 **170.73 → 43.39 ms**；每条事件全读历史的 5,000 事件压力场景 **26.36 → 81.60 ms** 退化仍公开保留。没有删除历史事件、缩短会话或吞文本换速度。

整机测量脚本记录 owned Electron 进程树、CPU 时间、私有提交、工作集与 I/O。旧前测与最终功能/进程组合不同，不能组成可靠 A/B；多个进程工作集相加会重复共享页，I/O 包含 IPC，不能直接称物理内存或磁盘写入。本轮不宣称整机 CPU/RSS 降低某个百分比。最终开发应用在 CPA → OpenCode 两轮结束后采样 14.84 秒：16 逻辑处理器总容量下 CPU 约 0.75%，进程树私有提交中位数 1,862.99 MiB、工作集加总 2,724.32 MiB；这是开发态含外部 CLI 的绝对快照，不是正式包体内存，也不是前后性能提升证据。

## 3. 语言治理

统计百分比不是运行成本：CSS/HTML 不负责业务领域模型，Swift/Java 是移动端系统桥接，JavaScript 多数是直接运行的构建、扩展与 service worker 脚本。源码核对发现 Swift 15 文件约 52 KB、Java 6 文件约 20 KB；包括 iOS Activity、SSH、安全存储/推送与 Android 入口。它们不能只改扩展名变为 TS，否则会丢系统能力。

本轮可共享的权限、配方身份、endpoint、资源生命周期、历史缓存均用 TS，不新增第二套业务逻辑。保留已有 `native/peripheral-sidecar/src/main.rs`，未新引入 Rust 模块。测量暴露的是 SQL 重复 prepare、缓存保活和多进程生命周期，现有 TS 改动已经直接解决；没有数据支持付出跨语言通信、打包与调试成本去重写。CPA 独立 Go 实现继续通过公开接口使用。

## 4. 验证状态

自动测试全量结果为 **11,855 通过 / 66 跳过 / 0 失败，1,098 文件**。全量运行期间继续补充了检查点取消和恢复路径修复，因此这里采用“全量 + 最后增量定向复验”的证据口径，不称单次冻结源码全量通过。最后恢复组为 161 通过 / 1 跳过，检查点取消组 9 通过；并发持久化、Stop、Segment 防串线等复验详见[测试清单](report_1.4.0_round2_tests.json)与[证据摘要](report_1.4.0_round2_evidence.json)。最终 TypeScript 检查、完整 lint、`git diff --check` 通过；完整桌面 mock smoke 的 9 个自动场景、16 个模拟门均通过，捕获 console/runtime error 为 0，owned 应用已停止。性能专用测试由独立命令启用，普通全量中跳过是有意行为。

| 真实运行场景                 | 结果与范围                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Codex 原生托管账号           | 实际返回指定回答；凭据复用 1.3.4，未覆盖源账号                                                                                |
| Kimi 原生托管账号            | 首轮与追问均收到指定回答                                                                                                      |
| 第三方 Responses API → Codex | `DIRECT_API_VERIFIED_OK`；随后返回本地文件链接并打开                                                                          |
| Codex 订阅 → CPA → Kimi      | 首轮、追问与后续并发验证均返回指定回答                                                                                        |
| Codex 订阅 → CPA → OpenCode  | 首轮、追问；用户消息与回答完整落库                                                                                            |
| 快速 Stop                    | 发送前检查点等待可取消；随后同一会话再次发问得到 `AFTER_STOP_FINAL_OK`                                                        |
| renderer 重载恢复            | 同 native Session；`REATTACH_FIRST_OK` / `REATTACH_SECOND_OK`，DB 两条用户消息、UI 第二条只出现一次，最终 idle、Stop 按钮消失 |
| Windows 文件引用             | 中文空格路径及盘符前导斜杠，实际编辑器显示 `FILE_LINK_VERIFIED_OK`                                                            |
| Codex 审批                   | 出现审批卡片、点击 Deny、pending 请求消退；未收到完整模型拒绝确认，完整审批闭环 **NOT_RUN**；`declined` 映射另有自动回归      |

真实 Recipe 首轮使用生产合成 action 调用，追问、Stop、文件打开经过界面。最终恢复追问通过 DOM 按钮点击触发：CDP 鼠标动作两次没有提交，确认输入仍留在编辑器、DB 没有新行后才改用 DOM 点击；不是绕过提交逻辑直接调用模型接口。不把这些证据称为完整拖拽合成台的全部交互验收。

截图：[文件引用](report_1.4.0_assets/round2-file-link-verified.png)、[快速 Stop](report_1.4.0_assets/round2-fast-stop-fixed.png)、[重载后两轮完成](report_1.4.0_assets/round2-reattach-verified.png)。原始运行材料留在本机隔离 smoke 目录；公开摘要去除凭据和无关模型思考文本。

验证中遇到的失败没有改写成通过：双连接数据库锁、快速 Stop、初始计划恢复、重载旧订阅均先实机暴露再修复。一次人工构造错误的 AppView 数据导致 error boundary，属于验证操作错误；一次新 fixture 未放置 CPA 二进制，按正常 `RUNTIME_UNAVAILABLE` 拒绝，补齐隔离工具后成功。CDP 异步 import 曾返回 `Promise was collected`，均以线程、回答、数据库和界面的实际结果确认，未据该调用错误重复启动同一请求。

尚未覆盖完整 provider 问答、steer、实时换模型、所有 Harness × 模型矩阵、跨 Harness handoff/peer、真实 MCP 工具/Computer Use、SSH/WSL、macOS/Linux、移动真机与安装升级全过程。66 个跳过项逐项列在证据 JSON；mock 不能代替这些外部门。1,277 ID 账本完整不等于每个细分功能已端到端 PASS。

## 5. 构建与提交

按顺序执行 `pnpm dist:win` 与 `pnpm dist:win:portable --skip-build`，均成功。两个包均经过 afterPack 的 SQLite/node-pty 原生加载检查；最终便携包展开目录再次核对 SQLite build 仅 2 文件 / 2,024,448 B。CPA 二进制 69,062,144 B 和既有 peripheral sidecar 247,296 B 均包含在资源中。

产物位于本版本工作树的 `release/`：

| 文件                                        |        字节 |
| ------------------------------------------- | ----------: |
| `CraftStation-Setup-1.4.0-x64.exe`          | 148,318,720 |
| `CraftStation-Portable-1.4.0-x64.exe`       | 127,127,393 |
| `CraftStation-Setup-1.4.0-x64.exe.blockmap` |     153,657 |
| `latest.yml`                                |         361 |

包体验证限构建、资源与原生加载；没有对用户正在使用的 1.3.4 执行安装升级。中间目录清理经过绝对路径和非链接核验后仍被自动批准审核拒绝（仅返回 `blocked by policy`），故 `release/win-unpacked` 与 `builder-debug.yml` 保留，未改用其他工具绕过。主仓库的稳定版产物未动。

版本分支提交到 `HernanJiang/CraftStation`，目标 PR 为 `main`；候选提交不等同正式发布。历史继承 changelog 存在旧同号 1.4.0 条目，正式 Release 前需统一处理，当前不覆盖其历史内容。
