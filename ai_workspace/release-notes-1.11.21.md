# CraftStation 1.11.21

## 用户可见

- Auto 只排除 free 的 DeepSeek 模型，`opencode/` 等渠道的非 free 模型恢复交给 dsh。免费模型继续使用 OpenCode。
- OpenCode Zen 的付费 DeepSeek 模型启动 dsh 时使用对应的账号密钥、模型与地址；缺少 Zen 登录时给出登录提示。

## 实现

- 移除 dsh Auto 改派的渠道白名单，使用免费模型后缀判断；绑定第三方账号的 Auto 入口采用相同规则。支持识别 `openrouter/deepseek/…`，保留目录模型 ID 与账号绑定。
- 为 Zen 付费模型写入独立 `DSH_HOME`，注册 `opencode` provider，并使用 OpenCode 目录中的 `https://opencode.ai/inference/openai/v1`。从 CLI `auth.json` 的 `opencode` 项读取密钥，与 `opencode-go` 区分；显式第三方账号仍优先使用绑定配置。

## 验证

- 修复前新增回归复现 6 项失败；修复后相关 8 个测试文件、174 项测试通过，覆盖免费/付费、dsh 未安装、第三方账号、Zen 密钥与地址、缺少登录及 ACP 严格模型绑定等分支。
- `pnpm typecheck`、`pnpm lint`、格式检查通过。隔离 Electron 的 changed-scope mock 冒烟所有场景与 gate 通过，控制台/运行时错误 0。
- 真实 Electron 中确认免费/付费分流；Zen 与 Go 付费模型均成功创建 ACP session 并绑定正确模型。外部请求随后返回 `401 api_key_expired`：本机既有 OpenCode 密钥已过期，未取得成功回复，不宣称外部模型回复验收通过。
- Windows x64 双包构建通过；包内版本与 Zen 配置、更新清单的版本/安装包路径/大小核对通过。
- 本补丁只发布 Windows x64 NSIS 安装包与便携版。

---

# CraftStation 1.11.21

## User-facing

- Auto excludes only free DeepSeek models from dsh remapping. Non-free models from channels such as `opencode/` run on dsh again; free models continue using OpenCode.
- Paid OpenCode Zen DeepSeek models launch dsh with the matching account key, model, and endpoint. A missing Zen login produces a sign-in message.

## Implementation

- Remove the catalog-channel allowlist for Auto dsh remapping and check free-model suffixes instead. Apply the same rule to Auto selections with a bound third-party account. Recognize `openrouter/deepseek/…` while preserving catalog model IDs and account bindings.
- Write an isolated `DSH_HOME` for paid Zen models, register the `opencode` provider, and use `https://opencode.ai/inference/openai/v1` from the OpenCode catalog. Read the key from the CLI's `opencode` auth entry separately from `opencode-go`; an explicit third-party account still takes precedence.

## Verification

- The new regressions reproduced six failures before the fix. After the fix, 174 tests across eight relevant files passed, covering free/paid models, missing dsh, third-party accounts, Zen key and endpoint binding, missing login, and strict ACP model binding.
- `pnpm typecheck`, `pnpm lint`, and formatting checks passed. Every changed-scope mock smoke scenario and gate passed in an isolated Electron app with zero console/runtime errors.
- A real Electron app confirmed free/paid routing. Paid Zen and Go models both created ACP sessions and bound the correct model. The subsequent external requests returned `401 api_key_expired` because the existing local OpenCode keys have expired; successful external model replies were not verified.
- Both Windows x64 packages built successfully. The packaged version and Zen configuration, plus the updater manifest version, installer path, and size, were checked.
- This patch ships Windows x64 NSIS installer and portable packages only.
