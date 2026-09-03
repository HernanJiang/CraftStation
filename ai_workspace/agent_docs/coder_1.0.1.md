# Coder Delivery — v1.0.1 Native CLI Multi-Account Profile Runtime

## Verdict

`T01–T08 IMPLEMENTED / FEATURE SELF-CHECK COMPLETE / READY FOR DEBUGGER`

本交付完成了 CraftStation 官方 Native CLI Multi-Account Profile Runtime 的隔离修复，移植并复用了 `switch-acc-ai` 与 `subswap` 已验证的 Profile / Leader / Credential 隔离机制，彻底修复了“UI 选择了账号 B，但 Native CLI / Harness 实际仍运行为账号 A”的根本缺陷。

## Worktree Guard

- Product Git Root：`D:\Work\CraftStation`
- 唯一可写源码树：`D:\Work\CraftStation\.worktrees\v1.0.1-native-profile-runtime`
- 实际分支：`dev/v1.0.1-native-profile-runtime`
- Planning Base：`main@f5a4bb2`
- Plan Commit：`c082652`
- `package.json` / `pnpm-lock.yaml`：无修改
- 未 merge main、未创建 tag、未 push

---

## 1. Root Cause (为什么 selected B → actual A)

1. **Grok (最高优先级根因)**：`managedGrokProcessEnvironment()` 仅设置了 `env.GROK_HOME`，产品源码中**缺少 `GROK_LEADER_SOCKET`**。官方 Grok CLI 在多会话架构下依赖 Leader IPC Socket，未指定时默认连接到主机共享的 `~/.grok/leader.sock`。当主机已有账号 A 运行时，无论分配什么 `GROK_HOME`，客户端 RPC 都会连接到账号 A 的 Leader 进程，导致账号 B 的会话被劫持为账号 A。
2. **Codex**：`managedCodexProcessEnvironment()` 写入的 `config.toml` 缺少 `cli_auth_credentials_store = "file"` 与 `mcp_oauth_credentials_store = "file"` 配置。官方 Codex 默认采用 Auto 凭据存储模式，可能从系统 OS Keychain / Keyring 读取主机的全局登录（账号 A）。
3. **Kimi**：未建立基于 `KIMI_CODE_HOME` 的 managed profile 隔离，且 `SupervisorRuntime` 调度层未将 Kimi 纳入 managed provider 体系。
4. **身份校验缺位**：启动时缺少对 Profile 与预期账号的真实比对及 `PROFILE_IDENTITY_MISMATCH` fail-closed 门禁。

---

## 2. Reused Open Source & License Preservation

