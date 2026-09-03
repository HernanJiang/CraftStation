# Manager — v1.0.1 Native CLI Multi-Account Profile Runtime

> 当前 Feature 的单一 Manager 交接入口。Part I 记录已批准的 Ideate；Part II 是可执行 Feature Spec / Tickets。用户原文标题写 v0.5，本 Feature 版本以用户后续指定的 **v1.0.1** 为准。

## Part I — Ideate

- Status：Planned
- Ready for Plan：Yes
- Created：2026-09-03
- Last Updated：2026-09-03
- Roadmap Context：v0.4 Native Multi-Harness 与 v0.5 Account & Usage 之后，多认证账号池已基本存在，但 Native CLI / Harness 经常仍使用机器默认 CLI 账号。本 Feature 修复 Profile Runtime，不重做 Account Pool / Quota / Usage。
- Owner：Manager / Ideate

### Feature Intent

#### Problem

CraftStation 的 UI / Account Resolver 已经能选出账号 B，但真正启动官方 CLI / Harness 后，经常仍然使用用户机器上默认 CLI 当前登录的账号 A。

最高优先级根因候选（Manager 薄审计已在 `main@f5a4bb2` 源码中确认，Coder T01 必须用真实 Native identity 复核）：

```text
Grok spawn / login 只钉 GROK_HOME
没有 GROK_LEADER_SOCKET
多个 Profile 仍可能连到 ~/.grok/leader.sock / 默认 Leader
Account B client -> default leader -> Account A
```

#### Why Now

用户已给出完整 brief，并明确禁止重新设计 Profile Isolation。必须把已验证的 MIT 开源实现移植进现有 Supervisor / Harness Adapter / Account 架构。Grok 是真实多账号基准，必须先 PASS。

#### Desired Outcome

```text
CraftStation
  -> prepareXProfile(account)
  -> NativeProfileSpec
  -> Supervisor
  -> official CLI / app-server / ACP
```

- Grok：每个 managed account 独立 `GROK_HOME` + `GROK_LEADER_SOCKET`；login 与 runtime 同一 namespace。
- Codex：account-scoped `CODEX_HOME`；官方 `codex app-server` 的 `account/read` 与所选账号一致。
- Kimi：account-scoped `KIMI_CODE_HOME`；禁止靠覆盖全局 `~/.kimi` 做并行 Session。
- Session sticky：Resolver 只在 New Session 执行一次。
- Identity mismatch fail-closed：`PROFILE_IDENTITY_MISMATCH`。
- Global CLI 当前登录不得污染已绑定的 managed session。

### Expected Behavior

#### User Experience

- 现有 Account Pool / Quota / Usage UI 保持，不移植 switch-acc-ai / subswap 的 TUI/CLI。
- 用户选择或 Resolver 选出账号 B 后，新建 Session 真实以 B 运行。
- 之后拖动账号排序、在终端 `grok logout/login` 到 C，已运行 Session 仍是 B。
- Stop / Interrupt 只作用到该 Session 的 native runtime，不能误杀另一账号的 Leader。

#### System Behavior

```text
Account Pool
  -> Account Resolver          # 只选出 accountId
  -> prepareXProfile(account)  # 生成 NativeProfileSpec
  -> Session bind once
  -> Entity / Runtime
  -> Harness Adapter
  -> Supervisor spawn
  -> official CLI
```

禁止：

```text
CraftStation -> sacc / subswap wrapper -> CLI
CraftStation -> CLIProxyAPI / OpenAI-compatible proxy
普通 grok login 写 ~/.grok/auth.json，再在 runtime 猜该复制哪个 token
所有账号共享 ~/.grok/leader.sock
```

### Scope

In:

- 当前 Grok / Codex / Kimi Native Profile Runtime audit 与修复
- 薄层 `NativeProfileSpec`
- Grok Leader isolation
- Codex `CODEX_HOME` + file credential store vs OS keychain
- Kimi `KIMI_CODE_HOME`
- Session sticky / interrupt isolation
- Native identity verification
- 脱敏 runtime diagnostic
- 复制/改编 MIT 源码时保留 copyright / license notice

Out:

- 重做 Account Pool / Quota / Tokscale / Usage UI
- 重新设计多账号调度（Priority / RR / Random 只负责选出账号）
- 移植参考项目 UI / wrapper CLI
- CLIProxyAPI / Responses proxy / 本地 reverse proxy 作为 Native Harness 执行路径
- main 收口、tag、push

### Important Decisions

