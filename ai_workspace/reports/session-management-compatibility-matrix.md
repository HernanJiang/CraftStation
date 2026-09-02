# CraftStation 会话目录管理兼容性矩阵与落地方案

> 状态：设计基线（v0.10 合并后）
> 目标：CraftStation 创建的线程拥有可复现、可诊断的运行目录，同时不破坏各 CLI 自己的会话格式、升级机制和用户在原生 CLI 中已有的会话。

## 结论

CraftStation 应当管理自己的会话与运行状态，但**不应把所有 CLI 的原生会话数据库强行搬到同一个目录**。推荐双层模型：

1. `~/.craftstation/` 是 CraftStation 的权威层：线程、Runtime Segment、跨线程 exchange、绑定的项目/账号、事件索引和恢复元数据都写入 CraftStation 数据根。
2. 各 CLI 保留 provider-owned 的会话目录；CraftStation 只在启动时注入经过验证的隔离根目录/环境变量，并记录 provider session ref。已有原生目录不迁移、不覆盖；必要时仅做只读引用。
3. 对没有真实项目绑定的 Home 线程，CraftStation 使用 `~/.craftstation/workspace-home/<threadId>` 作为稳定的 per-thread cwd，不再把用户主目录作为 CLI 的 cwd。真实项目线程仍使用项目目录。

这样既满足 CraftStation 的跨 Harness 连续线程语义，又不假设不同 CLI 的内部数据库可以互相兼容。

## CLI 兼容性矩阵

| CLI / Provider | 原生会话/凭据隔离机制 | CraftStation 可控入口 | 隔离级别 | 处理策略 |
|---|---|---|---|---|
| Codex | `CODEX_HOME`；官方 app-server 的 thread/session 数据位于该根 | 启动 env、app-server pool key、`thread/start.cwd` | **可完全隔离** | 有 CraftStation 号池账号时注入账号专属 `CODEX_HOME`；不同账号不共享 app-server；无号池时才允许 ambient 降级 |
| Grok | `GROK_HOME`；profile 的 `auth.json` 与会话状态在该根 | 启动 env；ACP/PTY base spawn env | **可完全隔离** | 号池账号优先注入 pinned `GROK_HOME`；池存在但不可用时失败，不回退 ambient |
| OpenCode | XDG `HOME/USERPROFILE/APPDATA/LOCALAPPDATA`、`XDG_*`、`OPENCODE_CONFIG_DIR`；官方 server API 的 directory 也参与配置作用域 | Supervisor-owned private runtime root、SDK `directory`、server pool isolation key | **可完全隔离** | 账号绑定时使用 account runtime root；anonymous route 使用临时空根；不读取用户 host auth 作为隐式账号 |
| Claude Code | `CLAUDE_CONFIG_DIR` 可隔离 profile/config；CLI 仍拥有自己的会话格式 | Agent instance 配置与 spawn env | **可完全隔离（配置层）** | 每个 CraftStation instance 注入自己的 `CLAUDE_CONFIG_DIR`；不解析/改写 Claude 会话数据库 |
| Antigravity / `agy` | 登录凭据在 OS keyring / language-server 运行时；没有已验证的 per-profile home 变量 | 启动参数和 loopback LS；目前没有可靠的账号根重定向 seam | **不支持完全隔离** | 不伪造池账号已被 `agy` 使用；保留 pool 的 per-account quota；会话启动前明确显示 ambient agy 账号限制，后续需 vendor 支持或受控登录切换 |
| Kimi Code | ACP/CLI 自有 session storage；版本间目录/变量需由官方确认 | `kimi acp` 启动和 ACP `cwd` | **部分隔离** | 先隔离 cwd 与 CraftStation 元数据；不搬迁原生 session store；额度/登录由用户当前环境负责 |
| Gemini CLI | CLI 自有 config/session 目录；不同发行版的环境变量并不稳定 | 启动参数、ACP cwd、可检测的 config 变量 | **部分隔离** | 只注入已验证变量；未知版本继续使用原生目录并记录降级原因 |
| Qwen Code | CLI/ACP 自有配置与 token storage；公开稳定的全会话隔离变量尚未验证 | ACP cwd、provider config、显式 token plan env | **部分隔离** | CraftStation 管理线程和 provider config；不复制未知的原生 session DB |
| GitHub Copilot / Cursor / z.ai / OpenAI-compatible | 主要由各自 CLI 或 API key/config 管理；session DB 约定不统一 | 显式 provider config、API key/profile 根（若有） | **部分隔离或不适用** | API 凭据走 CraftStation 号池；原生 CLI 会话不迁移；没有稳定隔离变量时使用原生目录并明示 |