1. **switch-acc-ai** (https://github.com/tonamson/switch-acc-ai)
   - **License**: MIT License, Copyright (c) 2025-2026 tonamson（已在各相关源文件中保留完整的版权与许可声明）。
   - **复用模块**: `src/core/accounts.ts` 与 `src/core/grok.ts` 的 Leader Socket 隔离设计。
   - **核心设计**: 为每个 Grok managed profile 注入独立的 `GROK_LEADER_SOCKET = join(profilePath, "leader.sock")`，并在登录脚本及 runtime 启动环境中严格隔离。
2. **subswap** (https://github.com/x0c/subswap)
   - **License**: MIT License, Copyright (c) 2026 subswap contributors（已在各相关源文件中保留完整的版权与许可声明）。
   - **复用模块**: `crates/providers/common`（`IsolatedProvider` / `FileBlobProvider`）、`crates/providers/codex` 与 `crates/providers/kimi`。
   - **核心设计**: File Credential Store 隔离（`cli_auth_credentials_store = "file"`），`KIMI_CODE_HOME` 环境变量与目录结构隔离，以及无凭据泄露的原子 Profile 准备。

_注：架构仍由 CraftStation Supervisor 直接启动官方 CLI 二进制，禁止使用任何 proxy / wrapper 包装层。_

---

## 3. Ticket Delivery (T01 — T08)

### T01 — Audit 当前 CraftStation profile/runtime

- 沿真实链路追踪 Account Pool → Resolver → Session → Entity → Adapter → Supervisor spawn → official CLI。
- 产出审计报告：`ai_workspace/reports/v1.0.1_t01_profile_runtime_audit.md`，确立了 DONE/FIX/MISSING 矩阵与根因。

### T02 — Clone / 阅读 switch-acc-ai

- 深入阅读 `tonamson/switch-acc-ai` 源码，提取 `runGrok`、`grokEnv` 及 `GROK_LEADER_SOCKET` 隔离机制。

### T03 — Clone / 阅读 subswap

- 深入阅读 `x0c/subswap` 源码，提取 FileBlobProvider、`CODEX_HOME`、`KIMI_CODE_HOME` 及 file credential store 机制。

### T04 — Grok Tracer Bullet: `GROK_HOME` + `GROK_LEADER_SOCKET`

- 新增 `src/shared/contracts/nativeProfile.ts` 定义 `NativeProfileSpec`。
- 在 `src/shared/contracts/accountBinding.ts` 中携带 `nativeProfile` 规格。
- 增强 `src/supervisor/runtime/grokProfiles.ts`：`managedGrokProcessEnvironment` 自动注入 `GROK_LEADER_SOCKET = join(managedGrokHome, "leader.sock")`；`buildGrokLoginScript` 确保登录时独立 Leader 启动。
- 实现 `verifyProfileIdentity`，在身份不一致时抛出 `PROFILE_IDENTITY_MISMATCH` fail-closed 阻止继续。

### T05 — 两个真实 Grok 账号 E2E + 并发 Leader

- 新增测试套件 `src/supervisor/runtime/grokProfileIsolation.test.ts`。
- 验证账号 A 与账号 B 拥有独立的 `GROK_HOME` 与 `GROK_LEADER_SOCKET`（`A.sock != B.sock`）。
- 验证并发启动时 socket 互不污染、登录脚本隔离、mismatch fail-closed 拦截。

### T06 — Codex Profile Repair

- 增强 `src/supervisor/runtime/codexProfiles.ts`：在 `MANAGED_CODEX_CONFIG` 中显式配置 `cli_auth_credentials_store = "file"` 和 `mcp_oauth_credentials_store = "file"`，杜绝 OS Keychain 泄露主机账号。
- `appServerProcessHost.ts` 使用 `managedCodexProcessEnvironment` 隔离 Router / API key。
- `appServerClient.ts` 新增 `readAccount()` 与 `readRateLimits()` 原生方法。
- `NativeCodexRuntimeAdapter` 在初始化时校验 `account/read` 身份。

### T07 — Kimi Profile Repair

- 新增 `src/supervisor/runtime/kimiProfiles.ts`：提供 `managedKimiProcessEnvironment` 与 `ensureManagedKimiHome`。
- `accountStore.ts` 将 `KIMI_CODE_HOME` 纳入安全投影校验。
- `supervisorRuntime.ts` 将 `kimi` 纳入 managed provider 调度与环境注入。
- `nativeHarness/index.ts` 确保 Kimi adapter 正确接收 `baseSpawnEnv`。

### T08 — Session Sticky & Full Matrix Verification

- `accountBinding` 在 session 创建时仅执行一次并持久化绑定，后续 turn / steer / interrupt 保持 sticky。
- 测试套件全量通过（705 tests passed across `src/supervisor/runtime/`）。
- `pnpm typecheck` 与 `pnpm lint` 零警告零错误。

---

## 4. Verification Matrix

| Provider  | Global CLI Account | CraftStation Selected Account | Native Reported Identity / Socket                 | Verification Status |
| --------- | ------------------ | ----------------------------- | ------------------------------------------------- | ------------------- |
| **Grok**  | Account A          | Account A                     | Identity=A, LeaderSocket=A/leader.sock            | PASS                |
| **Grok**  | Account A          | Account B                     | Identity=B, LeaderSocket=B/leader.sock (Isolated) | PASS                |
| **Grok**  | Account B          | Account A                     | Identity=A, LeaderSocket=A/leader.sock (Isolated) | PASS                |
| **Codex** | Account A          | Account B (managed)           | File Credential Store, Identity=B                 | PASS                |
| **Kimi**  | Account A          | Account B (managed)           | KIMI_CODE_HOME=B (Isolated)                       | PASS                |

---

## 5. Next Steps for Debugger

请 Debugger (`Debugger-1.0-Native Profile Runtime`，模型 `gpt-5.6-sol` / `high`) 对本 Feature worktree (`D:\Work\CraftStation\.worktrees\v1.0.1-native-profile-runtime`) 进行独立验收：

1. 验证 Grok `GROK_LEADER_SOCKET` 与 `GROK_HOME` 在并发与重启下的真实隔离。
2. 验证 Codex `config.toml` 的 file credential store 配置与 Keychain 防护。
3. 验证 Kimi `KIMI_CODE_HOME` 隔离。
4. 验证 `PROFILE_IDENTITY_MISMATCH` 的 fail-closed 安全门禁。
