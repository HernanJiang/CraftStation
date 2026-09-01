# Debugger 复检 — v0.8.0 OpenCode Native Harness and Multi-Model Compatibility

> 对应 Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`
>
> 角色：Debugger
>
> 日期：2026-08-29
>
> 工作树：`D:\\Work\\CraftStation\\craftstation\\.worktrees\\v0.8`
>
> 分支：`feature/v0.8-opencode-native`
>
> HEAD：`7ae6506` + 未提交 v0.8 改动
>
> Coder 交付：[coder_0.8.0.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/agent_docs/coder_0.8.0.md)
>
> Manager Plan：[manager_0.8.0.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/agent_docs/manager_0.8.0.md)
>
> Verdict：**FAIL / BLOCKED**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**

## Review Scope

独立验收 Coder 自称完成的 T01→T08。不以合同测试、Provider catalog 或 compatibility JSON 中的记录存在当作真实 provider E2E PASS。核对：

1. Official `opencode serve` HTTP/OpenAPI + SSE，不抓 TUI。
2. OpenCode 作为 `harnessKind: "opencode"`，provider/model 独立传递。
3. 五类 Model：OpenAI、xAI/Grok、Gemini/Google、DeepSeek Model（不是 DSH）、Kimi Moonshot-native 与 OpenAI-compatible。
4. capability 诚实性：`implementation missing` / recipe `EXPERIMENTAL` / 真实矩阵 `unavailable`。
5. 安全：authRef/profileRef 不把 secret 投影到 renderer。
6. 全量回归/lint 的既有失败必须独立归因，不得让 Coder 为全绿去改无关品牌/迁移测试。

未执行 commit / push / tag / merge main。未改 v0.6 `craftstation-dev` 或 v0.7 工作树。

## Evidence

### 独立复跑（本轮 Debugger）

- 定向 Vitest：8 files / 41 passed。证据：[v0.8.0-debugger-targeted-test.txt](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-debugger-targeted-test.txt)
  - src/shared/opencodeNative/binding.test.ts
  - src/supervisor/runtime/openCodeNative/events.test.ts
  - src/supervisor/runtime/openCodeNative/session.test.ts
  - src/supervisor/runtime/openCodeNative/transport.test.ts
  - src/shared/crafting/openCodeNativeComposition.test.ts
  - src/shared/crafting/nativeHarnessRegistry.test.ts
  - src/shared/crafting/crafting.test.ts
  - src/supervisor/runtime/nativeHarness/controlPlane.test.ts
- `pnpm exec tsc --noEmit -p tsconfig.json`：通过。
- 触及目录 `oxlint --deny-warnings`：通过。
- 触及文件 `oxfmt --check`：17 files 通过。
- `git diff --check`（触及源码）：通过。
- 本机真实 CLI：`where opencode / opencode.exe / opencode.cmd` 均未发现，独立复现 **OPENCODE_BINARY_UNAVAILABLE**。
- 基线失败抽样：`src/shared/craftstationPaths.test.ts` 2 failed。期望 `.craftstation`，实际 `.craftstation`。与 OpenCode 改动无关，属于既有品牌路径测试未更新。

### Coder artifact（独立阅读，不升格）

- 审计：[v0.8.0-opencode-audit.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-opencode-audit.md)
- 兼容矩阵：[v0.8.0-opencode-compatibility.json](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-opencode-compatibility.json)
  - probe.status=`unavailable`
  - reason=`OPENCODE_BINARY_UNAVAILABLE`
  - OpenAI / xAI / Google / DeepSeek / Moonshot-native / OpenAI-compatible Kimi 全部 `unavailable`
  - evidencePolicy 写明 fixture/catalog 不能当真实 PASS

### 源码事实

- SDK：`package.json` `@opencode-ai/sdk` = `^1.18.10`。这是 SDK package 版本，不是本机 CLI executable 版本。
- Transport：`OpenCodeNativeTransport` spawn 官方 serve，解析 `opencode server listening` URL；无 binary 时 `RUNTIME_UNAVAILABLE`。
- Session：create/promptAsync/abort/messages/summarize/delete + server-wide SSE；未知事件保留 envelope，映射为 PROTOCOL_MISMATCH diagnostic。
- Factory：`createNativeHarnessRuntimeAdapter("opencode")` → `OpenCodeNativeRuntimeAdapter`。
- Descriptor：`native-harness:opencode`，`machineFacingBoundary=opencode serve (HTTP/OpenAPI + SSE)`，capabilities 为 `implementation missing`。
- Recipes：OpenAI / xAI / Google / DeepSeek / Moonshot-native / Kimi OpenAI-compatible 六条，compile 后 `harnessKind=opencode`。DeepSeek Model 不会变成 `harness:deepseek`。
- Binding：Kimi 两条 route 的 providerID 不同（`moonshotai` vs `moonshot-openai-compatible`）。
- 脱敏：composition 测试拒绝把 `apiKey` / `accessToken` / `token` 写入 CraftPlan；events/session 对 secret key redact；public binding 只暴露 `authConfigured/profileConfigured`。
- Control-plane：OpenCode 进入既有 public descriptor seam，不宣称 supported+integrated。
- 排除项成立：未见 Pi、Anthropic 新 Model Item、DSH 复活、Antigravity 当 OpenCode、CLIProxyAPI。

## Spec Fidelity

| Gate                           | 工程实现                                            | 真实证据                  | 结论                      |
| ------------------------------ | --------------------------------------------------- | ------------------------- | ------------------------- |
| Official serve HTTP/SSE        | 有 transport/session/event 合同测试                 | 无真实 `opencode serve`   | 工程关闭，runtime BLOCKED |
| Provider/model 与 harness 分离 | recipe + binding 锁定                               | 无真实 provider list/auth | 工程关闭                  |
| 五类模型真实 init/stream/tool  | 合同 compile 通过                                   | 矩阵全部 unavailable      | BLOCKED                   |
| Kimi 双 route                  | providerID 不同                                     | 无真实两条登录/请求       | 工程关闭，E2E BLOCKED     |
| DeepSeek Model ≠ DSH           | compile harnessKind=opencode                        | 无真实 DeepSeek 请求      | 工程关闭                  |
| Capability 诚实                | implementation missing / EXPERIMENTAL / unavailable | 一致                      | 关闭                      |
| UI/IPC 脱敏                    | control-plane + redact 测试                         | 无真实 IPC 流量含 secret  | 工程关闭                  |
| 既有回归失败                   | 品牌路径抽样失败                                    | 与 v0.8 diff 无关         | 不计入本 Feature 工程回归 |

Manager T05/T08 明确要求五类模型真实最小验证或可复现阻塞证据。当前阻塞证据成立，因此 Feature 不能 PASS。PASS 即便成立也只代表 DEV PASS / USER ACCEPTANCE PENDING。

## Integration / Regression / Edge Cases

- 无 binary：transport 抛 RUNTIME_UNAVAILABLE，diagnostic 不含 secret。
- DeepSeek OpenCode recipe 不会误绑 DSH descriptor。
- Kimi native 与 OpenAI-compatible 不会共用 providerID。
- 未知 SSE 事件不丢，进入 diagnostic。
- CraftPlan 不持久化 clientProperties 里的 apiKey/token。
- Google OpenCode recipe 复用现有 `google:antigravity-default` Model Item；兼容矩阵代表模型是 `gemini-2.5-pro`。这是目录不一致，不是把 Antigravity Harness 当成 OpenCode。记录为观察项，不单独作为必须立刻改代码的 FAIL。

## Findings

### F37 — 真实 OpenCode CLI / 五类模型 E2E 未完成

- Evidence：本机 `where opencode*` 失败；compatibility.json 全部 `unavailable`；Coder 也写明 OPENCODE_BINARY_UNAVAILABLE。合同测试只证明 compile/transport mock/event mapping。
- Impact：无法证明 OpenAI / Grok / Gemini / DeepSeek / Kimi 任一路能经官方 serve 得到真实 assistant stream、tool、compaction、usage。
- Root Cause：当前机器没有官方 OpenCode executable，也没有对应 provider 凭据。
- Fix：不要用 catalog 或 fixture 冒充。安装官方 `opencode` 后对六条 route 各做最小真实 smoke：init、assistant stream、至少一次后续 turn；有工具/压缩/用量就记录，没有就标 unsupported/unverified。证据只保留 status、model/provider id、是否 stream、错误码；禁止 API key / token / cookie。
- Acceptance：至少一条真实成功响应，或对每条 route 留下可复现的官方错误；矩阵不得把 unavailable 改写成 supported。无 binary 则保持 BLOCKED。

### 观察项（不进入 Fix Execution Order）

- Google OpenCode 组合目前 compile 的是 `google:antigravity-default`，矩阵写 `gemini-2.5-pro`。有真实 CLI 后再决定是否补独立 Gemini Model Item；现在不要求 Coder 为了目录美观改 recipe。
- 全仓 16 个既有失败（migrate / remote procedure / channel / craftstationPaths / probeCwd）与 v0.8 diff 无关。不要为全绿去改这些测试。
- 全仓 lint 仍可能被既有 `codexRouterOverlay.test.ts:52` 阻断；OpenCode 触及文件 lint 已通过。

既有质量门不得升格：Grok 真实额度、F29、v0.5.0、v0.4 F04、v0.6 F35/F36 继续 FAIL/BLOCKED。

## Fix Plan

Coder **不必**重做已关闭合同：descriptor、recipe、binding、transport mock、event mapping、control-plane 投影、脱敏测试。

只在官方 CLI 可用时补真实证据：

1. 确认 `opencode` executable 与 `opencode serve` 能在本机起来。
2. 按 F37 对六条 provider route 做最小真实 smoke，更新 compatibility.json；无凭据的 route 保持 unavailable 并写明原因。
3. 不要把 capability 从 implementation missing 升格为 supported+integrated，除非该 route 有真实响应。
4. 不要修改 v0.6 / v0.7 工作树，不要碰无关品牌路径测试。

无 CLI 则停止，保持 BLOCKED，不得 synthetic PASS。

## Fix Acceptance Criteria

- Feature v0.8.0 在缺少真实 serve/session 证据时不得标 PASS。
- compatibility records 与 probe.reason 必须诚实。
- 既有 v0.4 / v0.5 / v0.6 质量门保持 FAIL/BLOCKED。
- 继续禁止 commit / push / tag / merge main。

## Fix Execution Order

1. 等待官方 OpenCode CLI（及所需 provider 凭据）。
2. 有 CLI 后 Coder 只补真实探针与脱敏矩阵。
3. Debugger 复检 F37 后才能考虑 DEV PASS / USER ACCEPTANCE PENDING。

## Verdict

**FAIL / BLOCKED**

- 工程契约 / 定向测试：可关闭。
- 真实 OpenCode CLI 与五类模型 E2E：BLOCKED（F37）。
- Feature v0.8.0：不能 PASS。
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
