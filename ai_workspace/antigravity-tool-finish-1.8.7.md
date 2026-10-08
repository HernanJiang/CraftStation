# Antigravity 工具后提前收尾修复记录

## 发布范围审计

上一版基线为 `v1.8.6`，发布边界为本次待提交的修复与版本元数据。

| 提交或改动                              | 处理                       | 原因                               |
| --------------------------------------- | -------------------------- | ---------------------------------- |
| `46c398e6`：记录 1.8.6 验证及发布       | omit                       | 已发布版本的验证记录，无新产品行为 |
| 本次 Antigravity 完成判定及传输续接修复 | include                    | 修复工具收尾却显示已完成的用户问题 |
| 本次测试、版本号及验证记录              | fold into Antigravity 修复 | 对应同一修复的验证及发布元数据     |

## 复现与判定

只读查看截图对应的“实习”线程，确认最后一个 `run_command` 仍显示运行中，工具前的说明文字是最后一段可见回复。原生会话中该工具后来已完成，CraftStation 记录未收到相应完成更新。

最小回归命令：`pnpm exec vitest run --configLoader runner src/supervisor/agents/antigravity/structuredSession.test.ts -t 'does not accept pre-tool narration'`。修复前，工具前 DONE 文字、随后工具及旧快照结束信号被错误接受为成功，断言得到 `promise resolved undefined instead of rejecting`。只清除 DONE 标记仍失败，确认旧快照非空判断也会误判。

修复后，九组正在运行、已完成和只收到完成事件的工具与 ERROR、SUCCESS、进程退出组合均不再误报成功。跨 Antigravity 会话与 Craft-Harness 的回归验证续接、工具完成后显示最终回复、只成功结束一次和重试预算上限；新的最终快照及真正回答后的失败仍保留防重复行为。

## 运行证据

- 104 项相关测试、类型检查及两种 lint 通过。
- 隔离 Electron mock 冒烟：`C:/Users/Haona/.craftstation-smoke/antigravity-final-20261008-1520/artifacts/smoke-report.json`；自动检查与三个 mock 门禁通过，控制台及运行时错误为 0，窗口已停止。
- 真实服务尝试：`C:/Users/Haona/.craftstation-smoke/antigravity-live-20261008-1523/artifacts/provider-model-blocked.png`。`agy 1.3.1` 已检测安装且认证可用，但拒绝 `Gemini 3.8 Flash` 的模型参数，直接查询模型列表也超时。真实工具回合验证记为 BLOCKED，不与 mock 通过混淆。隔离窗口已 reset 和 stop；未改用户真实对话。
