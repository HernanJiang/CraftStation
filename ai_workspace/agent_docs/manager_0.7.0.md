# CraftStation Manager Plan — v0.7.0

## Feature

**v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters**

状态：`PLAN READY / CODER EXECUTING`

本 Feature 在独立 worktree 开发，不占用 v0.6 共享开发树：

```text
Product Git Root: D:\Work\CraftStation\craftstation
Base branch:      dev (7ae6506)
Feature branch:   feature/v0.7-native-harnesses
Feature worktree: D:\Work\CraftStation\craftstation\.worktrees\v0.7
Shared v0.6 tree: D:\Work\CraftStation\craftstation-dev (保持原样)
```

本计划不把 v0.6 未提交修改复制、覆盖或重置到 v0.7。v0.7 的最终集成必须在 v0.6 现场可安全收口后由 Manager 处理；Coder 不得直接写 `main` 或共享 `craftstation-dev`。

## Part I — Ideate Brief

### 用户目标

CraftStation 需要在同一个 UI 和 Minecraft composition 链路中接入两个新的官方 Harness：

1. Antigravity：使用官方 `agy` CLI 的 OAuth/Keyring/订阅身份，通过官方 machine mode `--input-format stream-json` / `--output-format stream-json` 驱动，不模拟 TUI，也不伪造 JSON-RPC/ACP。
2. DeepSeek / DSH：使用官方 DeepSeek Harness 的原生 SDK、JSON-RPC 或官方 machine-facing runtime（以仓库与实际安装版本核验结果为准），不把它改造成 API proxy，也不重写其内部 agent loop。

两个 Harness 都必须进入 CraftStation 的 `Model Item + Harness Item -> Recipe -> Crafter -> CraftPlan -> Runtime -> Entity -> Session` 路径，并保留各自官方的上下文、压缩、MCP、Skills、权限、工具、子 Agent、会话和流式语义。

### 不做的事

- 不把 Antigravity CLI 的 `stream-json` 宣称为 JSON-RPC 或 ACP。
- 不通过 TUI 屏幕抓取、键盘注入或第三方订阅代理接入。
- 不修改官方 Harness 的 agent loop、上下文压缩或工具执行实现。
- 不把 API Key/Vertex SDK 路径冒充 Antigravity consumer subscription；订阅必须来自官方 `agy` 登录运行时。
- 不使用 CLIProxyAPI 作为 Harness 或订阅转 API 网关。
- 不将 Account、Quota、Token Usage 变成 CraftStation 一级 Item/Recipe。
- 不在本 Feature 做 v0.6 provider-auth/Ark 改动、dev→main promotion 或正式 tag。

## Part II — Manager Plan

### Plan Gate Check

| 检查项                   | 结论           | 依据                                                                                                                                                                                |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feasibility              | OK（分阶段）   | 现有 `harness-runtime`、canonical runtime event、Structured/Pty Adapter、Codex/Grok/Kimi descriptor 可复用；官方 Antigravity CLI 有 NDJSON machine mode，DeepSeek 需 T01 现场核验。 |
| Practicality             | OK             | 两个 Harness 各自一条 tracer-bullet，再做统一生命周期/回归；真实凭据缺失时保留 `unavailable` 诊断，不伪造 PASS。                                                                    |
| Alignment                | OK             | 遵循 Official/Native Harness Runtime First 与 Strangler Refactor；UI/Crafting 只依赖小接口。                                                                                        |
| Information completeness | Ready for Plan | DeepSeek 可用命令、协议、事件 schema 和认证方式由 T01 固化；未决事实不得由 Coder 猜测。                                                                                             |

### 当前代码事实与目标差距

| 区域             | 当前基线事实                                                                                                                                                  | v0.7 目标                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Harness seam     | `StructuredNativeHarnessRuntimeAdapter`、`PtyNativeHarnessRuntimeAdapter` 与 descriptors 已存在；Antigravity 仍标记 `official-pty`，DeepSeek 是 unavailable。 | 新增独立 transport/adapter，不让上层感知具体 CLI/SDK。                                                              |
| Antigravity      | 现有 agent 目录和 usage scanner 存在，但 native runtime 走 PTY，不能取得稳定 machine event。                                                                  | 官方 `agy` stream-json 双向进程适配，保留 OAuth/订阅和官方生命周期。                                                |
| DeepSeek         | descriptor 和 unavailable adapter 已存在，未形成真实官方 runtime。                                                                                            | 根据 T01 核验结果接入官方 DSH SDK/JSON-RPC/stdio；若环境不可用，仍提供准确 readiness/diagnostic。                   |
| Event projection | canonical `RuntimeEvent` 与 native envelope 已有。                                                                                                            | 完整映射 text delta、thought、tool call/result、permission、question、usage、turn/session/lifecycle、stderr/error。 |
| Crafting         | Native harness registry/recipe 已有 Codex 等路径。                                                                                                            | 增加 Antigravity 与 DeepSeek Native Recipe，保持 Model/Harness 独立、组合可审计。                                   |

### Deep-module seams

1. **Antigravity CLI Machine Transport**：只暴露 `startSession / sendTurn / interrupt / resume / dispose` 与 NDJSON event stream；隐藏命令发现、参数、stdin framing、stdout 行解析、stderr、退出码和 OAuth 环境投影。
2. **DeepSeek Native Transport**：只暴露同一最小生命周期语义；内部可选择官方 SDK、JSON-RPC 或 stdio，不强制复用 Antigravity/Codex 实现。
3. **Native Event Canonicalizer**：把 provider event 映射为 CraftStation `RuntimeEvent`，保留安全的 `nativeEnvelope`，不得泄漏 token、cookie、完整 prompt 或原始凭据。
4. **Native Harness Registry/Recipe**：注册 descriptor、capability 状态和 vendor-native recipe；UI、Crafter 不得 deep-import transport implementation。

