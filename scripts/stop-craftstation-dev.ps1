$ErrorActionPreference = "SilentlyContinue"

Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $PID -and
    $_.CommandLine -and
    $_.CommandLine -like "*D:\Work\CraftStation*" -and
    $_.CommandLine -notlike "*D:\Work\CraftStation\.worktrees\*" -and
    (
      $_.CommandLine -like "*electronmon*" -or
      $_.CommandLine -like "*\vite*" -or
      $_.CommandLine -like "*tsdown*" -or
      $_.CommandLine -like "*pnpm run dev*" -or
      $_.CommandLine -like "*dev:renderer*" -or
      $_.CommandLine -like "*dev:electron*" -or
      $_.CommandLine -like "*dev:app*" -or
      $_.CommandLine -like "*free-port.mjs*"
    )
  } |
  ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
