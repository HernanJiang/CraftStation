# Coder 交付：v0.6.0 Native Provider Authentication & Ark Token Plan (Follow-up Fixes)

日期：2026-08-30
工作树：`D:\Work\CraftStation\craftstation-dev`
分支：`dev`
HEAD：`7ae6506ea01fc04029a10a711ebb0a65d7248e06`
状态：**CODER COMPLETE / DEBUGGER ACCEPTANCE PENDING（F35/F36 仍 BLOCKED，不得升格 PASS）**

## 本轮用户缺陷修复

1. **删除账号**
   - 左侧卡片垃圾桶统一 `aria-label="移除账号"`。
   - 删除走 `removeAccount` + `clearLogin`；Grok / Command Code 同步删除 host `auth.json`。
   - 远程会话不开放 host CLI sign-out。

2. **身份邮箱**
   - Grok OIDC `auth.json` 解析 `email` / `principal_id`。
   - cookie 用量成功时回填 `token.email`，避免「账号身份未知」。
   - Command Code whoami / session / `auth.json.email` 写入 `authenticatedAs`。

3. **Antigravity 额度条**
   - 对齐 `reference/token-monitor` 的 LS `RetrieveUserQuotaSummary`：`summary` 包装、嵌套 remainingFraction、bucketId cadence。
   - **禁止 Cloud Code fallback**。

4. **参考仓库**
   - `D:\Work\CraftStation\reference\token-monitor` 已克隆，基线写入 `reference/BASELINES.md`。

## 验证

- 定向测试：8 files / 126 passed。
- `tsc --noEmit` EXIT 0；触及文件 oxlint 与 `git diff --check` 通过。
- 未 commit / push / tag / merge main。

## 质量门边界

- F35 / F36 / Grok 真实额度 / F29 / v0.5.0 / v0.4 F04 全部保持 **FAIL / BLOCKED**。
- 单元测试绿灯不是 Feature PASS，也不是真实 Google / Ark E2E。
