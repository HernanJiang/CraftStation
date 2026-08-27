# Debugger — v0.4.1 Feature Re-review

## Review Scope

Feature-level Re-review after Manager Plan Revalidation（2026-08-27）。

对照：

- `manager_0.4.0.md` Plan Revalidation
- `coder_0.4.1.md`
- 上一轮 `debugger_0.4.1.md`

Plan 仍有效。F02 / F03 保持关闭。本轮唯一质量门是 **F01 真实双官方 Codex profile**。

无新产品代码审查要求；不执行 Closeout。

## Evidence

- validation 目录仍无 v0.4 双 profile JSON。仅 `v0.4.0_t01_repository_audit.md`。
- 用户已声明只有 **1 个 Codex**；两个 Grok / 两个 Antigravity **不能**替代官方 Codex profile。
- 未获得第二套 ChatGPT/Codex 登录凭据，不能安全执行真实 login/quota/sticky/fallback。
- 不使用 synthetic PASS。

## Review

### Spec Fidelity

Manager 复核确认原 Plan 有效、不需要 Re-plan。质量门未变：必须有两个官方 Codex profile 的非 synthetic 证据。

### F02 / F03

保持关闭（工程修复已在 v0.4.1 验收）。

### F01

仍 **BLOCKED（凭据）**：

缺少：

1. 两个官方 Codex login/import
2. per-account quota
3. sticky Session
4. explicit failure / no-fallback
5. 新 Session 在 quota-exhausted 时的 auto fallback

## Findings

### F01 — 真实双 Codex profile 证据仍缺（凭据门）

- Evidence：无 validation JSON；用户仅 1 个 Codex。
- Impact：Feature 不能 PASS。
- Fix：用户提供第二套官方 Codex 登录后，按 User Smoke 跑完并保存证据。
- Acceptance：两套 profile 的 accountId、binding、threadId、response 或稳定错误码；explicit 失败不 fallback。

不新开工程 Fix Cycle。不需要 Manager Re-plan。

## Verdict

`Feature v0.4.0: NOT PASS / BLOCKED`

- v0.4.1 工程 Fix Cycle：仍为 ACCEPT
- Requires Manager Re-plan：`No`
- Closeout：否

## User Smoke（F01 仍缺第二套 Codex 时不要当完成品）

有两个官方 Codex 时：

1. 启动 CraftStation，打开本地项目。
2. 模型与用量 → ChatGPT/Codex → **新增账号 / New Codex**，完成官方 login（账号 A）。
3. 再 New Codex 登录第二套官方账号（账号 B）。
4. 选 A Craft 一次；新 Session 选 B Craft 一次；旧 A thread 再发一句应仍绑 A。
5. 指定 A 且 A 不可用时 Craft 应失败、不落到 B。

只有一个 Codex：只做单账号冒烟，**到此停止**，不要用 Grok/Antigravity 充数。

## Closeout

无。
