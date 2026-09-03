# Debugger Re-review — v1.2.0.2 (2026-09-04)

> Candidate：`de052d3`（Fix Cycle v1.2.0.1）
> Prior review：`ai_workspace/agent_docs/debugger_1.2.0.1.md`（**FAIL**，F1–F8 + Fix Plan）
> Worktree：`.worktrees/v1.2.0-mcp-skills-capability`，分支 `dev/v1.2.0-mcp-skills-capability`

## Review Method

- 逐项核对 Fix Acceptance Criteria（8 条）与 F1–F8 修复提交差异。
- 独立重跑聚焦套件、typecheck、lint、build、全量 vitest。
- 本机真实应用启动 smoke（上轮因 better-sqlite3 ABI 不匹配无法到达 CDP，本轮 ABI 根因已修复后重跑）。

## Findings closure（F1–F8）

| #   | 修复证据                                                                                                                                                                                      | 结论   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1  | `craftingMcpLaunchServers`：无 ID Auto/Efficient 总是传完整 enabled 候选快照；显式 ID 仍仅传选中项。回归：`passes the full candidate MCP snapshot on a no-ID Auto launch` + resume 路径同修复 | CLOSED |
| F2  | `supervisorRuntime.ts` dollar 恢复 `` `$${name}` ``；新增 runtime 级断言 `$agentic-probe`                                                                                                     | CLOSED |
| F3  | resolver 应用 `supportsMcpAtProjectLocation`；WSL 不可用运行时跳过全部 MCP 并输出含 distro 的非 secret 诊断；正反两个 focused 测试                                                            | CLOSED |
| F4  | `mcpServerOriginSchema` 增加 `imported`（对齐 Manager Plan 枚举）；导入 modal 写 `origin: "imported"`；Manager 徽章按 origin/label 显示；legacy 缺 origin 兼容测试                            | CLOSED |
| F5  | SkillImportModal 移除 link 选项；`prepareImport` 拒绝新建 link 导入；legacy 链接 enable/disable 生命周期保留（两个测试重写为先断言拒绝、再手工建链接验证生命周期）                            | CLOSED |
| F6  | 历史 `1.2.0`（2026-06-05）保留；新发布重编号 `1.7.0`，`package.json` 对齐；changelog 唯一性测试通过                                                                                           | CLOSED |
| F7  | `capabilityMode`：composer 开关 → workbench store → `startThreadFromCraft` options → `plan.overrides` → resolver；creative 无显式 ID 映射 efficient；launch payload 断言测试                  | CLOSED |
| F8  | NUL 分隔符改 `JSON.stringify([providerId, candidateId])`，文件恢复文本 diff                                                                                                                   | CLOSED |

## Acceptance Criteria 核对

- No-ID Auto/Efficient 启动传完整候选快照：PASS（新增 IPC 回归）。
- Resolver 排除 disabled / runtime-incompatible / secret-ineligible / WSL-unavailable 并有安全诊断：PASS。
- Codex 收到 `$skill-name`：PASS（runtime 回归）。
- Imported origin 可表示、一致展示与持久化，旧数据兼容：PASS。
- Managed Skill 导入为 copy，不暴露外部链接：PASS。
- 恰好一个 `1.2.0` changelog release：PASS（现为唯一的 2026-06-05 条目）。
- 所选 capability mode 在 launch payload 可观察并改变 Resolver 行为，不与 Workbench 语义混淆：PASS。
- Focused / typecheck / lint / build：PASS；全量残留已分类（见下）。

## Verification evidence

- `pnpm typecheck`：PASS（0 error）；`pnpm lint`：0 warning / 0 error；`pnpm build`：PASS。
- 聚焦套件：capabilityResolver 7、mcpServer 契约、McpExternalImportModal、SkillImportModal、changelog、threadLaunchActions（6 文件 76）、SkillsService 50、runtime 98、codex/HarnessPanel/ChatPane/RemoteAccess/CrossagentMcp 305 —— 全部通过。
- 全量 vitest：916 文件 / 10127 测试通过；2 个 renderer 文件（ChatPane scroll anchor、SubAgentOverlay parser）在全量并发下为 jsdom 负载 flaky，单跑 85/85 通过（两次全量运行失败集合不同，证实负载性而非回归）。
- **真实应用启动 smoke（mock）**：`run-craftstation-smoke.mjs --scope changed --mode mock` PASS —— 真实 Electron 主进程/Supervisor/renderer/db 全部初始化，`welcome-dismissal` + `baseline` 场景通过，console/runtime errors 0。上轮的 `NODE_MODULE_VERSION 137/148` CDP 阻塞经 `ensure-native-deps --force` 根因修复后消除。
- 环境修复证据：`scripts/ensure-native-deps.mjs` electron-rebuild 加 `--force`（stale store prebuild 静默空转根因）；vitest 经 `CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING` 使用 `dist/server-native` Node-ABI binding。

## Notes for Manager

- 发布版本号定为 **1.7.0**（产品 changelog 序列已至 1.6.5，内部 Feature 版本 v1.2.0 与历史发布撞号）；T11 原「package.json=1.2.0」记录按事实修正。
- Managed Skill link 导入被拒属产品语义变更（Manager Plan 本就要求 CraftStation-owned copy），已按 Plan 执行，无需额外 re-plan。

## Verdict

**PASS（DEV）— v1.2.0 候选 `de052d3` 达到候选收口标准。**

- 授权生成用户候选验收包与 `ai_workspace/reports/report_1.2.md`（须如实记录 mock 模式 smoke 与真实模式待验证项）。
- Merge `main` / 正式 tag / push 仍需用户明确授权。
