# Coder — v0.8.7 Fix Cycle

> Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`
>
> 日期：2026-08-30
>
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`
>
> 分支：`feature/v0.8-opencode-native`
>
> 基线 / HEAD：`7ae6506ea01fc04029a10a711ebb0a65d7248e06`

## 1. Fixed

### F40 — private runtime 与凭据载体

- `AccountStore.projectCredential()` 和 `readCredentialEnvironment()` 双层拒绝 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_CACHE_HOME`、`OPENCODE_CONFIG_DIR`。
- `OpenCodeNativeTransport` 先合并当前 binding projection，最后权威设置 private root 派生变量，account projection 无法覆盖。
- 增加 auth-only binding：受管 `auth.json` 只安装到当前账户 private `data/opencode/auth.json`；resolver 不返回原始 credential。
- 保持 allowlist-first host environment、当前 binding env 可见、无关 Provider/account marker 不可见和 server pool reuse/isolation/restart。

### F42 — question response 统一验证

- raw `string[][]` 与 `{ answers: ... }` 先统一 normalize，再执行同一 validator。
- 保留并执行 `multiSelect/multiple`、`custom` 和 option ID allowlist。
- 强制 question count/identity、至少一个非空字符串、single-select 至多一个答案；非法值不再被静默过滤。

### F44 — escaped secret 与真实错误诊断

- escaped JSON quotes 先规范化，再通过 callback replacement 脱敏。
- 覆盖 `apiKey/accessToken/refreshToken`、Authorization Basic/Bearer、query、nested auth/oauth/credential。
- SDK v2 `session.error.error.data.message` 通过 `safeMessage` 安全投影；不暴露 response body、headers 或 metadata。

### Provider catalog 与真实凭据路径

- 官方 OpenCode 1.18.25 catalog 证明 `deepseek/deepseek-chat` 不存在，改为 `deepseek/deepseek-v4-flash`。
- 官方 catalog 证明 Kimi native route 是 `kimi-for-coding/kimi-for-coding`，不是本安装中不存在的 `moonshotai/kimi-k2.5`。
- 新增默认跳过、显式启用的真实 Provider smoke；普通回归不会自动消耗凭据。

## 2. Real Provider Evidence

- DeepSeek：受管环境投影到达真实 Provider，但 Dev 中现有 key 被明确拒绝为 invalid，保持 `unverified`。
- OpenAI：受管 auth-only binding 到达真实 OAuth refresh，但 Dev 中记录返回 HTTP 403，保持 `unverified`。
- Kimi native：受管 auth-only binding 成功，连续两轮返回精确 marker，状态均 `completed -> idle`，随后 Session `terminated`，无残留 OpenCode 进程。

## 3. Validation

- Focused：`10 files / 100 tests PASS`。
- 用户定向：`15 files / 107 tests PASS`，另有 1 个 explicit live 文件默认 skip。
- Broader：`19 files / 223 tests PASS`，另有 1 个 explicit live 文件默认 skip。
- 官方 carrier：`2 files / 8 tests PASS`。
- 真实 Provider：`1 file / 1 test PASS`，包含两轮 Kimi assistant response。
- TypeScript PASS；Feature 45 files oxlint/oxfmt PASS；diff/package-lock hygiene PASS；残留进程 0。

完整证据：`ai_workspace/validation/v0.8.7-debugger-evidence-2026-08-30.txt`。

## 4. Boundary

Compatibility artifact 当前为：

```text
records=6
available=1
unverified=5
providerAssistantResponse verified=1 / unverified=5
successfulFollowUpTurn verified=1
```

仅 Kimi native route 获得 Provider assistant response 与后续 turn 证据；不得写 6-Route Provider E2E PASS。未执行 commit、push、tag 或 merge。