1. 不要重新设计 Profile Isolation；移植 switch-acc-ai / subswap 已验证行为。
2. Runtime ownership 仍属于 CraftStation Supervisor。
3. Grok 必须先 PASS，再做 Codex / Kimi。
4. Shared assets（skills / plugins / rules）仅在不会把 auth 泄漏回 global home 时共享；否则优先隔离。
5. 本 Feature 在独立 worktree 开发，不把 Product Git Root `main` 上未提交的 hotfix 混入。

### Constraints

- Feature worktree：`D:\Work\CraftStation\.worktrees\v1.0.1-native-profile-runtime`
- Branch：`dev/v1.0.1-native-profile-runtime`
- Planning base：`main@f5a4bb2`
- Product Git Root `main` 当时有未提交 hotfix / 脚本，**不纳入本 Feature**。
- Coder 模型：`gemini-3.8-flash` / thinking `high`，不要覆盖。
- Debugger 由 Coder 在全部 Ticket + Feature self-check 后创建：`gpt-5.6-sol` / thinking `high`。
- Renderer 不接触 credential secrets。
- 日志禁止 access token / refresh token / cookie / API key / raw auth。
- 绿测、smoke、“实现了”不能单独写成 PASS；必须有 native reported identity 证据。

### Acceptance Intent

用户 brief 第 29 节 Definition of Done 全部满足，尤其：

- Grok B 不再退回机器默认 A
- 每账号独立 `GROK_HOME` + `GROK_LEADER_SOCKET`
- 两真实 Grok 账号可同时运行且 identity 不串号
- Codex `account/read` == selected account
- Kimi account-scoped native profile
- Global CLI 不能污染 managed session
- Session sticky + interrupt isolation
- `PROFILE_IDENTITY_MISMATCH` 可检测并阻止错误账号继续
- 最终报告含 Root Cause、Reused OSS + license、Runtime Evidence、Test matrix

### Open Questions

无阻塞问题。参考仓库是否写入 `reference/BASELINES.md` 由 Coder 按只读参考规则决定；不得把它们放进产品可执行路径当 wrapper。

## Part II — Plan

### Plan Metadata

- Status：`PLAN READY / EXECUTING`
- Feature：`v1.0.1 — Native CLI Multi-Account Profile Runtime`
- Planning Base：`main@f5a4bb2`
- Feature Branch：`dev/v1.0.1-native-profile-runtime`
- Feature Worktree：`D:\Work\CraftStation\.worktrees\v1.0.1-native-profile-runtime`
- Implementation Owner：Coder-1.0-Native Profile Runtime
- Coder model：`gemini-3.8-flash` / `high`
- Debugger model（Coder 完成后创建）：`gpt-5.6-sol` / `high`

### Objective

修复 “selected B, native still A”。把 switch-acc-ai 的 Grok Profile/Leader 隔离和 subswap 的 Codex/Kimi provider/profile 逻辑移植进现有架构；最终仍由 CraftStation Supervisor 启动官方 Harness。

### Manager Thin Audit — `main@f5a4bb2`

这是 Plan 用薄审计，不是 T01 的完整 DONE/FIX/MISSING 矩阵。Coder 必须用真实 Native Runtime identity 复核。

| Layer | Current evidence | Mark | Note |
|---|---|---|---|
| Account Pool / Store | `src/supervisor/runtime/accountStore.ts` 已有 managed root，并强制 `GROK_HOME`/`CODEX_HOME` 指向该账号 credential root | DONE | 调度层不要自己改 auth.json |
| Account Resolver | `src/supervisor/runtime/accountResolver.ts` explicit / selected / auto | DONE | 只选出 account |
| Session env seam | `resolveAccountSessionEnv` in `managerOptions.ts` + `spawnPipeline.ts` 把 pool env merge 进 `baseSpawnEnv` | FIX | 当前注释/实现只强调 `GROK_HOME`/`CODEX_HOME` |
| Grok profile control plane | `src/supervisor/runtime/grokProfiles.ts` `managedGrokProcessEnvironment()` **只设置 `env.GROK_HOME`**；登录脚本只检查 `GROK_HOME` | FIX | **产品源码无 `GROK_LEADER_SOCKET` / `leader.sock`** |
| Grok adapter spawn | `src/supervisor/runtime/nativeHarness/index.ts` `withGrokBaseSpawnEnv` + `createGrokAdapter()` | FIX | 依赖传入 env；未补 Leader socket |
| Codex | 已有 managed `CODEX_HOME` 投影 | FIX | 必须 native `account/read` + 防止 OS keychain 泄漏 A |
| Kimi | 需 T01 深追 `KIMI_CODE_HOME` / global `~/.kimi` | MISSING/FIX | 以 subswap kimi provider 为准 |
| Identity verification | 未见启动后 `PROFILE_IDENTITY_MISMATCH` fail-closed | MISSING | T04/T06/T07 补 |
| Wrapper / proxy | 现有路径是 Supervisor spawn official CLI | DONE | 禁止改成 sacc/subswap/CLIProxyAPI |

