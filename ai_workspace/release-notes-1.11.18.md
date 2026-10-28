# CraftStation 1.11.18

## 用户可见

- 修复 Claude 会话继承其他 Harness 的 `272k` 上下文设置后，发送 `claude-opus-5-5[272k]` 并提示模型不存在或无访问权限的问题。
- Opus 5.5 等 Claude 模型遇到该遗留值时改用普通模型 ID；只有明确选择 `1m` 时才发送 `[1m]` 后缀。启动、后续回合和重开续接均可正常工作。

## 实现

- `applyClaudeContextSuffix` 不再把任意 `contextSize` 拼到 Claude 模型 ID 后，只接受 Claude 可识别的 `1m` 后缀；其他值回退到普通模型 ID。
- 自定义/第三方提供商模型 ID 保持原样，避免破坏其真实名称中自带的上下文后缀。
- 新增 `claude-opus-5-5` 与遗留 `272k` 的回归测试。

## 验证

- 回归在修复前失败、修复后通过；Claude 相关 89 项测试及 `pnpm typecheck`、`pnpm lint` 通过。
- 同一 Claude Code 2.1.306 环境实测：普通 `claude-opus-5-5` 与 `claude-opus-5-5[1m]` 成功，`claude-opus-5-5[272k]` 复现用户所见错误。
- 隔离真实 CraftStation 会话中，明确把当前线程设为 `claude-opus-5-5` + `272k` 后，后续回合返回 `CRAFTSTATION_CLAUDE_272K_FOLLOWUP_OK`，没有再出现模型错误。
- 真实后续消息、停止、替换指令、AskUserQuestion、模型切换和重开续接通过；只读 `pwd` 在当前权限配置下直接执行，没有出现可拒绝的审批弹窗。real-mode changed smoke 通过，控制台/运行时错误 0。
- 截图 `C:/Users/Haona/.craftstation-smoke/debug-1793180155236-2128/claude-272k-followup.png`，报告 `C:/Users/Haona/.craftstation-smoke/debug-1793180155236-2128/artifacts/smoke-report.json`。
- 本补丁仅发布 Windows x64 安装包与便携版。

---

# CraftStation 1.11.18

## User-facing

- Fixed Claude sessions inheriting another Harness's `272k` context setting and sending `claude-opus-5-5[272k]`, which Claude rejected as a missing or inaccessible model.
- Opus 5.5 and other Claude models now fall back to their regular model IDs for this legacy value. The `[1m]` suffix is sent only when `1m` is explicitly selected. Launch, follow-up turns, and reopen/resume all work.

## Implementation

- `applyClaudeContextSuffix` no longer appends an arbitrary `contextSize` to Claude model IDs. It emits only the supported `1m` suffix and otherwise uses the regular model ID.
- Custom and third-party provider model IDs remain unchanged so real suffixes in those names are preserved.
- Add a regression covering `claude-opus-5-5` with a legacy `272k` value.

## Verification

- The regression failed before the fix and passes after it. All 89 related Claude tests, `pnpm typecheck`, and `pnpm lint` passed.
- With the same Claude Code 2.1.306 installation, regular `claude-opus-5-5` and `claude-opus-5-5[1m]` succeeded, while `claude-opus-5-5[272k]` reproduced the exact user-facing error.
- In an isolated real CraftStation session explicitly configured as `claude-opus-5-5` + `272k`, the follow-up turn returned `CRAFTSTATION_CLAUDE_272K_FOLLOWUP_OK` without the model error.
- Real follow-up, Stop, replacement instruction, AskUserQuestion, model change, and reopen/resume checks passed. A read-only `pwd` ran directly under the active permission configuration, so no approval dock was available to reject. Real-mode changed smoke passed with zero console/runtime errors.
- Screenshot: `C:/Users/Haona/.craftstation-smoke/debug-1793180155236-2128/claude-272k-followup.png`. Report: `C:/Users/Haona/.craftstation-smoke/debug-1793180155236-2128/artifacts/smoke-report.json`.
- This patch ships Windows x64 installer and portable packages.
