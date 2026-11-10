# CraftStation 1.11.22

## 用户可见

- Claude Code 的「完全访问权限」现在正确使用 `bypassPermissions`，避免错误沿用 Auto 模式而被其分类器拦截工具。
- 已有会话可以在运行中切换到完全访问权限；权限变更被运行时拒绝时，显示具体错误，并停止提交该回合。
- 现有对话中显式保存的 Auto 继续保留；需要完全访问时，在对话的权限菜单选择「完全访问权限」。

## 实现

- 修正 Claude capability 的 `bypassPermissions` 声明；显式 Auto 与请求批准仍可选。
- SDK 启动时设置 `allowDangerouslySkipPermissions`，允许用户稍后切换；启动时实际权限仍由 `permissionMode` 决定。
- `setPermissionMode` 失败不再静默忽略，新增稳定错误码 `CLAUDE_PERMISSION_MODE_UPDATE_FAILED`，保留原始异常并记录线程、请求模式和已应用模式。

## 验证

- 三个新增回归在修复前失败、修复后通过；相关测试与 changelog 校验共 10 个文件 / 155 项通过，类型检查、lint、格式检查通过。
- 真实隔离 Electron 中，Claude Code 2.1.316 成功调用 PowerShell、Bash、Read 与 MCP。权限批准界面、拒绝、问答提交、Auto 到完全访问的会话内切换、模型切换、Steer、Stop 和重开续接均完成；续接没有重复历史消息。
- real-mode 定向应用冒烟通过，控制台 / 运行时异常为 0。未重跑全量测试，不宣称全量通过。
- 本补丁发布 Windows x64 NSIS 安装包与便携版。

---

# CraftStation 1.11.22

## User-facing

- Claude Code's Full access option now correctly uses `bypassPermissions`, avoiding tool denials caused by incorrectly selecting Auto mode and its classifier.
- Existing sessions can switch to Full access while running. If the runtime rejects a permission change, the app reports the error and stops submitting that turn.
- Explicit Auto selections in existing conversations are preserved. Choose Full access in the conversation's permission menu when needed.

## Implementation

- Correct Claude's `bypassPermissions` capability declaration. Auto and approval-based modes remain available.
- Set `allowDangerouslySkipPermissions` when starting the SDK to support a later user-selected switch. The selected `permissionMode` still controls the active policy.
- Stop silently ignoring `setPermissionMode` failures. Report `CLAUDE_PERMISSION_MODE_UPDATE_FAILED`, retain the original exception, and log the thread, requested mode, and applied mode.

## Verification

- Three new regressions failed before the fix and passed afterward. All 155 tests across ten relevant files, including changelog validation, passed along with type checking, lint, and formatting checks.
- In an isolated real Electron app, Claude Code 2.1.316 successfully called PowerShell, Bash, Read, and MCP tools. Approval UI, denial, structured question submission, live Auto-to-Full-access switching, model changes, Steer, Stop, and reopening/resuming passed without duplicated history.
- Targeted real-mode app smoke passed with zero console/runtime exceptions. The full test suite was not rerun and is not claimed green.
- This patch ships Windows x64 NSIS installer and portable packages.
