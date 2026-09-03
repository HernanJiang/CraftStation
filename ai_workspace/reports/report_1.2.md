# v1.2.0 Unified MCP + Skills Capability Foundation — Feature Report

- Candidate：`de052d3`（Fix Cycle v1.2.0.1）/ 分支 `dev/v1.2.0-mcp-skills-capability` / 基线 `main@f5a4bb2`
- Verdict：**PASS (DEV)** — Debugger Re-review（`e8f3ece`，见 `ai_workspace/agent_docs/debugger_1.2.0.2.md`）
- 发布版本号：**1.7.0**（历史 1.2.0 已被 2026-06-05 发布占用；T11 记录按事实修正）
- 日期：2026-09-04

## 交付范围

- MCP 来源元数据与 Managed ownership：`managed | built-in | plugin | imported | external`；外部导入写入 `imported` + source provider 元数据，导入后 CraftStation 为 source of truth。
- External MCP discovery/import（user / WSL / workspace 源扫描，NUL 分隔符修复）。
- External Skills import（Managed 强制 copy，拒绝新建 link；legacy 链接生命周期保留）。
- Capability Resolver + Harness Profiles：Auto（enabled ∩ compatible ∩ available）/ Efficient（Harness Profile 推荐）/ Creative（显式 ID，无 ID 时映射 Efficient）；WSL / 项目位置可用性感知，非 secret 诊断。
- capabilityMode（auto/efficient/creative）端到端：composer 开关 → Workbench store → launch options → `plan.overrides` → Supervisor resolver。
- Codex dollar `$skill` 原生调用、跨 Harness MCP / Skills 注入、Settings 来源徽章。

## 真实运行证据

| 项                                                      | 结果                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 真实 Electron 应用启动 smoke（mock 模式，隔离 fixture） | PASS：主进程/Supervisor/renderer/db 初始化，`welcome-dismissal` + `baseline` 场景通过，console/runtime errors 0 |
| 上轮 ABI CDP 阻塞                                       | 已消除（`ensure-native-deps --force` 根因修复 + vitest Node-ABI binding）                                       |

## 自动化验证

- `pnpm typecheck` PASS；`pnpm lint` 0/0；`pnpm build` PASS。
- 聚焦套件全绿：capabilityResolver（7）、mcpServer 契约、McpExternalImportModal、SkillImportModal、changelog、threadLaunchActions（76）、SkillsService（50）、runtime（98）、codex/HarnessPanel/ChatPane/RemoteAccess/CrossagentMcp（305）。
- 全量 vitest：916 文件 / 10127 测试通过；残留 2 个 renderer 文件为 jsdom 负载 flaky（两次全量失败集合不同；单跑 85/85 通过），已分类非回归。

## 真实模式待验证（不阻塞 DEV PASS）

- 真实凭据下的跨 Harness MCP/Skills 注入流量验证归入 Model × Harness 真实流量矩阵阶段。
- merge `main` / 正式 tag / push：未授权，需用户明确批准。
