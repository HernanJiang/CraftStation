# CraftStation 1.8.4

## 用户可见

- 修复重启后账号池、文件树和会话统一报 `Supervisor is not running` 的问题：账号元数据异常不再阻止 Supervisor 启动。
- 账号池保留最新有效快照；主文件与上一份备份损坏时自动恢复账号列表和调度配置，保留独立凭据目录。
- Supervisor 意外退出、IPC 断连或进程启动错误时自动恢复，新请求等待恢复；关闭应用会取消待执行重启。

## 实现

- 共享原子写入先 `fsync` 刷新内容，再替换原文件，降低突然重启后文件全零的风险；刷新失败时保留原文件。
- 账号元数据备份改用校验后的原子写入，增加 `accounts.json.last-good`，升级时生成最新快照；恢复时保留损坏文件供诊断。
- 全部副本均无法恢复时，账号读写明确失败，不覆盖为空账号池；错误隔离在账号模块。
- 不重放崩溃前正在执行的请求，避免重复执行已提交的变更。

## 验证

- 本机根因：`accounts.json` 和 `.bak` 均为 21,057 字节的全零文件；旧代码在账号迁移构造阶段抛出 `ACCOUNT_CORRUPT`，Supervisor 反复退出。
- 从界面缓存与已知有效映射恢复全部 21 个账号，原凭据目录保持不变；真实桌面 `listAccounts` 返回 21 个账号，18 份凭据 JSON 均可解析。
- 117 个相关测试文件、1234 项测试通过；完整 Supervisor 启动及既有合成技能回归另有 3 项通过，补充验证与变更日志检查 96 项通过。类型检查、普通及类型感知 lint 通过。
- 最终 Windows x64 安装版与便携版均已构建；打包程序通过主文件及备份同时全零的 21 账号恢复测试，以及全部副本全零但其他 RPC 仍可用的故障隔离测试。安装后的 1.8.4 及再次冷启动均验证五个账号池列表、调度配置和会话快照 RPC 成功，Supervisor 错误为 0。

---

# CraftStation 1.8.4

## User-facing

- Fix account pools, project files, and sessions reporting `Supervisor is not running` after restart: account metadata errors no longer prevent Supervisor startup.
- Keep a current validated account snapshot. Recover account lists and pool settings when the primary file and previous backup are damaged, while preserving credential profiles.
- Recover automatically from unexpected Supervisor exits, IPC disconnections, and child-process errors. New requests wait for recovery; closing the app cancels scheduled restarts.

## Implementation

- Flush shared atomic file writes with `fsync` before replacing the original, reducing zero-filled files after sudden restarts. A failed flush preserves the original.
- Write validated account backups atomically, maintain `accounts.json.last-good`, seed it on upgrade, and retain damaged metadata for diagnosis during recovery.
- If every metadata copy is invalid, fail account reads and mutations explicitly instead of replacing the pool with empty defaults. Keep the failure isolated to account operations.
- Do not replay requests already in flight at a crash, avoiding duplicate committed mutations.

## Verification

- Local root cause: both `accounts.json` and `.bak` contained 21,057 zero bytes. The previous constructor threw `ACCOUNT_CORRUPT` during migration and repeatedly terminated the Supervisor.
- Recover all 21 accounts from the renderer cache and validated profile mappings without changing credentials. The live desktop account RPC returns 21 accounts; all 18 credential JSON files parse successfully.
- 117 related test files and 1,234 tests pass, plus three full Supervisor startup and existing crafted-skill regression tests and 96 focused tests including changelog validation. Type checking and both lint passes succeed.
- Both Windows x64 artifacts are built. The packaged Supervisor restores all 21 accounts when primary and backup are zero-filled, and keeps unrelated RPCs available when every metadata copy is invalid. The installed 1.8.4 app and a subsequent cold start pass all five account-pool listing and scheduling calls plus session snapshots, with zero Supervisor errors.
