# Craft-Harness goal 修复与验证 — 1.9.1

日期：2026-10-10。工作区：`D:/Work/CraftStation`，`main`；起点 `7df9a277`。本报告仅评价 goal 与共享 runtime 改动，不表示每个 provider、账号、操作系统和产品功能均已真实验收。

## 对照与修复

对照官方 [Codex goals 说明](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) 和只读 `reference/codex/codex-rs/ext/goal/`：目标独立于单轮回复；普通回合结束检查目标、用户输入、待处理请求与预算；自动回合没有工具调用时停止重复续跑。官方 Harness 继续拥有 Agent Loop、上下文压缩和工具执行。

截图中的 remote compact / error sending request 属于可重试的网络失败，不能算目标完成。源码审计与回归复现了原生自动回合绕过旧重试关联、goal IPC 只查询旧会话表、首次启动读取旧 Thread 对象，以及恢复时目标控制无效等问题；无法仅凭截图确定网络中断的外部原因。

- Craft-Harness `GoalCoordinator` 持久保存目标、生命周期、去重用量与暂停状态；原生 CraftSession、structured 会话和可信 CLI hook 消费同一事件入口。
- 统一 `create_goal` / `get_goal` / `update_goal`。完成必须携带具体证据；模型报告 blocked 必须跨连续三个目标回合审计。运行失败在有上限的重试结束后保留目标供用户继续。
- 自动续跑等待用户排队消息、问题/权限请求和模型切换，跳过计划模式；无工具调用的自动回合设置 deferred，防止空转。Stop 与新输入取消过时重试。
- 关闭 CraftStation 启动的 Codex 原生 goal 调度，避免两个调度者；自动续跑保留 model、effort、permission 和 service tier。
- 原生 OpenCode、DeepSeek 接入目标 MCP；OpenCode 按凭据隔离进程，DeepSeek 使用官方 Cordis overlay，凭据通过子进程环境传递。ACP 使用通用 stdio 转发，拒绝静默移除目标工具。
- 首轮启动先注册目标。暂停/恢复/清除走公共 IPC；会话关闭后的恢复可重新启动原 Session，远程客户端保留主机的 requiresLaunch 返回结果。
- 升级时首次重注册会导入匹配目标的旧 runtime checkpoint：保留完成/暂停/预算停止状态与已用 tokens、时间、检查次数。旧 Codex 将账号额度停止也映射为 budget_limited；预算仍有余额时导入为 usage_limited，允许恢复额度后继续。已有 Craft-Harness 持久状态时忽略 checkpoint，用户明确编辑新目标时也不导入旧状态；防止旧目标被意外激活或清零预算。

纯 PTY 若没有可信的回合结束与工具进度信号，无法保证自动续跑或 per-turn 重试。其他 provider 的协议接入经过测试，但未把“CLI 已检测到”当作真实运行通过。

## 验证证据

### 真实 Codex（Windows）

1. 新线程 `e669a931-6e32-492e-a0ce-5bd925b428b9`：首轮读取隔离项目 `hello.txt`、get_goal 返回正确 active 目标；普通回合完成后自动启动第二轮，再次读取并 update_goal complete，reason 包含 `fixture data`。最终 idle、complete。证据：`C:/Users/Haona/.craftstation-smoke/debug-1791605453061-18396/artifacts/goal-live-evidence.json`、`goal-codex-auto-complete.png`。
2. 另一新线程 `eacb2d54-95fc-4be4-a6f0-6d6d1d3d0f1b`：通过真实输入框设置目标，暂停按钮中断回合；关闭隔离运行会话，再点击继续目标，恢复原 provider Session `01a1241e-9a30-75a3-a73e-a782aa781dfa`。自动无工具回合设置 deferred，目标保留 active；发送“验收完成”后再次读取文件并提交完成证据，最终 complete、idle。清除按钮随后移除持久目标（goals.json 为 `[]`）。证据：`D:/Work/CraftStation-release-archive/goal-1.9.1-real-final/artifacts/goal-resume-evidence.json`、`goal-resume-complete.png`。后补的升级 checkpoint 兼容逻辑通过单测验证，未重复执行真实模型回合。
3. Kimi K2.7 在隔离实例启动返回 `Authentication required`；没有真实模型答复，记为外部鉴权受阻。Qwen 未安装，其他模型/平台未逐一真实验证。

测试只使用隔离项目与会话。已验证的真实实例均通过托管 reset/stop 收尾，没有修改截图中的用户会话。

### 自动检查

