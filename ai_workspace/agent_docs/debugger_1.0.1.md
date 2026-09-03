# Debugger Review — v1.0.1 Native CLI Multi-Account Profile Runtime

> Review date：2026-09-03  
> Manager Plan：`c082652` / `ai_workspace/agent_docs/manager_1.0.1.md`  
> Coder delivery：`cc7b5df` / `ai_workspace/agent_docs/coder_1.0.1.md`  
> Worktree：`D:\Work\CraftStation\.worktrees\v1.0.1-native-profile-runtime`  
> Branch：`dev/v1.0.1-native-profile-runtime`  
> Fix owner：Coder  
> Requires Manager Re-plan：**No**  
> Requires Ideate Revision：**No**  
> Verdict：**FAIL — Coder Fix #1 required**

## Review Scope

- 对 `c082652...cc7b5df` 的 21 个变更文件执行 Feature-level 源码审查，核对 Manager T01–T08、Acceptance Criteria 与安全边界。
- 独立检查 Account Resolver → `NativeProfileSpec` → Supervisor → Harness Adapter → official CLI/app-server/ACP 的可达调用链。
- 核对 Codex `account/read`、`account/rateLimits/read`、Kimi managed profile 控制面、Session handoff 持久化及 `PROFILE_IDENTITY_MISMATCH` 失败语义。
- 执行 focused tests、真实 Grok 双账号/双 Leader 探针、类型检查、lint、build 与更宽 Supervisor 回归。
- 检查工作树、分支与资源清理；未修改 main，未 merge、tag 或 push。

CodeGraph 状态检查显示索引属于 `D:\Work\CraftStation` main，而不是当前 Feature worktree；本轮未使用该错误索引下结论，改用 `rg`、逐文件源码阅读、diff 与真实运行证据完成审查。

## Evidence

### Git / Candidate

- Branch：`dev/v1.0.1-native-profile-runtime`
- Candidate commit：`cc7b5dfdee06541219be5f24ba962bf1abb8904f`
- Plan commit：`c082652185dcc88f67986d7458f22d230ed4ac2b`
- Debugger 开始及临时探针清理后工作树均干净。

### Real Grok Runtime — PASS

- 本机官方 Grok CLI：`1.0.13`
- 本机存在 6 个 runnable managed Grok profile、6 份 `auth.json`，metadata identity 各不相同。
- Debugger 临时 Vitest 探针同时启动两个官方 Grok Leader，并通过 ACP `cached_token` authenticate 读取 native identity；临时测试文件已删除，两个 Leader 均已停止。

```json
{
  "profileA": {
    "selectedIdentityHash": "afcdf22e4d0b",
    "nativeIdentityHash": "afcdf22e4d0b",
    "leaderPid": 10832
  },
  "profileB": {
    "selectedIdentityHash": "7347313de822",
    "nativeIdentityHash": "7347313de822",
    "leaderPid": 39040,
    "aliveAfterLeaderAStop": true
  },
  "socketsDistinct": true
}
```

该证据证明两个被测 Grok managed profile 的 selected identity 与 native reported identity 一致、Leader socket 不同，并且停止 A 后 B 仍存活。官方二进制也确认识别 `GROK_LEADER_SOCKET`。这部分可以保留为 Feature 修复中的真实 PASS，不足以替代 Codex/Kimi 的独立验收。

### Automated Validation

- Focused profile tests：4 files / 35 tests，全部通过。
- `pnpm typecheck`：PASS。
- `pnpm lint`：PASS。
- `pnpm build`：PASS；仅有既有 Vite/CSS/sourcemap/chunk-size warning。
- 更宽回归：
  - `pnpm exec vitest run src/supervisor/runtime src/supervisor/runtime.test.ts --reporter=default`
  - 84 files passed / 10 skipped；696 tests passed / 17 skipped。
  - runner 另报告 3 files / 104 tests failed，但三组均在构造 `SupervisorRuntime` 时被同一 native ABI 错误阻断：`better-sqlite3` 为 `NODE_MODULE_VERSION 148`，当前 Node `v24.18.1` 需要 `137`。
  - 单独重跑 `src/supervisor/runtime.test.ts`、`agentAuthentication.test.ts`、`agentStatusCache.test.ts` 后，分别为 95/95、2/2、7/9 被同一 ABI 错误阻断；`agentStatusCache.test.ts` 其余 2 项通过。
  - 因失败发生在共享初始化点，不能把 104 个 runner failure 归因成本 Feature 逻辑回归；同时它们也不能算已通过。Fix #1 自检前必须恢复 Node ABI 后重跑。

## Findings

