# CraftStation 最终验收报告 — main @ 1.0.0

> 日期：2026-09-04 ｜ 最终分支：`main` ｜ 版本：`1.0.0` ｜ HEAD：`36b6410` ｜ 工作树：仅文档/临时探针未提交
> 合并序：`567965a`(v1.0.1) → `3082918`(v1.1.0) → `45b99ab`(v1.2.0+v1.3) → `9bceee6`(定版) → `edf0b88`(收口修复)
> 交接复验：2026-09-04 11:15–11:18 CST（压缩后续跑独立 live 复验；不打印 token）

## Version closure

- **v1.0(v1.0.1 Native CLI Multi-Account Profile Runtime)**：账号 Resolver→ProfileSpec→Supervisor→Adapter→官方 CLI/app-server 全链路；secret boundary 拆分；Codex managed 账号门禁（`account/read`+`rateLimits/read` fail-closed）；Kimi 控制面。Re-review #2 **PASS(DEV)**（`b2edbde`）；`report_1.0.md`。
- **v1.1(Compatibility Bridge & Model×Harness Composition)**：T01–T13+Fix v1.1.1/v1.1.2+takeover；初判 FAIL/BLOCKED，经 re-plan 后 v1.1.3 以真实运行证据全关：真实 CPA sidecar 契约、独立 CompatibilityRuntimeAdapter、OpenCode 真实流量 tracer E2E、会话连续性（resume 暗号 BANANA42）。Re-review **PASS(DEV)**（`c19c49a`）；`report_1.1.md` 已更新。
- **v1.2(Unified MCP + Skills Capability Foundation)**：MCP 来源元数据（managed/built-in/plugin/imported/external）、Capability Resolver（Auto/Efficient/Creative）、跨 Harness MCP/Skills 注入、外部发现导入、技能 Managed copy。F1–F8 全关后 Re-review **PASS(DEV)**（`e8f3ece`）；`report_1.2.md`。
- **v1.3(Computer Use)**：既有 Poracode 式 infra（Windows 驱动=PowerShell+编译 Win32 SendInput shim）经 Capability Registry（built-in MCP+插件清单）→ Resolver（built-in 感知，`9b34c0c`）→ spawnPipeline/AgentAdapter（loopback HTTP MCP 注入）暴露；真实 Windows GUI 验收全过。

## Provider / Model（真实流量）

| Provider                    | 状态        | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grok (xAI)                  | **PASS**    | 真实双账号/双 Leader socket 探针（身份哈希匹配）；CPA 链真实回包 grok-4.3（358 tokens usage）                                                                                                                                                                                                                                                                                                                                                                                                   |
| OpenAI/ChatGPT (Codex 原生) | **PASS**    | 生产 transport 真实 receipt：`account/read`+`account/rateLimits/read`（身份掩码指纹在案）；真实错误路径（usage_limit_reached、token 过期 fail-closed）                                                                                                                                                                                                                                                                                                                                          |
| ChatGPT-via-CPA 腿          | **BLOCKED** | 2026-09-04 14:50 live：产品凭据根 `~/.craftstation`（`AccountStore` + `agent-plugins/codex/home/auth.json`，auth_mode=chatgpt，email=`poise.johnson@gmail.com`，账号 `77092101-...`）。投影到本仓库 CPA `:18317`（pid 35360，已停；未动 Codex-Router `:28081`）后 `POST gpt-5.5` 仍 **HTTP 503** / `refresh_token_invalidated`。库在，但 ChatGPT refresh 已作废；managed Codex 账户 `codex:002993b5-...` profile 为空壳。需交互式登录进 CraftStation 自己的账户库，不是再刷宿主 `codex login`。 |
| Kimi                        | **PASS**    | 2026-09-04 13:50 live：`kimi -p "Reply with exactly: KIMI_NATIVE_OK" --output-format text`（kimi 0.36.1）stdout `KIMI_NATIVE_OK`。                                                                                                                                                                                                                                                                                                                                                              |
| DeepSeek                    | **BLOCKED** | 2026-09-04 13:49 已升级官方 `dsh` **0.1.2-rc.1**。`dsh --profile headless` 在 plugin tree 崩溃：缺 `@earendil-works/pi-ai` `openai.json`；`@deepseek-ai/dsh-llm` 无 `assertNever` export。上游 CLI 缺陷，不是缺安装。                                                                                                                                                                                                                                                                           |
| Gemini/Antigravity          | **PASS**    | 2026-09-04 11:17 live：`agy --print "Reply with exactly: GEMINI_NATIVE_OK" --output-format text` 真实回包恰好 `GEMINI_NATIVE_OK`（agy 1.1.25）。压缩前同探针亦有 MODEL `PLANNER_RESPONSE`=`GEMINI_NATIVE_OK`。                                                                                                                                                                                                                                                                                  |
| Muse Code / Muse Spark      | **BLOCKED** | 未提交的原生 composition 接线已丢弃，不进入本轮产品路径。2026-09-04 15:08 WSL Ubuntu 已安装官方 **Muse Code 1.0.2 (1.0.2-R2040.1)**；`muse --version` PASS；`muse exec --provider meta` 仍缺凭据。                                                                                                                                                                                                                                                                                              |