- TypeScript、普通与 type-aware lint、diff whitespace 检查通过。
- goal 状态机、HTTP MCP、重试、首次启动、恢复、IPC、OpenCode 配置隔离、DeepSeek Cordis 和 ACP 必须保留目标工具均有回归测试。最后一轮 ACP/runtime 专项：274 项通过，1 项条件跳过；远程启动/客户端 73 项通过，HTTP 主机返回链路 1 项通过。
- 完整单测：1130 文件、12617 项通过，21 文件/67 项条件跳过，命令 exit 0。前两次出现 SubAgentOverlay 异步渲染等待超时、Windows 临时目录清理 EPERM；原文件分别通过 13 项、127 项专项重跑，并补上临时目录清理重试。完整回归后补充旧目标 checkpoint 保留，7 文件/159 项专项通过，涵盖完成/暂停/预算停止/失败导入、已有持久状态优先、目标不匹配拒绝导入与首次启动；类型检查和 lint 再次通过。随后额度停止导入兼容的状态机文件 20 项通过，完整单测未重复运行。
- 功能覆盖清单审计：2129 个产品文件映射到 26 个功能区，通过。
- Electron goal 自动场景通过：编辑、暂停、相同目标重注册、继续与清除；覆盖 renderer → preload → main → supervisor。
- 最终干净实例全量 mock：15 个自动场景全部通过、16 个门禁以 mock 方式通过，console/runtime errors 为 0，命令 exit 0；包含 goal、设置、浏览器、网页对话、输入光标、预览原生 hit-test、协作布局与窄屏菜单。报告：`D:/Work/CraftStation-release-archive/goal-1.9.1-mock-clean/artifacts/smoke-report.json`；实例已停止。之前复用实例的网页 fixture 重复导入、原生预览 hit-test 失败未计为通过。脚本现在恢复主应用入口和输入焦点；干净实例保留全部原断言。mock 门禁不能替代真实 provider/鉴权/PTY/权限请求验收。

## 产物与清理

Windows x64 NSIS 与 portable 均已构建，exit 0；复用同一份最终生产编译输出，17 项 runtime dependencies 与 better-sqlite3 / node-pty 原生二进制检查通过。安装包与便携包阶段的 app.asar 内 supervisor 均与最终编译文件一致（SHA-256 `d7243823a0e5a858ddae382aae1a850c18777300fc7cf8e66fd7f1ba138f1797`），已确认包含最后的额度停止 checkpoint 兼容逻辑。提交格式化后重新编译，哈希保持一致。

| 文件                                      |      字节 | SHA-256                                                            |
| ----------------------------------------- | --------: | ------------------------------------------------------------------ |
| CraftStation-Setup-1.9.1-x64.exe          | 148844485 | `04f8acb9b6de6b2d1d873c259260eaf5a19a97a501e33c5d5a9e2be883d52897` |
| CraftStation-Setup-1.9.1-x64.exe.blockmap |    155019 | `89d65667aafe101cf2745b5079a69ae25c2d3b3a90ed2070be2791378f6b161b` |
| latest.yml                                |       361 | `7c91f067ad9f34100b7ed58b4a404373cd7be83c71583d1b409a573985a173cd` |
| CraftStation-Portable-1.9.1-x64.exe       | 127483150 | `36b8650602d57e033b2b455d7ab82dea4c283ecb6645816d85d5aba7873828ae` |

`latest.yml` 指向 1.9.1 NSIS，SHA-512 与 size 均通过校验；便携包构建未覆盖安装包更新清单。验证记录：`D:/Work/CraftStation-release-archive/goal-1.9.1-fixtures/release-nsis-verification.json`、`release-portable-verification.json`。

修复提交 `6b73bb52867c64638fce9c94b5debbb7ab6968ca` 与 `v1.9.1` tag 已推送。[GitHub Release v1.9.1](https://github.com/HernanJiang/CraftStation/releases/tag/v1.9.1) 已正式发布并确认为最新稳定版，四个资产均 uploaded，GitHub 返回的 SHA-256 digest 与大小全部匹配上述本地结果，发布正文与双语 notes 文件一致。核验记录：`D:/Work/CraftStation-release-archive/goal-1.9.1-fixtures/published-release-verification.json`。发布前提交钩子的 type-aware lint、格式化与类型检查均通过。

`release/` 仅保留 1.9.1 与 1.9.0 两份稳定便携版；1.8.9 便携版、win-unpacked 与 builder-debug.yml 已移到 `D:/Work/CraftStation-release-archive/before-1.9.1/`。历版 NSIS、blockmap 和更新清单保留。本次为补丁版，按项目策略只发布 Windows。

系统盘在回归中耗尽空间；仅将本轮已停止实例的 home/data/local-app-data 移到 `D:/Work/CraftStation-release-archive/goal-1.9.1-fixtures/`，截图与报告保留原路径。后续实例与日志直接使用 D 盘。未整理用户配置或其他历史实例。
