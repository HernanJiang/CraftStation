# CraftStation 1.11.6

## 用户可见

- 修复第三方账号上的 DeepSeek 标题能生成、正文却失败的问题。选择 CodeKey 的 `deepseek-v4.1-flash` 后，正文继续使用该账号声明的模型和 Chat Completions 路径，不再匹配到官方的 `deepseek-flash` 别名。
- 模型服务暂时不可用时，按「设置 → 一般」中的重试次数和间隔恢复。额度、鉴权错误和主动停止保持原有处理。
- 本补丁只发布 Windows x64 NSIS 安装包与便携版。安装后重新打开 CraftStation，让新 Runtime 生效。

## 实现

- 第三方 DeepSeek 启动时把账号对应的 ACP provider 一直传到模型解析器，只在该 provider 的 `[provider, model]` 选项中匹配。缺少绑定 provider 时直接报错。
- ACP 的实际回合失败向上冒泡，由 Craft-Harness 统一决定重试或账号切换。流内错误仍只报告一次，容量重试提示继续过滤。
- 重试识别新增明确的临时模型服务不可用消息，并保留原始错误上下文。

## 验证

- 回归先复现了错误 provider 选择、ACP 吞掉失败及临时模型不可用未被重试识别的问题，再验证修复。
- 真实安装的 dsh 经 CraftStation ACP factory 建立独立 Session。先注入模型暂不可用的 HTTP 503，再恢复 CodeKey，检查自动重试、首条助手回复和同一 Session 的追问；请求必须是 `deepseek-v4.1-flash` 的 Chat Completions。
- ACP、DeepSeek、Craft-Harness、启动与回合队列相关 660 项测试通过，类型检查及变更文件常规/类型感知 lint 通过。隔离 Electron 的 6 个场景与 4 项 mock gate 通过，控制台/运行时错误 0。真实供应商验证通过 ACP factory 执行，未在用户现有会话中发送测试消息；未执行完整供应商 UI 功能矩阵。

---

# CraftStation 1.11.6

## User-facing

- Fix DeepSeek conversations that generate a title but fail to produce a reply through a third-party account. Selecting CodeKey's `deepseek-v4.1-flash` keeps the account's declared model and Chat Completions route instead of matching the official `deepseek-flash` alias.
- Temporary model service outages follow the retry count and interval in Settings → General. Quota, authentication failures, and user-requested stops keep their existing handling.
- This patch publishes Windows x64 only: an NSIS installer and a portable package. Reopen CraftStation after installing to load the updated runtime.

## Implementation

- Third-party DeepSeek launches carry the account's ACP provider through to model resolution. Only that provider's `[provider, model]` options can match; a missing bound provider fails closed.
- Actual ACP turn failures propagate to Craft-Harness for shared retry or account failover. In-stream errors are reported once, and capacity retry chatter remains filtered.
- Retry classification recognizes explicit temporary model service outages while retaining the original error context.

## Verification

- Regression tests first reproduced incorrect provider selection, swallowed ACP failures, and temporary model outages bypassing retry, then verified the fixes.
- The installed dsh opened an isolated Session through CraftStation's ACP factory. The test injected an HTTP 503 model outage, restored CodeKey, and checked automatic retry, the first assistant reply, and a follow-up in the same Session. Requests must use Chat Completions with `deepseek-v4.1-flash`.
- All 660 related ACP, DeepSeek, Craft-Harness, spawn, and turn queue tests passed, along with type checking and regular/type-aware lint on changed files. Isolated Electron regression passed six scenarios and four mock gates with zero console/runtime errors. Live provider validation runs through the ACP factory without sending test messages to the user's existing conversations; the full provider UI feature matrix was not exercised.
