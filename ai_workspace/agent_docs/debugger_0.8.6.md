# Debugger — v0.8.6 独立复检

> Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`
>
> 日期：2026-08-30
>
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`
>
> 分支：`feature/v0.8-opencode-native`
>
> 基线 / HEAD：`7ae6506ea01fc04029a10a711ebb0a65d7248e06`
>
> Verdict：**FAIL / ENGINEERING FIX REQUIRED**

## 1. Review Scope

本轮对 Coder v0.8.6 Fix Cycle 做独立 Re-review，没有复用 Coder 结论作为质量门结论。复检覆盖 F38 readiness executable gate、F40 child environment/private runtime root/pool lifecycle、F42 production IPC 与 SDK v2 request 闭环、F44 secret redaction 与 diagnostics，以及官方 carrier、compatibility boundary、定向回归和静态检查证据。

CodeGraph 检查显示当前索引属于 Product Git Root，而不是本 Feature worktree；本轮因此以当前 worktree 源码、测试和独立 reverse probes 为事实源。

## 2. Git 与执行边界

- 当前分支：`feature/v0.8-opencode-native`。
- 当前 HEAD 仍为基线 `7ae6506ea01fc04029a10a711ebb0a65d7248e06`。
- `git diff --check`：PASS。
- `package.json` / `pnpm-lock.yaml` 相对 HEAD 无差异。
- 未执行 commit、push、tag、Feature→Dev merge、Dev→Main merge 或 promotion。

## 3. Evidence

### 3.1 官方 carrier 与 Provider 边界

- `where.exe opencode`：PATH 可发现官方 CLI。
- `opencode.exe --version`：`1.18.25`。
- `opencode.exe serve --port 0 --hostname 127.0.0.1 --print-logs`：成功无头拉起并宣布 `opencode server listening on http://127.0.0.1:4096`。
- 探针和 smoke 后无残留 OpenCode process。
- 真实 carrier smoke：`2 files / 8 tests PASS`。

该 smoke 只证明官方 Server HTTP/OpenAPI、SSE、Session create/get/messages/error/delete lifecycle 及六路无凭据错误收口，不证明 Provider assistant response、成功后续 turn、tool、usage 或 compaction。

独立解析 compatibility artifact：

```text
probe.status=verified
probe.version=1.18.25
records=6
available=0
unverified=6
providerAssistantResponse=unverified: 6
```

六路 Provider assistant response 必须继续保持 `unverified`；不得把 carrier、catalog 或 contract test 升格为 Provider E2E PASS。

### 3.2 回归与静态检查

| Gate                              | 独立结果                    |
| --------------------------------- | --------------------------- |
| Focused F38/F40/F42/F44           | `8 files / 56 tests PASS`   |
| 用户定向 suite                    | `15 files / 104 tests PASS` |
| Broader Crafting/Native/IPC       | `18 files / 193 tests PASS` |
| 真实 carrier smoke                | `2 files / 8 tests PASS`    |
| TypeScript                        | PASS                        |
| Feature 41 files oxlint/oxfmt     | PASS                        |
| diff check / package-lock hygiene | PASS                        |

全仓 oxlint/oxfmt 仍存在已记录的既有、非 v0.8 阻断；不能把 Feature 文件静态检查写成全仓静态检查 PASS。

## 4. Independent Reverse Probes

临时反向测试结果为 `1 file / 6 tests / 4 failed, 2 passed`；临时测试文件已删除。

### F40-R1 — private runtime root 可被 account projection 覆盖

`src/supervisor/runtime/openCodeNative/transport.ts:129-161` 先设置 private-root 变量，随后又以 `...(projectedEnvironment ?? {})` 收尾。独立 probe 令 runtime root 为 `C:\managed\account-root`、projected `HOME=C:\host-home`，实际 child `HOME` 为 `C:\host-home`。

可被覆盖的保留变量包括：

- `HOME`
- `USERPROFILE`
- `APPDATA`
- `LOCALAPPDATA`
- `XDG_CONFIG_HOME`
- `XDG_DATA_HOME`
- `XDG_CACHE_HOME`
- `OPENCODE_CONFIG_DIR`

**Impact**：account resolver 可把 child 的 home/config/data/cache 指回非当前 binding 的路径，破坏 private runtime root 与 credential-scope process isolation。

### F42-R1 — raw-array 绕过 `custom=false` option allowlist

`src/supervisor/runtime/craftedRequestResolution.ts:78-94` 对 raw array 直接 `return`，未进入 safe question metadata 与 option/custom 校验。输入 `custom=false`、options=`q0.0/A,q0.1/B`、response=`[["not-an-option"]]` 时，当前实现仍接受并送入 `question.reply`。

**Impact**：合法 Renderer payload shape 可绕过 question 的安全 allowlist。

### F42-R2 — single-select 接受多个答案

`SafeQuestion` 只保存 `id/custom/options`，未保存 `multiple`/`multiSelect`。输入 `multiple=false`、response answers=`["q0.0","q0.1"]` 时，当前实现接受两个答案。

**Impact**：生产 IPC 到官方 question API 的 cardinality contract 未被执行。

### F44-R1 — escaped JSON message 泄漏 secret

`src/supervisor/runtime/openCodeNative/diagnostics.ts:6-29` 的 JSON redaction 只匹配未转义引号。输入：

```text
payload={\"apiKey\":\"escaped-json-secret\"}
```

