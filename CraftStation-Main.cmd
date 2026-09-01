@echo off
setlocal EnableExtensions

set "CRAFTSTATION_ROOT=%~dp0"
set "CRAFTSTATION_ENTRY=%CRAFTSTATION_ROOT%scripts\start-craftstation-main.cmd"

if not exist "%CRAFTSTATION_ENTRY%" (
  echo [CraftStation-Main] Launcher not found:
  echo %CRAFTSTATION_ENTRY%
  echo.
  pause
  exit /b 1
)

call "%CRAFTSTATION_ENTRY%"
exit /b %ERRORLEVEL%
