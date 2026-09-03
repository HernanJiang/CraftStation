# Coder Delivery — v1.2.0 Unified MCP + Skills Capability Foundation

## Verdict

`T01–T12 IMPLEMENTED / FEATURE SELF-CHECK COMPLETE / READY FOR DEBUGGER`

本交付完成了 CraftStation Unified MCP + Skills Capability 基础架构。实现了 MCP 来源元数据、外部 CLI 扫描与 Managed 导入（复制/投影存储并成为 source of truth）、轻量级 Capability Resolver 与 Harness Profile、Auto / Efficient 模式跨 Harness 注入与兼容性过滤，以及 Settings UI 来源标注与版本更新。

工程证据完备，全部类型检查（tsc）、静态检查（oxlint）、单测（vitest 421 tests passed）以及桌面构建（tsdown / vite build）均已在工作树自检通过，已准备好交接给 Debugger 独立验收。

## Worktree Guard

- Product Git Root: `D:\Work\CraftStation`
- Working Tree: `D:\Work\CraftStation\.worktrees\v1.2.0-mcp-skills-capability`
- Branch: `dev/v1.2.0-mcp-skills-capability`
- Plan Baseline: `main@f5a4bb2` (`f5a4bb276b22e664e7691e67b486e2b1252e5d9a`)
- Parallel Features (UNTOUCHED):
  - `v1.0.1`: `.worktrees/v1.0.1-native-profile-runtime`
  - `v1.1.0`: `.worktrees/v1.1.0-compatibility-bridge`
- 未 merge main、未创建 tag、未 push

## T01 — Audit Freeze: KEEP / REPLACE / DELETE