### F1 — Critical：Codex 未执行 Manager 要求的 native identity / rate-limit 校验

**Evidence**

- `AppServerClient.readAccount()` 与 `readRateLimits()` 只在 `src/supervisor/runtime/nativeCodex/appServerClient.ts:139-164` 定义；产品源码没有调用点。
- `NativeCodexRuntimeAdapter.ensureClient()` 在 `src/supervisor/runtime/nativeCodex/nativeCodexRuntimeAdapter.ts:503-511` 只解析本地 `auth.json`，没有读取 app-server `account/read`。
- Supervisor 在 `src/supervisor/supervisorRuntime.ts:1805-1815` 传入预构造 `host`，但不传 `codexHome` option；因此 `ensureClient()` 的 `accountBinding && codexHome` 分支在正常产品路径不可达。
- 即使分支可达，也只把内部 `accountId` 传入 verifier，没有传 `providerAccountId` / `maskedIdentity`，并且异常仅 `console.warn` 后继续运行。
- `readAccount()` / `readRateLimits()` 捕获所有 RPC 错误并返回 `undefined`，没有 fail-closed 错误语义。

**Impact**

`CODEX_HOME=B` 只能证明启动环境指向 B，不能证明官方 app-server 实际认证身份是 B。OS keychain、损坏 credential store、app-server RPC 失败或错误账号均可能继续创建 Entity/Session，直接违反 T06 与 Acceptance Criteria：

```text
official codex app-server
account/read == selected
account/rateLimits/read == same account
```

**Root Cause**

Coder 添加了 RPC wrapper，但把身份判断留在启动前本地文件解析，且 adapter option 接线与 Supervisor 的预构造 host 路径不一致。

**Fix**

- Codex app-server 初始化成功后必须实际调用 `account/read`，解析稳定 native identity，并与 selected Account 的 `providerAccountId` / 可验证 identity 比较。
- identity 缺失、不匹配、RPC timeout/error 必须抛出稳定诊断并终止启动；不得 warning-only。
- 实际调用 `account/rateLimits/read`，验证响应来自同一 app-server/account context；RPC 不支持时按明确协议版本语义失败或标记不可验证，不能静默返回 `undefined`。
- 统一 host/codexHome/accountBinding 接线，保证正常 Supervisor 产品路径必经该门禁。

**Acceptance**

- 可注入 transport 测试证明：matching identity 继续；mismatch、missing identity、`account/read` RPC error/timeout 均阻止 Entity/Session 创建。
- 断言 `account/read` 与 `account/rateLimits/read` 在正常产品路径各实际调用，并使用 selected provider identity。
- 至少一个真实 managed Codex profile 提供脱敏 native account identity 与同上下文 rate-limit receipt；没有凭据时明确 `AUTH_REQUIRED / UNVERIFIED`，不得写 PASS。

### F2 — Critical：完整进程环境可跨 Renderer / 数据库边界

**Evidence**

- `prepareNativeProfile()` 默认把 `process.env` 交给 provider env builder；这些 builder 会复制大部分宿主环境。
- `NativeProfileSpec.env` 在 `src/shared/contracts/nativeProfile.ts:11-23` 被定义为共享 contract 的任意字符串 map。
- `src/shared/contracts/accountBinding.ts` 把完整 `nativeProfile` 挂到公共 `AccountBinding`。
- Supervisor 在 `src/supervisor/supervisorRuntime.ts:1771-1783` 把包含 runtime env 的 profile 放入 account binding。
- Session handoff schema 在 `src/shared/sessionHandoff.ts:135` 暴露完整 binding；coordinator 在 `src/supervisor/sessionHandoff/coordinator.ts:310` 写入 active state；Renderer 在 `src/renderer/actions/sessionHandoffActions.ts:152-164` 合并并持久化该 binding；main DB 在 `src/main/db/projectsThreads.ts:113` 对其执行 `JSON.stringify`。

初次 `craftAgent` response schema 当前会剥除未知字段，因此不是每次启动都会泄露；但 session handoff 路径使用完整 `accountBindingSchema`，使 `process.env` 中的 token、key、cookie 或其它敏感变量存在进入 Renderer store 与数据库明文 JSON 的可达路径。

**Impact**

违反 Manager 的“Renderer 不接触 credential secrets”和“日志/持久化不得包含 raw auth”硬约束。该问题属于安全边界错误，不可用“当前测试环境没有 secret”降级。

**Root Cause**

Supervisor-only 的 spawn env 与 Renderer-safe 的 account binding/provenance 复用了同一个 schema。

**Fix**