当前 `safeMessage()` 输出仍包含 `escaped-json-secret`。普通 Authorization Bearer/Basic、query、未转义 JSON、nested details、phase/code/correlation 的现有回归通过，但 JSON-stringified/escaped carrier 仍未关闭。

## 5. Dual-axis Verdict

### Standards axis

- **F40 / P1**：allowlist-first host env 已实现，但 reserved private-root env 没有最终权威性，安全边界仍可被 account projection 覆盖。
- **F42 / P1**：raw-array 与 answers-map 没有统一进入 semantic validator，且安全投影丢失 single/multiple cardinality。
- **F44 / P2**：redaction grammar 未覆盖 escaped JSON carrier，仍存在 diagnostic secret leak。
- Shared Crafter / Supervisor 中的 provider-specific 分支仍是后续架构 smell，但不是本轮首要阻断。

### Spec axis

- **F38：当前 Acceptance 通过**。compile 与 spawn/create/resume 双层 executable readiness fail-closed、六路 unavailable/unverified 反向 fixtures 与 ready fixture 均成立。
- **F40：局部通过，未关闭**。host marker isolation、当前 account/server env、pool reuse/isolation/restart、child-exit eviction、opaque ref fail-closed 基本通过；private-root override 仍阻断。
- **F42：局部通过，未关闭**。production IPC crafted/legacy 分流、permission allow/deny、question answer/reject、unknown/expired fail-closed、SDK v2 asked/replied/rejected canonical mapping 基本通过；question option/cardinality bypass 仍阻断。
- **F44：局部通过，未关闭**。统一 builder、operation→phase、code/correlation 与普通 redaction 通过；escaped JSON secret leak 仍阻断。
- **Provider E2E：unverified**。无凭据时不得写 PASS。

## 6. Fix Plan — v0.8.7

1. **F40 reserved environment authoritative**
   - 定义 private-root reserved key 集合。
   - AccountStore projection 边界拒绝或过滤 reserved keys；transport 最终 child env 组装再做一层防护。
   - private-root assignments 必须位于所有可变 projection 之后，不允许 command/account env 覆盖。
2. **F42 统一 question response normalization/validation**
   - raw array 与 `{ answers: ... }` map 先 normalize 为同一中间结构，不得有 bypass return。
   - 安全 metadata 保留 canonical `multiSelect` / `multiple`。
   - 强制问题数量/identity 匹配、每题至少一个非空字符串答案、single-select 最多一个答案。
   - `custom=false` 时每个 option ID 必须在 allowlist；`custom=true` 才接受非空自定义字符串。
   - 非字符串或空值必须 reject，不能静默过滤后继续。
3. **F44 escaped JSON redaction**
   - 覆盖 escaped `apiKey/accessToken/refreshToken` 及 escaped nested `auth/oauth/credential` carriers。
   - 继续使用 callback replacement，增加“原 secret 不存在且无 `$1` 污染”断言。
4. 保持 F38 readiness、F40 pool restart、F42 IPC/SDK v2 mapping、F44 phase/code/correlation 的现有回归。
5. 重跑 focused、用户定向、broader、真实 carrier smoke、tsc、Feature lint/format、diff/package-lock hygiene，并确认无残留 OpenCode process。
6. 无 Provider 凭据时 compatibility 继续 `available=0 / unverified=6 / providerAssistantResponse=unverified=6`。

## 7. Fix Acceptance Criteria

### F40

- 上述 8 个 reserved keys 的覆盖 probe 全部 fail closed，或 child 最终值始终指向当前 private runtime root 派生路径。
- 当前 binding credential env 仍可见；无关宿主/provider/account marker 仍不可见。
- pool reuse/isolation/eviction/restart 继续 PASS。

### F42

- raw-array 与 answers-map 对同一 metadata 得到相同 accept/reject 结果。
- `custom=false + unknown option` 两种 shape 均 reject。
- single-select 多值 reject；multi-select 多个 allowlisted 值 accept。
- custom question 仅接受非空字符串；缺题、多题数量不匹配、空值和非字符串 reject。
- permission/question、crafted/legacy、unknown/expired 和 SDK v2 resolved 闭环继续 PASS。

### F44

- 普通及 escaped JSON `apiKey/accessToken/refreshToken`、Authorization Bearer/Basic、query、nested auth/oauth/credential 的输出均不含原 secret。
- diagnostic phase/code/operation/correlation 保持规范；输出不含 `$1` 污染。

## 8. Execution Order

1. F40 reserved environment boundary。
2. F42 metadata、normalization、统一 validator 与负向矩阵。
3. F44 escaped carrier redaction。
4. focused → targeted/broader → carrier/static/Git hygiene。
5. 更新 Coder evidence，并通知同一配对 Debugger复检。

## 9. Workflow Decision

- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- Review Status: **FAIL**
- Current Fix Cycle: **v0.8.7**
- Fix Owner: **Coder**
- Feature→Dev merge: **NOT EXECUTED**
- Main promotion: **NOT AUTHORIZED**

## 10. Verdict

```text
FAIL / ENGINEERING FIX REQUIRED
```

四个可复现负向缺口不能被绿测或真实 carrier smoke 覆盖。F38 已满足当前 Acceptance；F40/F42/F44 进入 v0.8.7 Coder Fix Cycle。六路 Provider assistant response 继续 `unverified`。
