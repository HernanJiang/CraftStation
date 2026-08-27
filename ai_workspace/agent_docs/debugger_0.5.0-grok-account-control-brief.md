# Debugger Implementation Brief — Grok Account Control Plane

> 日期：2026-08-27
> 角色：Debugger
> 授权：用户要求对照 Cockpit Tools / Token Monitor 源码，抽取可落地原则交给 Coder 实现
> 当前 Feature：`v0.4.0` 仍 FAIL（先完成 [debugger_0.4.6-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.6-native-harness.md) 的 F08）
> 本 Brief 是用户授权的下一工程包：**Grok 官方账号 → managed GROK_HOME → Native Harness → Session sticky**
> Requires Manager Re-plan（完整 v0.5 Tickets）：Yes（可先做 Grok tracer bullet，不要一次做 32 工具 Tokscale）
> Requires Ideate Revision：No（用户已给出账号控制面 vs 用量平面的边界）

## 参考仓库（只读，禁止复制源码）

| 项目 | 本地只读克隆 | 上游 | 许可 | 用法 |
|---|---|---|---|---|
| Cockpit Tools | `ai_workspace/temp/ref-cockpit-tools` | `jlcodes99/cockpit-tools` | **根目录无 LICENSE** | 只参考 architecture / behavior / file layout / state machine。**禁止复制 Rust/TS 源码**，尤其 `grok_account.rs` |
| Token Monitor | `ai_workspace/temp/ref-token-monitor` | `Javis603/token-monitor` | 有 LICENSE | 参考 identity、atomic auth projection、Tokscale adapter 边界。v0.5 先不接 32+ parser，也不做多设备同步 |
| Tokscale | 未作为本轮必接 runtime | Token Monitor 的 vendored dependency | 后续 Usage Plane | 本轮不要 `exec("tokscale")` 进生产 |

两类参考不得揉成一个 Usage 方案：

```text
Cockpit Tools     = 账号控制面
Token Monitor     = 用量与可观测性
CraftStation 独有 = Account + Native Harness + Entity/Session Binding + exhaustion-only fallback
```

## 明确禁止

- 复制 Cockpit / Token Monitor / CLIProxyAPI 源码进 `craftstation/`
- Codex / Grok 走 CLIProxyAPI、Router 号池、第三方 OpenAI-compatible Grok API
- 读取或导入 `Codex-Router/UserData/**/xai-*.oauth.json`
- 把 `~/.grok/auth.json` 全局覆盖当成默认切号
- 剩余 <10% 自动切号
- Renderer / IPC 暴露 access token / refresh token / raw auth
- `account.id = email` 或 `account.id = providerAccountId`
- Session 每次 `send()` 重新 `AccountResolver.resolve()`
- 直接 `fs.writeFile(auth.json)` 覆盖
- 引入用户可见的 `ManagedInstance` 概念（用 Entity/Session）

## 现有代码缺口（独立核对）

已有、可复用：

- `AccountStore`：metadata 列表、select/reorder/enable、`toView()` 去掉 `credentialRoot`、`writeFileAtomic`、`.bak`、`projection.lock`、CODEX_HOME 必须落在 managed root
- `AccountResolver`：explicit / selected / auto；`quota-low` 仍可用；explicit exhausted 不 fallback；auto 仅 `quota-exhausted|auth-expired|unavailable`
- Native Codex adapter 已有 sticky 注释：spawn 后 binding 留在 entity/session

缺口（本轮要补的 Grok 黄金路径）：

- `CLI_LOGIN_COMMANDS` 没有 grok → 卡片打开 grok.com（F08，必须先修）
- `projectCredential()` 只认识 `CODEX_HOME`，不投影 `GROK_HOME`
- `grokCredentials.ts` / Grok adapter 读的是 **进程级** `process.env.GROK_HOME` 或 `~/.grok`，不是 per-account managed home
- 没有 per-account refresh lock（只有 projection file lock）
- 没有 Session.runtimeAccountId 一旦 bind 就固定的强制测试
- Account index 仍是单文件 `accounts` 数组，没有 Cockpit 那种 index + per-account details 隔离（Grok 可先做 `accounts/grok/<id>/`）
- authStatus / quotaStatus / runtimeStatus 未分开

## 目标架构（CraftStation 自己的 5 层）

```text
AccountService
├── AccountStore          列表 / selected / order / enabled / metadata
├── CredentialProvider    读 / 刷新 / 存 / per-account refresh lock
├── ProfileProjection     Account → GROK_HOME（官方 CLI 能启动的环境）
├── AccountResolver       explicit > selected > ordered fallback（已有，保持笨）
└── RuntimeBinding        Session 创建时 bind 一次，之后不再 resolve
```

Renderer 只消费 `ManagedAccountView`：

```text
id, email, displayName, plan, status, quota, selected, enabled
```

Secret 只留在 supervisor/native：

```text
access token, refresh token, raw auth material, provider-specific secret
```

状态必须三分，再推导展示状态：

```text
authStatus ≠ quotaStatus ≠ runtimeStatus
登录有效 + quota HTTP 500  ≠ auth-expired
```

## Grok 黄金路径（本轮必须做出的产品行为）

```text
Grok Account A → CraftStation managed GROK_HOME/A → Official Grok Runtime A
Grok Account B → CraftStation managed GROK_HOME/B → Official Grok Runtime B

Session X → Runtime A → Account A
Session Y → Runtime B → Account B
```

