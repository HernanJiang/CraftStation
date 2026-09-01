@echo off
setlocal EnableExtensions

set "CRAFTSTATION_ROOT=D:\Work\CraftStation"
set "CRAFTSTATION_LOG=%TEMP%\craftstation-main.log"

if /I "%~1"=="--worker" goto worker

if not exist "%CRAFTSTATION_ROOT%\package.json" (
  echo [CraftStation-Main] Product root is unavailable:
  echo %CRAFTSTATION_ROOT%
  echo.
  pause
  exit /b 1
)

if not exist "%CRAFTSTATION_ROOT%\node_modules\" (
  echo [CraftStation-Main] Dependencies are unavailable:
  echo %CRAFTSTATION_ROOT%\node_modules
  echo.
  echo Run pnpm install in the main repository before launching.
  pause
  exit /b 1
)

if not exist "%CRAFTSTATION_ROOT%\dist\main\main.cjs" (
  echo [CraftStation-Main] Built main entry is unavailable:
  echo %CRAFTSTATION_ROOT%\dist\main\main.cjs
  echo.
  echo Run pnpm build in the main repository before launching.
  pause
  exit /b 1
)

start "CraftStation-Main" /min "%ComSpec%" /d /c ""%~f0" --worker"
exit /b 0

:worker
cd /d "%CRAFTSTATION_ROOT%"
if errorlevel 1 exit /b 1

set "NODE_HOME=C:\Program Files\nodejs"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"
set "CRAFTSTATION_DISABLE_DEVTOOLS=1"

echo [%DATE% %TIME%] Starting CraftStation-Main> "%CRAFTSTATION_LOG%"
call pnpm start >> "%CRAFTSTATION_LOG%" 2>&1
set "CRAFTSTATION_EXIT=%ERRORLEVEL%"

if not "%CRAFTSTATION_EXIT%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('CraftStation-Main failed to start. Log: %CRAFTSTATION_LOG%', 'CraftStation-Main', 'OK', 'Error') | Out-Null"
)

exit /b %CRAFTSTATION_EXIT%
