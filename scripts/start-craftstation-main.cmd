@echo off
rem Desktop shortcut entry: CraftStation (main branch, production mode).
rem Delegates to the shared production launcher; see launch-craftstation.cmd.
rem Production-only: no sync peer, so the deleted dev data root
rem (%USERPROFILE%\.craftstation-dev) is never resurrected as a prod mirror.
setlocal EnableExtensions
call "%~dp0launch-craftstation.cmd" "D:\Work\CraftStation" "CraftStation Main" "main" "%USERPROFILE%\.craftstation" ""
exit /b %ERRORLEVEL%
