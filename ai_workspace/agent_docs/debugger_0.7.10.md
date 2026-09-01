# Debugger 直接复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.10（Debugger 直接修复与 Agentic 真实验收）  
> 日期：2026-08-30  
> Worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`  
> 分支：`feature/v0.7-native-harnesses`  
> HEAD / base：`7ae6506`  

## Verdict

**FAIL / PARTIAL**

- **Engineering：PASS。** focused regression、31个触及TS/TSX静态门、typecheck与diff check均通过。
- **Antigravity真实response：PASS。** `agy 1.1.22`产品路径为`synthetic=false / PASS / responseLength=33 / marker=true / cleanup=true`。
- **Command Code + DeepSeek V4 Flash Agentic smoke：PASS。** 工具、Skill、后台子Agent、网络搜索、MCP、AGENTS自动读取、双轮resume、上下文显示、真实TTY `/compact`后继续消息均有真实证据。
- **官方DSH：FAIL / BLOCKED。** Windows carrier存在且产品transport实现成立，但当前artifact仍无真实assistant response；DSH高级Agentic能力未通过CraftStation产品路径逐项证明。
- **全部能力/全部模型总体：NOT PASS。** AGY没有`/compact`；本轮14模型14/14尝试，最终13个模型有严格marker PASS，仅Claude连续provider failure。
- **Main promotion：NOT AUTHORIZED。** 未commit/push/tag/merge/promotion。

Command Code上的DeepSeek成功不能替代官方DeepSeek Harness JSON-RPC产品路径成功；没有使用普通API、CLIProxyAPI、TUI注入或synthetic Entity/Session冒充DSH。

## Direct Fixes

本Debugger任务按用户最新授权直接完成既有v0.7修复与复检，不再回派Coder。当前工作树包含的直接修复包括：

1. Authorization/Bearer与嵌套正文深度脱敏；
2. ready carrier自行退出后的Session/transport/Supervisor cache自动释放；
3. DSH `aborted -> interrupted`、`blocked -> failed`、nested auth reason归一化；
4. 去除重复`turn.started`，普通stderr warning不误判turn failed；
5. 稳定`PROTOCOL_MISMATCH`错误语义；
6. Antigravity artifact不保存完整response；
7. DSH model允许`CRAFTSTATION_DSH_MODEL`覆盖；
8. 正常turn、readiness、shutdown deadline与AbortSignal/cleanup边界回归；
9. Windows npm shim安全解包、identity commit boundary与provisional cache清理。

本轮未修改NotesPanel源码来掩盖依赖错误。本地pnpm store里的`node-pty`和一组TipTap包是空/半包junction；仅在本v0.7 worktree的`node_modules`内从官方npm tarball恢复，`package.json`与`pnpm-lock.yaml`无diff。

## Evidence

### 工程门禁

| 检查 | 结果 |
|---|---|
| focused regression | 11 passed / 2 skipped files；156 passed / 7 skipped tests |
| `oxfmt --check` | 31/31 PASS |
| `oxlint --deny-warnings` | 31/31 PASS，0 warning / 0 error |
| `pnpm run typecheck` | PASS |
| `git diff --check` | PASS |
| credential/Bearer/private-key扫描 | 0命中 |

### Antigravity / agy 1.1.22

真实CraftStation路径：

`SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> agy.exe stream-json -> Entity -> Session`

最新artifact `v0.7.0-antigravity-product-path.json`：`synthetic=false`、`PASS`、33字符marker response、`session.exited` cleanup成立。

独立CLI NDJSON证据还确认：

- 原生工具：`find_by_name`、`run_command`、`view_file`、`list_dir`；
- 子Agent：`invoke_subagent -> AGY_SUBAGENT_OK`；
- Skill：`understand-explain -> AGY_SKILL_LOADED_OK`；
- 网络：`search_web`返回官方DeepSeek Harness GitHub URL；
- MCP：`call_mcp_tool`真实列目录并读取marker；
- AGENTS：`AGENTS_AUTO_READ_OK`；
- 多轮：同conversation两轮，`AGY_MULTITURN_RESUME_OK`；
- 压缩：`agy 1.1.22 --help`无`/compact`，命令行传入会报unexpected argument；print模式会把`/compact`当普通用户prompt，因此该能力为FAIL。

### Command Code 1.38.2 + DeepSeek V4 Flash

真实模型：`deepseek/deepseek-v4-flash`，`effort=high`。NDJSON观察到真实`model_request_start/model_request_end`。

- 原生工具：`read_file` / `read_directory`；
- Skill：读取`agentic-smoke/SKILL.md`并输出`SKILL_LOADED_OK`；
- 后台子Agent：`agent -> agent_output -> SUBAGENT_NATIVE_OK`；
- 网络搜索：`web_search`返回官方仓库；
- MCP：`mcp__craftstation-agentic-fs__read_file -> MCP_CONNECTED_OK`；
- AGENTS自动读取：`AGENTS_AUTO_READ_OK`；
- 双轮resume：session `adc6d105-459a-4525-bc39-3da8ba6027b5`返回`MULTITURN_RESUME_OK`；
- `/context`：真实TTY显示12.5k/1M、1.3%、987.5k remaining；
- `/compact`：真实TTY显示`Compacting conversation...`及`Conversation is already compact.`，随后同一TTY真实回复`COMPACTION_CONTINUED_OK`。

这证明Command Code CLI承载DeepSeek V4 Flash时的Agentic能力，不证明官方DSH adapter已集成这些能力。

### MCP与跨线程

- 宿主MCP工具可连接；
- 跨线程向`Debugger-0.8-OpenCode Native`发送消息，收到`CROSS_THREAD_MESSAGE_OK_V0711`；
- 临时AGY/Command Code MCP配置已移除，相关残留进程为0。

### 生产发现模型真实流量

本轮artifact：`v0.7.11-codex-discovered-model-real-traffic.json`。

- discovered：14；attempted：14；
- non-empty response：13；strict marker：12；
- `claude-opus-4.6-thinking`：首轮矩阵及两次独立重试均为`PROVIDER_FAILURE`；
- `deepseek-v4-pro-0813`：首轮7字符非marker，最终定向重试为29字符严格marker PASS；
- `deepseek-v4-pro-0813`：首轮为7字符非marker，最终定向重试已返回29字符严格marker PASS；
- 其余13模型最终均有严格marker PASS证据。

因此旧`14/14 non-empty / 13 marker`证据仍是历史快照，但不能覆盖当前时点的provider退化。

### 官方DSH

`@deepseek-ai/dsh-sdk-jsonrpc-demo@0.1.1-rc.2`与`dsh-jsonrpc-agent.cmd`是真实官方Windows carrier。现有产品artifact `v0.7.9-deepseek-product-path.json`记录真实initialize/session/prompt/notification/cleanup，但本轮结论仍是`UNAVAILABLE / providerCode=TRANSPORT / response empty`。

用户给出的火山/Command Code DeepSeek可用于Command Code真实流量，但不能绕过官方DSH协议边界；普通OpenAI-compatible API或CLIProxyAPI fallback仍被禁止。

## Findings

### P1 — 官方DSH真实assistant response仍未闭环

**Impact**：DSH不能标Feature PASS。  
**Acceptance**：在官方`dsh-jsonrpc-agent` Cordis composition上取得非空assistant streaming/terminal response及cleanup；不得使用API proxy/synthetic fallback。

### P1 — 所有生产模型当前并非全部成功

**Evidence**：Claude首轮矩阵及两次定向重试均为provider failure；DeepSeek Pro 0813偏差已在最终重试关闭。  
**Acceptance**：同一时点14/14均取得非空response，并按测试要求严格返回marker。

### P2 — Agentic能力不能跨CLI迁移结论

AGY多数CLI能力已实测，但无`/compact`；Command Code + DeepSeek能力已实测；官方DSH的tool/MCP/Skills/subagents/resume/multi-turn/context/compaction仍无产品集成证据，descriptor继续`implementation missing`是正确边界。

### P0 — 聊天中暴露的credential需轮换

未把该credential写入命令、源码、artifact或报告；安全扫描0命中。由于credential已经出现在聊天历史，应立即在服务端撤销并创建新key。

## Remaining

1. 恢复官方DSH真实assistant response；
2. 逐项在DSH产品路径验证高级Agentic能力后再升级descriptor；
3. 解决当前Claude provider failure后重跑全集；DeepSeek Pro 0813 marker偏差已由最终定向重试关闭；
4. AGY无`/compact`属于当前CLI能力边界，不伪造支持；
5. 保持Feature不合并Dev/main，不生成PASS report。

## Workflow Decision

- Requires Manager Re-plan：No
- Requires Ideate Revision：No
- Verdict：**FAIL / PARTIAL**
- D:\Work\CraftStation\craftstation\.worktrees\v0.7\ai_workspace\validation\v0.7.11-final-provider-retry-real-traffic.json
