# CraftStation 1.11.8

## 用户可见

- Claude Code 不再安装失败（退出码 -1）。部分机器上 CraftStation 继承的 PowerShell 模块路径把 PowerShell 7 的目录排在系统目录之前，PS 5.1 加载不到 `Get-FileHash`，官方安装脚本一开始校验就中断并杀掉安装终端；现在启动安装终端前会把系统模块目录排回最前，安装脚本可以正常跑完。
- 本补丁只发布 Windows x64 NSIS 安装包与便携版。安装后重新打开 CraftStation，再到 Harness 总览重新点「下载并安装」。

## 实现

- `src/supervisor/agents/base/processRuntime.ts` 新增 `repairWindowsPowerShellModulePath`：Windows 下把 `%ProgramFiles%\WindowsPowerShell\Modules` 与 `%SystemRoot%\system32\WindowsPowerShell\v1.0\Modules` 去重后钉到 PSModulePath 最前，保留其余自定义目录；顺序已正确时不改动。
- `src/supervisor/runtime/threadSessionManager.ts` 在原生 Windows 且 shell 为 Windows PowerShell（PS 5.1）时应用该修复：先清除 shell 环境里所有大小写变体的 `PSModulePath` 键，再写入修复后的规范值。pwsh（PS 7）与 cmd 不受影响。

## 验证

- 新增 3 项 `repairWindowsPowerShellModulePath` 单测（污染值重排、已干净返回 undefined、缺失时给出系统默认）；相关 54 项测试通过，类型检查与常规/类型感知 lint 0 警告。
- 真实 Windows PowerShell 5.1 验证：以用户机器上实际污染值启动时 `(Get-Command Get-FileHash)` 返回 False（复现安装脚本失败点），以修复后的值启动时返回 True。
- 以修复后的环境真实运行官方 `claude.ai/install.ps1`：版本查询、清单解析、280MB 安装器下载与 SHA256 校验全部通过，并成功启动官方安装器（修复前脚本在第一步 `Get-FileHash` 校验即中断退出）。

---

# CraftStation 1.11.8

## User-facing

- Claude Code no longer fails to install (exit code -1). On some machines CraftStation inherits a PowerShell module path that puts the PowerShell 7 directories ahead of the system ones, so PS 5.1 cannot load `Get-FileHash` and the official install script aborts at its first checksum step, killing the install terminal. CraftStation now pins the system module directories back to the front before launching the install terminal, so the script runs to completion.
- This patch publishes Windows x64 only: an NSIS installer and a portable package. Reopen CraftStation after installing, then click "Download and install" again in the Harness overview.

## Implementation

- `src/supervisor/agents/base/processRuntime.ts` adds `repairWindowsPowerShellModulePath`: on Windows it dedupes and pins `%ProgramFiles%\WindowsPowerShell\Modules` and `%SystemRoot%\system32\WindowsPowerShell\v1.0\Modules` to the front of PSModulePath, keeping any custom entries; already-correct values are left untouched.
- `src/supervisor/runtime/threadSessionManager.ts` applies the repair when building the shell environment on native Windows for Windows PowerShell (PS 5.1): all case variants of the `PSModulePath` key are removed first, then the repaired canonical value is written. pwsh (PS 7) and cmd are unaffected.

## Verification

- Three new `repairWindowsPowerShellModulePath` unit tests (reordering a polluted value, returning undefined when already clean, falling back to system defaults when missing); 54 related tests passed, with typecheck and regular/type-aware lint at zero warnings.
- Real Windows PowerShell 5.1 check: launched with the actual polluted value from the affected machine, `(Get-Command Get-FileHash)` returns False (reproducing the install script's failure point); launched with the repaired value, it returns True.
- The official `claude.ai/install.ps1` was run under the repaired environment: version lookup, manifest parsing, the 280MB installer download, and SHA256 verification all passed, and the official installer was launched successfully (previously the script died at its first `Get-FileHash` step).