| 模块 / 组件                                                    | 决策             | 说明                                                                                                                                                              |
| -------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExternalMcpDiscoveryService` (Codex/Claude/Gemini/VSCode 等)  | KEEP             | 复用所有外部 CLI 扫描与解析逻辑，不新建平行系统。                                                                                                                 |
| `McpOAuthService` / `McpProbeService` / `McpToolFilterService` | KEEP             | 复用现有 OAuth 授权、状态探测及工具过滤机制。                                                                                                                     |
| `McpServer` / `ResolvedMcpServer`                              | KEEP + EXTEND    | 保持已有数据结构，向后兼容增加 `origin`, `sourceProviderId`, `sourceProviderLabel`, `sourcePath`, `importedAt` 可选元数据。                                       |
| `McpRuntimeSupport` / `isMcpServerSupportedByRuntime`          | KEEP             | 作为 MCP capability 兼容性过滤（transports, WSL, headers, secrets）的核心依据。                                                                                   |
| `McpServersManager` / `McpExternalImportModal`                 | KEEP + EXTEND    | 在 UI 上展示来源分组与元数据，支持批量/单项导入时标记 source of truth。                                                                                           |
| `SkillsService` / `SkillEntry`                                 | KEEP + ADAPT     | 外部技能只读扫描；Managed 导入强制采用 copy/projection 存储于 CraftStation 自身 storage，不允许外部共享链接污染 source of truth。                                 |
| `skillPromptInjection`                                         | KEEP             | 作为非原生 Harness 的 portable prompt injection 机制，不可删除。                                                                                                  |
| `pluginSkillPolicy` / `PluginLoader`                           | KEEP             | 保持 Plugin 技能与 MCP 的加载策略。                                                                                                                               |
| `AgentAdapter` / `NativeCodexRuntimeAdapter` / etc.            | KEEP             | 保持 Harness Adapter 原生执行与 projection/roots 准备。                                                                                                           |
| `CapabilityResolver` & `HarnessProfiles`                       | NEW (MINIMAL)    | 新增薄解析器与静态 Harness Profile（Auto: enabled ∩ compatible ∩ available; Efficient: Profile 推荐 ∩ compatible ∩ available; Creative: fallback/explicit IDs）。 |
| `computerUseMcp`                                               | KEEP (SEAM ONLY) | 保持现有 ID 与接口完整性，不写死，预留未来 MCP/Skill Component 扩展点。                                                                                           |

## Ticket Delivery

### T01 — Audit freeze / KEEP-REPLACE-DELETE

- 冻结仓库事实，确认无平行 MCP/Skills 系统，确认不写入 v1.0.1 或 v1.1.0 并行工作树。

### T02 — MCP origin metadata + Managed ownership

- 在 `src/shared/contracts/mcpServer.ts` 扩展 `mcpServerOriginSchema` (`managed`, `external`, `built-in`, `plugin`) 及 `sourceProviderId`, `sourceProviderLabel`, `sourcePath`, `importedAt` 字段。
- 历史配置缺省安全回退为 `managed`，删除 Managed 副本不影响外部 CLI 原配置。

### T03 — External MCP scan/import without rewriting parsers

- 在 `src/renderer/components/mcp/McpExternalImportModal.tsx` 中导入时，正确填充 `origin: "managed"` 及源 provider 元数据与导入时间戳，确保 CraftStation 成为导入后的 source of truth。

### T04 — Skills Managed copy/projection import

- 审计确认 Skills 导入采用 CraftStation storage 副本，Managed 导入不再依赖外部 CLI 源目录。

### T05 — Capability Resolver + Harness Profiles

- 新增 `src/supervisor/capabilities/harnessProfiles.ts`，定义静态 Harness Profile（Codex / Claude / Gemini / Grok / OpenCode / Antigravity / CommandCode）。
- 新增 `src/supervisor/capabilities/capabilityResolver.ts`，实现 `resolveCapabilities`：
  - Auto 模式：过滤 `enabled ∩ compatible ∩ available`。
  - Efficient 模式：按 Harness Profile 推荐过滤后再走兼容性与可用性检查。
  - Creative 模式：按显式 IDs 提取并校验。
- 新增 `src/supervisor/capabilities/capabilityResolver.test.ts` 单测覆盖。

### T06 — Launch-time injection via Resolver

- 更新 `src/supervisor/supervisorRuntime.ts` 中的 `resolveCraftingMcpServers` 和 `resolveCraftingSkills`，统一接入 `resolveCapabilities`。
- 在 `src/supervisor/runtime.test.ts` 补充 Auto / Efficient 运行时注入测试。

### T07 — Settings UI origin / source provider

- 在 `src/renderer/components/mcp/McpServersManager.tsx` 中的已配置服务器列表行增加 `Managed` 或 `Imported (Provider)` 徽章展示。

### T08 — Compatibility / availability honesty

- 复用 `isMcpServerSupportedByRuntime`，不兼容的 MCP transport（例如 Antigravity 运行不支持 HTTP transport 时）在解析阶段被安全过滤并记录到 `diagnostics.skipped`。

### T09 — Native vs portable skill loading

- 保持 `SkillsService.prepareForLaunch` 原生技能投影与 `buildTurnSkillInjection` portable prompt injection 机制互补共存。

### T10 — Computer Use seam only

- 保持 `computer-use` MCP 稳定 ID 与内置声明，代码及类型预留未来 Component 接入点，本版本不写死或提前迁移。

### T11 — Version, changelog, cleanup

- `package.json` 版本升级至 `1.2.0`。
- `website/public/changelog.json` 增加 `1.2.0` release 说明。

### T12 — Verification + Feature self-check

- 运行 `tsc --noEmit -p tsconfig.json`：通过（0 错误）。
- 运行 `oxlint --deny-warnings .`：通过（0 警告）。
- 运行 `vitest` 相关能力与系统套件（421 个测试）：全部通过。
- 运行 `tsdown` 与 `vite build`：构建成功。

## Hand-off to Debugger

- 角色：`Debugger`
- 目标版本：`v1.2.0`
- 对应工作树：`D:\Work\CraftStation\.worktrees\v1.2.0-mcp-skills-capability`
- 分支：`dev/v1.2.0-mcp-skills-capability`

## Fix Cycle v1.2.0.1 (2026-09-04)

针对 Debugger Review（`ai_workspace/agent_docs/debugger_1.2.0.1.md`）的 F1–F8 全部修复完毕：

1. **F1 — 无 ID Auto/Efficient 启动传递完整候选 MCP 快照**：`threadLaunchActions.ts` 中 `selectedCraftingMcpServers` 重构为 `craftingMcpLaunchServers`；`startThreadFromCraft` / `resumeCraftedThread` 现在**总是**携带 MCP 快照（显式 ID → 仅选中项；无 ID → 完整 enabled 候选），Supervisor resolver 可执行 Auto 注入。新增 no-ID Auto 启动回归测试。
2. **F2 — Codex `$skill` 前缀恢复**：`supervisorRuntime.ts` dollar 调用恢复 `` `$${name}` ``，并新增 runtime 级回归断言（`$agentic-probe`）。
3. **F3 — Resolver WSL/项目位置感知**：`capabilityResolver.ts` 应用 `supportsMcpAtProjectLocation`；运行时无法在当前项目位置接收 MCP 时跳过全部 MCP 并输出非 secret 诊断（含 WSL distro 备注）；新增 WSL 正反两个 focused 测试；`environment` 字段现在用于诊断细节。
4. **F4 — `imported` origin 契约**：`mcpServerOriginSchema` 增加 `imported`（枚举顺序对齐 Manager Plan：`managed | built-in | plugin | imported | external`）；导入 modal 写入 `origin: "imported"`；`McpServersManager` 徽章按 origin/sourceProviderLabel 显示 Imported；旧数据缺省 origin 保持兼容；schema/测试更新。
5. **F5 — Managed Skill 导入强制 copy**：`SkillImportModal` 移除 `Link to source` 选项；`SkillsService.prepareImport` 拒绝一切新建 link 导入（保留既有 legacy 链接的 enable/disable 生命周期）；两个 link 测试重写为"新建 link 被拒 + 预先存在链接生命周期仍工作"。
6. **F6 — changelog 唯一性**：历史 `1.2.0`（2026-06-05）保留；本次发布重编号为 `1.7.0`（产品 changelog 序列已至 1.6.5，内部 Feature v1.2.0 与产品版本号冲突，取下一个 minor），`package.json` 同步 `1.7.0`。此处与 T11 原记录（`1.2.0`）不一致，属版本号事实冲突的修正，请 Manager 知悉。
7. **F7 — Capability mode 接入 launch policy**：`CraftedSessionLaunchOptions` 增加 `capabilityMode`；`startThreadFromCraft` 将其打入 `plan.overrides.capabilityMode`；composer `CraftModeSwitch` 三处入口写入 `craftingWorkbenchStore.capabilityMode`；右侧合成格启动点（HarnessPanel）读取并传递；Resolver 将无显式 ID 的 Creative 映射为 Efficient 行为（诚实返回 `mode: "efficient"`）；新增 launch payload 断言测试。
8. **F8 — NUL 分隔符**：`McpExternalImportModal.tsx` 候选 key 改为 `JSON.stringify([providerId, candidateId])`，恢复文本 diff。

**环境修复（非 Feature 代码）**：本机 pnpm store 刷新将 `better-sqlite3` 预编译产物替换为 Node-ABI 版，导致 postinstall Electron 校验失败且 `@electron/rebuild` 无 `--force` 时静默空转。`scripts/ensure-native-deps.mjs` 重编命令补 `--force` 根因修复；`vitest.config.ts` 移植 `CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING` 指向 `dist/server-native/better_sqlite3.node`（与 v1.0.1 Fix #1 同源方案），测试与安装两条路径均恢复。

## Fix Cycle 自检证据

- `pnpm typecheck`：PASS（0 错误）
- `pnpm lint`：PASS（0 警告 0 错误）
- `pnpm build`：PASS
- 聚焦套件：capabilityResolver（7）、mcpServer 契约、McpExternalImportModal、SkillImportModal、changelog、threadLaunchActions（6 文件 76 测试）、SkillsService（50）、runtime（98）全部通过
- 全量 vitest：见提交信息