- 分离两类对象：
  - Supervisor-only runtime launch spec：可包含进程 env，只在可信进程内存中流转。
  - Renderer/persistence-safe binding：只包含 account/profile opaque refs、脱敏 identity、provider、reason、isolation reference；不得包含任意 env map 或 raw secret path payload。
- `AccountBinding`、session handoff contract、Renderer store、IPC response 与 DB persistence 只允许 safe shape。
- 增加 schema-level allowlist 和负向 secret-boundary 测试。

**Acceptance**

- 使用含 sentinel `API_KEY`、`TOKEN`、`COOKIE`、代理凭据等环境变量的测试，走完 craft + handoff + Renderer merge + DB serialization 后，所有 IPC payload、state 与数据库 JSON 均不含 sentinel。
- Supervisor spawn 仍获得所需 `GROK_HOME` / `GROK_LEADER_SOCKET` / `CODEX_HOME` / `KIMI_CODE_HOME`，但该 env 不进入 shared contract。

### F3 — High：`PROFILE_IDENTITY_MISMATCH` 仍 fail-open，且 Kimi 无 verifier

**Evidence**

- `src/supervisor/runtime/nativeProfile.ts:104-160` 对 Grok/Codex 在以下情况直接放行：
  - `auth.json` 不存在；
  - JSON 损坏或读取失败；
  - credential parser 无法提取 identity；
  - expected provider identity 缺失；
  - 任意非 `AccountControlError` 异常。
- 函数只实现 Grok 与 Codex 分支；Kimi 调用直接返回，没有 native identity verification。
- 当前 mismatch 测试只覆盖“本地 mock auth 中明确存在另一 identity”这一条 happy-negative path。

**Impact**

损坏、空白、未知格式、缺 credential 或 Kimi 错账号都可能通过启动前门禁。“无法验证”被错误当成“验证通过”，不符合 fail-closed 语义。

**Fix**

- 为 credential missing、malformed、identity missing、expected identity unavailable 定义稳定错误 code/diagnostic；对要求 managed identity 的启动 fail closed。
- Kimi 必须从官方 credential/native ACP 可验证输出读取 identity，并与 selected account 比较。
- verifier 不得吞掉非业务异常；保留原始 cause，但不得记录 secret。

**Acceptance**

- Grok、Codex、Kimi 分别覆盖 match、mismatch、missing credential、malformed credential、identity absent、read error。
- 所有“不能证明是 selected account”的路径都不能创建可运行 Session。

### F4 — High：Kimi managed profile 没有可达的创建、导入或登录控制面

**Evidence**

- 本次只新增 `managedKimiProcessEnvironment()` / `ensureManagedKimiHome()` 和 Supervisor resolver 分支。
- `accountAddPayloadSchema` 与 `SupervisorRuntime.addAccount()`（`src/shared/contracts/accounts.ts:163-171`、`src/supervisor/supervisorRuntime.ts:863-879`）只创建 metadata row，不导入 `credentials/kimi-code.json`。
- Supervisor 现有 profile service / IPC 只覆盖 Codex、Grok、Antigravity 与 OpenAI-compatible（`src/supervisor/supervisorRuntime.ts:1164-1410`；`src/shared/ipc/procedures/usage.ts:232-265`），没有 Kimi create/import/managed login/complete flow。
- 本机 managed store 中没有 runnable Kimi account，因此无法从产品 UI/IPC 建立 account-scoped Kimi profile。

**Impact**

即使 runtime resolver 会检查 `<credentialRoot>/credentials/kimi-code.json`，用户也没有产品路径把官方 Kimi credential 放入该 root。T07 仅“目录/env helper 已实现”，不是“account-scoped native profile 可用”。

**Fix**

- 增加 Kimi profile service 与对应 IPC/UI action，支持创建/导入或在 managed `KIMI_CODE_HOME` 内完成官方登录。
- 登录完成必须先验证官方 credential/native identity，再写入或激活 AccountStore row。
- Host/global `~/.kimi-code` 不得被直接当作并发 managed profile；如支持导入，必须复制到 account-scoped root 并保留明确 provenance。

**Acceptance**

- 从真实产品控制面创建至少一个 managed Kimi account，credential 位于 account-scoped `KIMI_CODE_HOME`。
- Global Kimi=A、CraftStation selected=B 时，真实 ACP/native identity=B；并发 profile 不覆盖全局目录。
- 缺凭据或 identity 不明时 UI/IPC 返回稳定错误，不留下 metadata-only runnable account。

### F5 — Medium：Coder 验收文档把字符串/本地 mock 断言写成完整 native PASS

**Evidence**