### 功能规格

#### Antigravity

- 默认发现官方 `agy` 可执行文件；允许受控配置覆盖，但禁止 shell 字符串拼接和无界命令执行。
- 以官方 `--input-format stream-json` 和 `--output-format stream-json` 启动 machine mode；一行一条 NDJSON，解析失败必须记录稳定诊断并保留原始安全摘要。
- 支持初始化、持续多轮、resume（若 CLI 对外提供 conversation ref）、取消/中断、正常结束、非零退出和认证失效。
- 将官方 `init`、`step_update`、tool/permission/question、assistant text delta、usage、result 等事件映射到 canonical events；未知事件 forward-compatible 地进入诊断而不崩溃。
- 运行环境继承官方 CLI 的系统浏览器 OAuth、Keyring 和订阅身份；Adapter 不读取或记录 access token、refresh token、cookie 或 auth 文件。
- 保留 CLI 自己的 context、compaction、MCP、Skills、subagents、permissions 与 tool loop；CraftStation 只做 UI/control-plane 投影。
- descriptor transport 改为 machine-readable `official-stream-json`（若 schema 尚未存在则先扩展受控枚举），不能写成 ACP/JSON-RPC。

#### DeepSeek / DSH

- T01 必须从官方仓库/安装包/文档确认 executable、认证、machine boundary、协议版本、事件 schema、会话恢复和能力矩阵。
- 只使用官方可编程边界；优先官方 TypeScript SDK/JSON-RPC/runtime，禁止把普通 OpenAI-compatible API 当作 DeepSeek Harness。
- 映射与 Antigravity 相同的 CraftStation 最小语义，但允许 DSH 特有事件保存在 native envelope 中。
- 对无法安装、未认证、协议不匹配或服务不可达返回 `unavailable`/`AUTH_REQUIRED`/`PROTOCOL_MISMATCH` 等稳定诊断；没有真实 response 时不标记 capability 为 integrated。

#### 共同生命周期与安全

- `CraftPlan` 必须原样传递 model、harness、workspace、profile/account binding、permission、MCP/Skills、context/compaction 和 runtime overrides；不得只传 model。
- Session 在整个生命周期绑定同一 native provider session/account；调度只发生在新 Session 创建时。
- 取消、超时和进程退出必须可诊断、可清理；不得设置固定 60 秒上限替代 Harness 自己的长任务生命周期。
- Renderer 只接收脱敏 descriptor、状态、事件和错误；任何 secret 禁止跨 IPC 或写入日志。

### Execution Order

单个 Coder 按以下顺序连续执行：

`T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08 -> T09`

- T02 与 T03 分别完成 Antigravity/DeepSeek tracer bullet；理论上可并行，但在同一 Coder 流程中按顺序执行以减少 seam 冲突。
- T04 完成共同 canonical event/lifecycle contract 后，T05/T06 才能扩大能力面。
- T07 接入 Crafting registry/Recipe，T08 做 UI/IPC/control-plane 集成，T09 是独立验收前的回归与证据整理。

### Acceptance Gates

**Antigravity Gate**

- 在已登录 `agy` 的真实环境启动官方 machine mode，并捕获非 synthetic 的 init、至少一轮 assistant streaming、终态 result 和退出/取消证据。
- CraftStation UI 能实时显示 canonical 事件；官方 CLI 仍负责上下文、压缩、MCP、Skills、权限和子 Agent。
- 订阅认证来自 CLI 原生登录；日志、IPC、快照不含 credential。
- 未安装/未登录时显示明确 readiness/diagnostic，不伪造成功。

**DeepSeek Gate**

- 记录官方 runtime 版本、命令/SDK、协议和认证来源证据。
- 在可用环境取得真实初始化、流式响应、工具/权限（若官方支持）、多轮和清理证据；不可用时独立报告阻塞原因。
- descriptor capability 以真实证据为准，不把 fixture/unit test 当 Native PASS。

**Composition Gate**

- 两个 Model Item 与 Harness Item 均能通过 Native Recipe 形成 CraftPlan，并生成 Entity/Session。
- `CraftPlan` 的 runtime 配置、workspace、MCP/Skills、权限和 profile binding 到达 Adapter。
- 事件顺序、correlation id、诊断和资源清理可复现；无旧 PoraCode-specific adapter deep import。

**Global Gate**

- 现有 Codex/Grok/Kimi 路径回归通过；不改变 v0.6 工作树。
- Debugger 在本 Feature worktree 独立验收，PASS 后只做 feature branch candidate closeout；用户验收和后续合并另行授权。

### Risks

- Antigravity `stream-json` schema 可能随 CLI 发布变化：保留 unknown event 诊断、版本探测和 fixture contract。
- DeepSeek 官方边界可能尚未能在 Windows 取得：T01 先冻结事实，必要时以 unavailable 交付，不用代理替代。
- v0.6 正在共享 dev 上开发：v0.7 不得读取/提交其未提交文件；集成时由 Manager 处理冲突和基线同步。
- 订阅/Token 数据敏感：只传 profile/account reference，不传秘密。

### Handoff

Coder 在 `D:\Work\CraftStation\craftstation\.worktrees\v0.7`、分支 `feature/v0.7-native-harnesses` 开工，读取本文件和本目录 `PROJECT_STATUS.md`，按 T01–T09 连续完成。完成后提交 Coder report，并交接 Debugger；不得 merge `dev`/`main`、不得创建正式 tag。
