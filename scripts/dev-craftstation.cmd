@echo off
setlocal EnableExtensions
cd /d "D:\Work\CraftStation"
if errorlevel 1 exit /b 1

set "NODE_HOME=C:\Program Files\nodejs"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"

set "PNPM_SHIM=%TEMP%\craftstation-pnpm-shim"
if not exist "%PNPM_SHIM%" mkdir "%PNPM_SHIM%"
> "%PNPM_SHIM%\pnpm.cmd" (
  echo @echo off
  echo call corepack pnpm %%*
)
set "PATH=%PNPM_SHIM%;%PATH%"
set "CRAFTSTATION_DISABLE_DEVTOOLS=1"

if /I "%~1"=="--hidden" goto hidden

powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Work\CraftStation\scripts\stop-craftstation-dev.ps1" >nul 2>&1
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--hidden' -WindowStyle Hidden"
exit /b 0

:hidden
cd /d "D:\Work\CraftStation"
call pnpm dev > "%TEMP%\craftstation-dev.log" 2>&1
exit /b %ERRORLEVEL%