“可完全隔离”只表示 CraftStation 有可靠、可测试的官方/公开环境入口，不表示 CraftStation 复制了 CLI 的内部会话协议。

## 目录布局

```text
~/.craftstation/
├── state.sqlite                         # CraftStation 权威线程/Runtime/协作状态
├── settings.json
├── attachments/
├── logs/
├── worktrees/                            # CraftStation 创建的项目 worktree
├── workspace-home/<threadId>/             # 无项目 Home 线程的稳定 cwd
├── runtime/<provider>/<scope>/            # provider-owned runtime projection（若支持）
└── accounts/<provider>/<accountId>/       # 账号池凭据投影，由 Supervisor 管理

# Provider 原生目录保留在各自默认位置，除非该 CLI 有显式隔离入口：
~/.codex/                                  # 只读 ambient fallback，不由 CraftStation 覆盖
~/.config/opencode/ / ~/.local/share/opencode/
~/.claude/
...
```

实际实现必须通过单一环境注入 seam 生成 spawn env，禁止 UI、Crafting domain 或任意 provider adapter 各自拼接 `HOME`/`CODEX_HOME`/`XDG_*`。

## 运行规则

### 1. 会话权威性

- CraftStation Thread ID、Runtime Segment ID、CraftPlan、AccountBinding、provider session ref 和跨线程 exchange 由 CraftStation 持久化。
- CLI 原生 session ID 作为 `SessionRef`/runtime segment metadata 保存，不作为 CraftStation Thread 主键。
- 重启时先从 CraftStation 恢复，再用 provider session ref 做 resume；resume 失败必须显式创建新 provider segment，不能静默丢历史。

### 2. 账号授权优先级

```text
有可用 CraftStation 号池账号
  -> 解析 accountResolver
  -> 注入 provider 专属隔离 env
  -> 记录 accountId/reason（不记录 secret）

没有配置/没有 credentialed 号池
  -> 允许 ambient CLI 登录作为明确降级

号池存在但全部不可用
  -> ACCOUNT_POOL_EXHAUSTED / provider-specific error
  -> 禁止静默切换到 ambient
```

Antigravity 是当前例外：`agy` 的 OS keyring 没有可验证的 profile root，因此不能把“绑定记录”误报成“运行时已经切换账号”。

### 3. 环境注入单一模块

建议继续扩展 Supervisor 侧的 `privateRuntimeEnvironment`/runtime binding seam，形成一个 provider-neutral 接口：

```ts
resolveProviderRuntimeEnvironment({
  provider,
  accountBinding,
  projectLocation,
  threadId,
}): {
  env: Record<string, string>;
  isolation: "managed" | "ambient" | "unsupported";
  reason: string;
}
```

约束：

- `env` 只包含 scope、home、config、XDG 等非 secret 路径和值；secret 仍由 Supervisor 投影，永不回传 renderer。
- 每个 adapter 只消费这个结果，不直接读取 `process.env` 决定账号。
- `isolation` 与 `reason` 进入结构化日志/诊断；不记录 token、cookie、完整 prompt。
- 对 WSL 同时返回 Linux 侧 cwd/env 与 host 侧 spawn 规则，不能把 Linux 路径作为 Windows `spawn.cwd`。

## 迁移边界

- 不迁移用户在各 CLI 原生目录中的既有会话，不覆盖其数据库或 auth 文件。
- CraftStation 只为新建/由 CraftStation 恢复的线程创建自己的 metadata/projection；原生 CLI 目录最多只读探测。
- provider 升级后，如果隔离变量失效，启动应变为可诊断的 `isolation=unsupported`，而不是悄悄使用另一账号。
- 真实 provider E2E 必须分别验证：池账号选择、环境投影、provider session resume、无池 ambient 降级、池耗尽失败。单测/mock 不能证明真实登录成功。

## 当前实现状态与下一步

已落地：

- `resolveThreadWorkspace()`：Home 线程使用 per-thread `~/.craftstation/workspace-home/<threadId>`。
- Codex structured session 的 app-server thread cwd、thread/fork cwd、按账号 app-server pool key。
- Grok/Codex chat structured session 的 pool-first env 注入与无池 ambient 降级。
- OpenCode native runtime 的 Supervisor-owned account root/anonymous temporary root。
- CraftStation 线程、v0.9 Runtime Segment、v0.10 collaboration ledger 的权威持久化。

尚需独立 Feature 验收：

- Antigravity per-account `agy` 运行时授权切换（当前不具备公开、可靠的隔离入口）。
- 统一 provider-neutral 环境注入模块及每个 CLI 的版本化兼容探测。
- Codex/Grok/OpenCode 真实账号 E2E；当前仓库证据仍以 seam 单测和用户真实手测为界。
