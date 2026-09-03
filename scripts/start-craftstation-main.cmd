@echo off
rem Desktop shortcut entry: CraftStation (main branch, production mode).
rem Delegates to the shared production launcher; see launch-craftstation.cmd.
setlocal EnableExtensions
call "%~dp0launch-craftstation.cmd" "D:\Work\CraftStation" "CraftStation Main" "main" "%USERPROFILE%\.craftstation" "%USERPROFILE%\.craftstation-dev"
exit /b %ERRORLEVEL%