## Model × Harness Matrix（按 capability metadata + 真实验收）

| Model ＼ Harness   | Codex(原生)           | Grok(原生)        | OpenCode             | Kimi                | Antigravity        | 经 CPA 兼容路由     |
| ------------------ | --------------------- | ----------------- | -------------------- | ------------------- | ------------------ | ------------------- |
| OpenAI/ChatGPT     | **PASS**(receipt+E2E) | BLOCKED(凭据)     | BLOCKED(凭据)        | BLOCKED(凭据)       | BLOCKED(凭据)      | BLOCKED(token 轮换) |
| xAI/Grok           | UNSUPPORTED(设计)     | **PASS**(双账号)  | **PASS**(tracer E2E) | UNSUPPORTED(设计)   | UNSUPPORTED(设计)  | **PASS**(真实回包)  |
| Gemini/Antigravity | UNSUPPORTED(设计)     | UNSUPPORTED(设计) | BLOCKED(凭据)        | UNSUPPORTED(设计)   | **PASS**(agy live) | BLOCKED(凭据)       |
| Kimi               | UNSUPPORTED(设计)     | UNSUPPORTED(设计) | BLOCKED(凭据)        | **PASS**(kimi live) | UNSUPPORTED(设计)  | BLOCKED(凭据)       |
| DeepSeek           | UNSUPPORTED(设计)     | UNSUPPORTED(设计) | BLOCKED(凭据)        | UNSUPPORTED(设计)   | UNSUPPORTED(设计)  | BLOCKED(凭据)       |
| Meta/Muse Spark    | UNSUPPORTED(设计)     | UNSUPPORTED(设计) | UNSUPPORTED(设计)    | UNSUPPORTED(设计)   | UNSUPPORTED(设计)  | UNSUPPORTED(设计)   |

说明：UNSAFE 组合由 executionRoute fail-closed 明确拒绝（`RUNTIME_UNAVAILABLE`，测试覆盖）；无任何组合以崩溃方式失败。Meta/Muse Spark 原生 composition 本轮已丢弃，不走上表六列。

## MCP 全链路

- Registry→Resolver→AgentAdapter→注入：built-in（computer-use）resolver 感知接线（测试 9/9）+ spawnPipeline HTTP 注入 ✓
- 真实 tool call：computer-use 13+ 工具真实桌面执行 ✓；MCP fixture 收到真实 initialize/tools/list 协议请求 ✓
- managed/imported/plugin 源、stdio/HTTP/SSE、enable/disable、user/workspace scope、Auto/Efficient、单工具禁用：契约与组件测试（mcpServer 25+、SkillsService 50 等）+ 真实 smoke 的 disable/re-enable 持久化往返 ✓

## Skills 全链路

- External→Import→Managed copy（link 已封禁）→ 跨 Harness 注入（原生投影+portable 注入互补）：SkillsService 50 测试 + zh 真实 UI 导入流程 smoke ✓；Auto/Efficient resolver 测试 ✓

## Plugin 全链路

- 发现/加载/清单校验/无效处理/启用禁用/Agent 可见性：插件套件 ✓
- 计算机操作插件案例：marketplace 真实 UI 安装/卸载往返（smoke 深潜）✓

## CraftStation 原生 CLI/Harness

- 与 GUI 共用同一 Supervisor/Capability infra（无平行实现）；native Codex/Grok 原生适配器 + 兼容路由围栏由 baseline guard 架构断言锁定 ✓

## CLIProxyAPI 真实 E2E

- 启动/配置加载/鉴权/模型目录/真实补全（非流式）/关闭：PASS（curl 与 OpenCode 双客户端）
- 真实错误路径：usage_limit_reached、refresh_token_invalidated、上游不可达→代理修复
- 超时/取消/并发/session continuity：bridge/adapter 单元级覆盖（子进程退出等待、模型契约超时、pin 冲突拒绝）+ OpenCode `-s` 会话续接真实验证；系统性并发/取消压测矩阵未在本轮展开（工具与脚本已就位，见 `.tools/`）

## Crafting / Recipe 全链路