### Architecture and Interfaces

最小修改薄层，字段可按现有代码微调，不要重构整个 Harness：

```ts
interface NativeProfileSpec {
  providerId: string;
  accountId: string;
  profilePath: string;
  env: Record<string, string>;
  credentialScope?: string;
  runtimeIsolation?: {
    ipcPath?: string;
    socketPath?: string;
  };
}
```

Grok managed account 最终必须类似：

```text
GROK_HOME=<craftstation-managed>/accounts/grok/<id>
GROK_LEADER_SOCKET=<same>/leader.sock
```

登录：

```text
GROK_HOME=B
GROK_LEADER_SOCKET=B/leader.sock
grok login ...
```

Runtime：

```text
Supervisor
  env: GROK_HOME=B, GROK_LEADER_SOCKET=B/leader.sock
  -> official grok agent stdio / official machine runtime
```

Codex：

```text
CODEX_HOME=<profile>
official codex app-server
account/read == selected
account/rateLimits/read == same account
```

若官方 Codex 会从 OS keychain 读 A，按 subswap / upstream 使用 profile 内 file credential store；不要发明非官方 credential injection。

Kimi：

```text
KIMI_CODE_HOME=<profile>
official Kimi Code CLI
```

Private vs Shared：

- Private：auth、tokens、account-specific state、runtime IPC/socket
- Shared：skills / plugins / rules / AGENTS.md，仅当不会破坏账号隔离

### Tickets

#### T01 — Audit 当前 CraftStation profile/runtime

- Goal：沿真实链路追踪 Account Pool → Resolver → Session → Entity → Adapter → Supervisor spawn → official CLI。
- Per provider 记录：selected account id、resolved profile path、effective env、credential path、native runtime identity。输出 DONE / FIX / MISSING。
- 必须验证真实 Native Runtime identity，不要只看 UI state。
- 重点：Grok 是否只设 `GROK_HOME` 而共享默认 `leader.sock`。
- Depends On：无。

#### T02 — Clone / 阅读 switch-acc-ai

- Goal：研究 https://github.com/tonamson/switch-acc-ai
- 重点文件：`src/core/accounts.ts`、`src/core/grok.ts`
- 重点函数：`runGrok`、`loginGrok`、`grokEnv`、`readAuthFile`、`readAuthStatus`、`linkSharedProfile`、`ensureProfile`、`requireProfile`，尤其 `GROK_LEADER_SOCKET`
- 只复用 Profile Engine / Account Isolation / Credential Handling / Environment Preparation
- 禁止最终架构变成 `CraftStation -> sacc grok account -> grok`
- MIT copyright / license notice 必须保留
- Depends On：T01

#### T03 — Clone / 阅读 subswap

- Goal：研究 https://github.com/x0c/subswap
- 重点：`crates/providers/common`、`crates/providers/codex`、`crates/providers/kimi`、`crates/core`
- 复用 isolated profile、credential snapshot、profile preparation、official CLI isolated run、`CODEX_HOME`、`KIMI_CODE_HOME`、transactional credential handling、quota/account identity
- 辅助参考：switch-acc-ai `src/core/codex.ts`
- 不移植 TUI/CLI；不把 wrapper 放进产品可执行路径
- Depends On：T01

#### T04 — Grok tracer bullet：`GROK_HOME` + `GROK_LEADER_SOCKET`

- Goal：先修最高优先级。建立/完善 `NativeProfileSpec`，让 Grok login 与 runtime 使用同一 managed profile namespace。
- `managedGrokProcessEnvironment`、login script、ACP/PTY spawn 都必须设置独立 `GROK_LEADER_SOCKET`，禁止共享 `~/.grok/leader.sock`
- Session 创建时绑定一次：`session.runtimeAccountId` + `session.nativeProfile`；后续 send/interrupt/resume 继续用该 Profile
- 启动后做低成本 native identity verification；不一致则 `PROFILE_IDENTITY_MISMATCH` 并阻止继续
- 增加脱敏诊断：provider、accountId、profilePath、GROK_HOME、GROK_LEADER_SOCKET、pid、nativeSessionId、native reported identity
- Depends On：T01、T02

#### T05 — 两个真实 Grok 账号 E2E + 并发 Leader

