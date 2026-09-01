@echo off
setlocal EnableExtensions

set "CRAFTSTATION_MENU=%~dp0Open-CraftStation-Worktrees.cmd"

if not exist "%CRAFTSTATION_MENU%" (
  echo [CraftStation-Dev] Worktree menu not found:
  echo %CRAFTSTATION_MENU%
  echo.
  pause
  exit /b 1
)

call "%CRAFTSTATION_MENU%"
exit /b %ERRORLEVEL%