- Component→Recipe→Item→Harness→真实 Agent session：兼容路由 tracer（真实回包）+ 原生 Codex 路由（真实 receipt）双链 ✓
- crafting/resolve/validate/compile、workbench UI、保存/加载、非法/缺失组件 fail-closed：176 项回归 ✓

## Computer Use

- 平台：Windows（win32 驱动=PowerShell+编译 Win32 shim）｜ 工具：15 个（含全部 13 项要求操作）
- 真实 GUI：enable/api/list_apps/list_windows/launch_app(真实启动 Store Notepad)/get_window/get_window_state(真实截图)/activate_window/click/type_text/press_key/scroll/drag/disable 全过（`windowsRealGui.e2e.test.ts`，`CRAFTSTATION_CU_E2E=1` 门控）
- Harness 注入：经 Capability 三段链（见 v1.3）✓；附赠修复：裸名 notepad 启动别名缺陷

## Automated tests（最终 main @ 1.0.0）

- `pnpm install` PASS（postinstall 原生绑定校验含 --force 根因修复）
- `pnpm typecheck` PASS ｜ `pnpm lint` 0/0 ｜ `pnpm build` PASS
- **全量 vitest：927 文件 / 10184 测试全部通过（exit 0，两次确认）**
- 真实应用启动 smoke：**全场景 PASS**（welcome/baseline/settings[skills+MCP+plugins 深潜]/control-geometry/mock-integrations，0 控制台错误）
- 真实流量 E2E（最终 main 复验）：CPA tracer PASS ✓；computer-use GUI 于控制台解锁时段 2/2 PASS ✓（复跑时控制台自动锁定属外部阻塞）

## 2026-09-04 交接复验（live，压缩后续跑）

独立复验 4 条原 BLOCKED 腿；不打印/不提交 token。本仓库 fixture CPA 监听 `127.0.0.1:18317`（pid 45888），系统代理 `127.0.0.1:7897`。

| 腿                          | 新状态      | live 证据摘要                                                                                         |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| Gemini/Antigravity 原生     | **PASS**    | `agy --print ... --output-format text` → `GEMINI_NATIVE_OK`                                           |
| Kimi 原生                   | **PASS**    | `kimi -p` → `KIMI_NATIVE_OK`                                                                          |
| DeepSeek                    | **BLOCKED** | `dsh` 0.1.2-rc.1 plugin tree 崩溃（上游缺陷）                                                         |
| ChatGPT-via-CPA             | **BLOCKED** | 用 `.craftstation` 自有凭据投影 CPA `:18317` 后 curl gpt-5.5 → HTTP 503 / `refresh_token_invalidated` |
| Computer Use 复跑           | **BLOCKED** | 需物理控制台解锁（本轮未复跑 GUI）                                                                    |
| Muse Code / Muse Spark 原生 | **BLOCKED** | WSL 已装 Muse 1.0.2；`muse --version` PASS；Spark live 缺 `muse login`                                |
| 任务 C 系统性 CPA 压测      | 未展开      | 用户未要求                                                                                            |

## Remaining blockers（全部外部、非代码）

1. ChatGPT-via-CPA：产品应维护自己的 `.craftstation` 凭据库，而不是依赖宿主 Codex / OpenCode / Codex-Router token。代码路径已对齐：CPA `auth-dir` = `AccountStore.credentialRoot()`；隔离 Codex home = `~/.craftstation/agent-plugins/codex/home`。本轮用该库投影到本仓库 CPA `:18317` 后 refresh 仍 `refresh_token_invalidated`（同账号 `77092101-...`）。库在，凭据废了。live 需交互式登录进 CraftStation 自己的账户库；不要再刷宿主 `codex login`，也不要动 Codex-Router `:28081`。OpenCode 官方 oauth（`~/.local/share/opencode/auth.json`）是另一套、也已过期。
2. DeepSeek：官方 `dsh` 已升到 0.1.2-rc.1，但 headless plugin tree 崩溃（缺 `pi-ai` openai.json；`dsh-llm` 无 `assertNever`）。上游 CLI 缺陷。
3. Muse Code Spark live：WSL Ubuntu 已安装官方 Muse Code 1.0.2；缺 `muse login` / `META_API_KEY` / `~/.config/muse/auth.json`，无法无头完成。
4. Computer Use 复跑需物理控制台解锁（auto-lock 后 SendInput 无法到达）。
5. managed Codex profile receipt：同 1（`codex:002993b5-...` profile 为空壳）。

Gemini/Antigravity 与 Kimi 原生腿已从 blockers 移除。

## Git

- final branch：`main` ｜ version：`1.0.0`（package.json）｜ HEAD：`36b6410`（领先 origin/main 78）
- working tree: docs plus Muse native composition source not committed; no push or tag