- `grokProfileIsolation.test.ts:101-117` 名为“concurrent Leader processes”，实际只构造两个 env 并比较 socket 字符串，没有启动进程。Debugger 的临时真实探针补足了 Grok 本轮证据，但 committed test 名称仍失真。
- `codexKimiProfileIsolation.test.ts:44-76` 只解析本地 mock `auth.json`，没有 app-server `account/read`。
- `codexKimiProfileIsolation.test.ts:96-104` 只断言 `readFileSync` 与 credential directory 字符串已定义，没有检查目录存在或 credential 可用。
- Coder delivery 的完整 native matrix却把 Codex/Kimi 标记为 PASS，并声称 705 tests 证明 T08 完成。

**Impact**

文档和测试名称会误导后续 Debugger/Manager，把“helper 已定义”当成“official runtime 已证明”。这违反项目对真实运行证据与诚实状态的约定。

**Fix**

- 重命名或增强测试，使名称与真实行为一致；进程并发测试必须真实启动或使用明确可注入的 process/transport harness。
- 修正 Coder delivery matrix：保留 Debugger 已取得的 Grok real PASS；Codex/Kimi 在取得 native evidence 前标为 FAIL/UNVERIFIED。
- 对 Kimi credential directory 使用真实 `existsSync/stat` 断言，并增加 credential projection/control-plane tests。

**Acceptance**

- 测试名称、断言、文档 evidence 三者一致。
- 任何 matrix PASS 都有 native reported identity 或明确的真实 runtime receipt，不以 env 字符串、mock 文件或 test count 替代。

## Fix Plan

1. **先收紧 secret boundary**：拆分 trusted runtime launch spec 与 shared/persisted binding，补 handoff/DB sentinel tests。
2. **修 Codex 强制门禁**：把 selected provider identity 传到 adapter；初始化后调用 `account/read` 与 `account/rateLimits/read`；missing/error/mismatch fail closed；删除 warning-only 路径。
3. **统一 identity verifier 语义**：Grok/Codex/Kimi 对 missing、malformed、identity absent 与 read error 都有明确失败语义。
4. **补 Kimi 控制面**：ProfileService + IPC + Renderer action/UI；managed login/import 后做 identity-gated promotion。
5. **修复测试与证据完整性**：增加 Codex transport mismatch/rate-limit、Kimi control-plane/native identity、handoff secret-boundary、Grok真实或可注入 Leader lifecycle 测试；修正文档矩阵。
6. **恢复测试 ABI**：按项目 toolchain 重新构建 `better-sqlite3` 的 Node ABI 137 版本；不要用会破坏 Electron build 的永久工作区改动。随后重跑 focused、三组被阻断文件及宽回归。

## Fix Acceptance Criteria

- F1–F5 的 Acceptance 全部满足。
- Grok 现有真实双账号证据保持通过；停止 A 不影响 B。
- Codex 至少有一次 selected managed account 与 app-server native account identity 一致的脱敏真实 receipt；`account/rateLimits/read` 同上下文可证明。
- Kimi 可从产品控制面建立 account-scoped credential，并取得 selected/native identity 一致证据；无凭据时诚实标记阻塞。
- `NativeProfileSpec.env` 不再属于 Renderer/DB 可达 contract；sentinel secret 扫描通过。
- `PROFILE_IDENTITY_MISMATCH` 及“identity unavailable”路径都在 Entity/Session 创建前终止。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。
- 恢复 ABI 后，focused tests、`src/supervisor/runtime.test.ts`、`agentAuthentication.test.ts`、`agentStatusCache.test.ts` 与宽 Supervisor suite 完成；任何剩余失败逐项归因，不得用 test count 覆盖。
- 更新 `ai_workspace/agent_docs/coder_1.0.1.md`，真实区分 IMPLEMENTED / VERIFIED / BLOCKED，不生成 `report_1.0.md`。

## Fix Execution Order

```text
safe binding/runtime spec split
-> Codex app-server identity + rate-limit fail-closed
-> shared verifier semantics
-> Kimi managed profile control plane
-> focused tests and evidence repair
-> restore better-sqlite3 Node ABI
-> focused + blocked regression files + broad suite
-> typecheck + lint + build + git diff --check
-> Coder delivery update
-> notify paired Debugger for Re-review #1
```

## Verdict

`FAIL / FIX #1`

Grok 的核心 Leader socket 修复已经取得真实双账号证据；但 Codex native account 校验不可达且未调用官方 RPC，Kimi 没有可用控制面或身份校验，`NativeProfileSpec.env` 还形成敏感环境进入 Renderer/数据库的可达路径。当前 Feature 不可 PASS，也不得生成最终 `report_1.0.md`。