- Goal：机器默认 Global Grok = A 时，CraftStation Profile B 必须实际 identity = B
- 同时 Session X=A、Session Y=B；`A leader socket != B leader socket`；identity 不串号
- Restart 后 profiles/credentials/aliases/priority 保持；新建 Session 仍真实启动 Resolver 选出的账号
- Interrupt Session A 不得误杀 Session B
- Depends On：T04
- Grok 必须本 Ticket PASS 后才允许把 Codex/Kimi 标为 Feature done

#### T06 — Codex profile repair

- Goal：account-scoped `CODEX_HOME`，官方 `codex app-server`
- Native 验证：`account/read` 与 `account/rateLimits/read` == selected account
- 检查 `config.toml` / credential store，防止 `CODEX_HOME=B` 仍从 OS keychain 读 A
- 只使用 upstream / subswap 实际采用的官方/file credential store
- Depends On：T03、T05

#### T07 — Kimi profile repair

- Goal：account-scoped native profile / `KIMI_CODE_HOME`
- 不要通过全局 `~/.kimi` 来回覆盖实现并行 Session
- 若当前 Kimi 还有其它必须隔离的 native state，按 subswap 一起移植
- Depends On：T03、T05

#### T08 — Session sticky / interrupt regression + 全量矩阵

- Goal：Resolver 只在 New Session 执行；pool 重排不改变 live session
- Stop/interrupt 作用到对应 Profile Runtime
- 填完整用户 brief 第 25/26/27 节矩阵，全部用 native identity 而不是 UI state
- Feature-level self-check 后，Coder 自行创建 `Debugger-1.0-Native Profile Runtime`，模型 `gpt-5.6-sol` / `high`，同一 worktree
- Depends On：T04–T07

### Dependencies

```text
T01
 ├─ T02
 │    └─ T04 ─┐
 ├─ T03       ├─ T05 ─┬─ T06 ─┐
 │            │       └─ T07 ─┴─ T08
```

Grok 是 blocker。没有 T05 native evidence，不得宣称 Codex/Kimi 完成。

### Execution Order

严格按用户 brief：

```text
1. T01 Audit
2. T02 switch-acc-ai
3. T03 subswap
4. T04 Grok tracer bullet
5. T05 two real Grok accounts E2E
6. T06 Codex
7. T07 Kimi
8. T08 sticky / interrupt / full matrix
9. Coder self-check then create Debugger
```

单 Coder 连续执行，不要每完成一个 Ticket 就停下来等人批准。

### Acceptance Criteria

用户 brief §17–§29 全部适用。最低证据：

| Provider | Global CLI | CraftStation Account | Native Actual | PASS |
|---|---|---|---|---|
| Grok | A | A | A |  |
| Grok | A | B | B |  |
| Grok | B | A | A |  |
| Codex | A | managed profile | expected managed identity |  |
| Kimi | A | managed profile | expected managed identity |  |

并发：Global CLI=A 时 Session X=A 且 Session Y=B。

最终报告必须包含：

1. Root Cause：为什么 selected B → actual A
2. Reused Open Source：从 switch-acc-ai / subswap 实际复用了哪些文件或设计，以及 license preservation
3. Runtime Evidence：selected account、profile、native reported identity、pid/session id；无 secret
4. Test Results：Grok A/B simultaneous、Codex isolated、Kimi isolated、Stop regression、Session sticky

### Key Decisions / Risks

- 风险：Grok Leader 仍连默认 socket。缓解：T04 把 `GROK_LEADER_SOCKET` 做成 spawn/login 必填，并用并发 E2E 证明 socket 不同。
- 风险：Codex OS keychain 泄漏。缓解：按 subswap/upstream 配置 file credential store，并用 `account/read` fail-closed。
- 风险：把参考项目当成 wrapper。缓解：只移植 profile/env 准备，Supervisor 仍 spawn official binary。
- 风险：为了共享 skills 把 auth 泄漏回 global home。缓解：共享失败则隔离。

### Coder Prompt Contract

Coder 必须：

1. 只在本 Feature worktree / `dev/v1.0.1-native-profile-runtime` 写代码。
2. 不要重新设计 Profile Isolation。
3. 不要实现到 Product Git Root `main`。
4. 不要 merge/tag/push `origin/main`。
5. 不要创建第二个 Manager。
6. 全部 Ticket + Feature self-check 完成后，自己创建 Debugger：标题 `Debugger-1.0-Native Profile Runtime`，模型 `gpt-5.6-sol` / thinking `high`，绑定 CraftStation projectId 与本 worktree。
7. 连续执行到 Feature 可交给 Debugger。
