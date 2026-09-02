@echo off
setlocal EnableExtensions

set "CRAFTSTATION_ROOT=D:\Work\CraftStation"
set "CRAFTSTATION_LOG=%TEMP%\craftstation-main.log"
set "CRAFTSTATION_ELECTRON=%CRAFTSTATION_ROOT%node_modules\electron\dist\electron.exe"
set "CRAFTSTATION_NATIVE_BINDING=%CRAFTSTATION_ROOT%release\win-unpacked\resources\app.asar.unpacked\node_modules\better-sqlite3\build\Release\better_sqlite3.node"

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

if not exist "%CRAFTSTATION_ELECTRON%" (
  echo [CraftStation-Main] Electron executable is unavailable:
  echo %CRAFTSTATION_ELECTRON%
  echo.
  echo Run pnpm install in the main repository before launching.
  pause
  exit /b 1
)

if not exist "%CRAFTSTATION_NATIVE_BINDING%" set "CRAFTSTATION_NATIVE_BINDING="

start "CraftStation-Main" /min "%ComSpec%" /d /c ""%~f0" --worker"
exit /b 0

:worker
cd /d "%CRAFTSTATION_ROOT%"
if errorlevel 1 exit /b 1

set "NODE_HOME=C:\Program Files\nodejs"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"
set "CRAFTSTATION_DISABLE_DEVTOOLS=1"
if defined CRAFTSTATION_NATIVE_BINDING set "CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING=%CRAFTSTATION_NATIVE_BINDING%"

echo [%DATE% %TIME%] Starting CraftStation-Main> "%CRAFTSTATION_LOG%"
"%CRAFTSTATION_ELECTRON%" "%CRAFTSTATION_ROOT%" >> "%CRAFTSTATION_LOG%" 2>&1
set "CRAFTSTATION_EXIT=%ERRORLEVEL%"

if not "%CRAFTSTATION_EXIT%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('CraftStation-Main failed to start. Log: %CRAFTSTATION_LOG%', 'CraftStation-Main', 'OK', 'Error') | Out-Null"
)

exit /b %CRAFTSTATION_EXIT%