启动语义：

```text
新 Session
→ AccountResolver 一次
→ RuntimeBinding.accountId 固定
→ ProfileProjection 写 managed GROK_HOME
→ spawn official grok，env.GROK_HOME=<that home>
```

不要默认：

```text
选 B → 覆盖 ~/.grok/auth.json → 启动
```

`同步为系统当前 Grok 账号` 可以不做。

验收场景（必须有测试 + 尽量真实 CLI）：

1. A/B 都有独立 managed GROK_HOME，互不覆盖
2. selected A → 新 Session = A
3. selected B → 新 Session = B
4. order=[A,B]，A exhausted → 新 Auto Session = B
5. 显式 A 且 A exhausted → error，不偷偷 B
6. **已启动 Session A，selected 改成 B，Session A 仍是 A**
7. 登录入口是 `grok login --device-auth` / `auth.x.ai`，不是 grok.com
8. 未拿到邮箱/身份前不插入账号条目

## 从 Cockpit 借鉴的原则（自己实现）

对照只读文件：`src-tauri/src/modules/grok_account.rs`、`src-tauri/src/commands/grok_instance.rs`、`src/types/grok.ts`。

1. **Secret / View 分离**：Cockpit 有完整 `GrokAccount` 与前端 `GrokAccountView`，并注明 credential 不跨 IPC。
2. **Profile isolation**：`grok_accounts/` + `grok_profiles/`；受管实例设 `GROK_HOME=<account-profile>`；默认实例才碰 `~/.grok`。CraftStation 受管 Session **一律** managed GROK_HOME。
3. **切号 ≠ 运行时绑定**：`inject_to_default` 写官方 `~/.grok/auth.json` 是 Cockpit 产品能力。CraftStation 默认走 `prepare_account_home` 那种“不写官方默认 home”的路径。
4. **Lock**：`ACCOUNT_LOCK` + `TOKEN_LOCKS[accountId]` + file lock（owner PID、活进程、stale、timeout）。CraftStation 必须 **per-account refresh lock**，禁止 provider 一把大锁。
5. **Atomic write**：temp → write → sync → rename；dir 0700 / file 0600；旧 auth backup。
6. **Index 与 details 分离**：`grok_accounts.json` + `grok_accounts/<id>.json`；index 坏了可从 details 重建，坏文件 quarantine。
7. **Quota 与 auth 分开记**。
8. **不要抄**：CLIProxyAPI Codex API service、Grok 第三方 Base URL、auto-switch on low quota、Instance 用户概念。

## 从 Token Monitor 借鉴的原则（自己实现）

对照只读文件：`src/electron/renderer/accountIdentity.js`、`src/shared/codexSystemSwitch.js`、`src/shared/tokscaleCapabilities.js`。

1. **Identity**：Codex 不能只用 email，需要 email + workspace/account id 的 canonical identity，再映射到稳定内部 id。Grok 用 user/principal，不要 email 当主键。
2. **Atomic auth projection**：尊重 `CODEX_HOME` / 对应 `*_HOME`；temp + 0600 + rename。结论：切号本质是把账号投影到官方 CLI 认识的 runtime profile。
3. **Tokscale**：有 version / capability / platform binary / updater。本轮 **不要** 把 Tokscale 接进生产路径；Usage Plane 单独立项。
4. **Token Monitor 不是 Account Authority**：谁被选、谁启动、哪个 Session 绑哪个号，由 CraftStation 负责。

## 对现有模块的改法（最小、Grok 优先）

1. **先完成 F08**（v0.4.6）：侧栏 Grok 登录 = `grok login --device-auth`，打开 `auth.x.ai`。
2. 扩展 `AccountStore.projectCredential()`：
   - 支持 `GROK_HOME` 必须等于该账号 managed root
   - 投影官方 registry 格式的 `auth.json` + 必要 `config.toml`
   - atomic + 0600 + bak
3. Grok adapter spawn 使用 **该 Session 绑定账号的 GROK_HOME**，禁止读全局 `process.env.GROK_HOME` 作为多账号运行时来源。
4. 新增 `RuntimeBinding`：Session/Entity 记录 `runtimeAccountId`；`send/interrupt/resume` 不得改绑。
5. CredentialProvider：Grok refresh-token rotation 加 per-account lock。
6. 登录成功才 `AccountStore.add`：必须有官方 identity（email 或 principal），否则不落盘。
7. 测试锁住 6 条 sticky/fallback 场景 + “secret 不进 renderer IPC”。

## 验收门禁

- 不得宣称 v0.4 Feature PASS（五 Harness 真实 response 仍缺）
- 不得宣称完整 v0.5 PASS（Tokscale / 全 Harness 账号池未做）
- 本包完成标准：Grok 双账号 managed profile + Session sticky + 登录不走 grok.com
- 不 commit/tag/push，除非用户另说

## Coder 执行顺序

1. v0.4.6 F08（Grok 登录入口）
2. 本 Brief 的 Grok Account Control Plane tracer bullet
3. 定向测试 + typecheck/lint（记录既有 supervisorRuntime exactOptional 问题）
4. 写 `coder_0.4.6-native-harness.md`（F08）以及 Grok 账号控制面变更说明
5. 通知 Debugger 复检
