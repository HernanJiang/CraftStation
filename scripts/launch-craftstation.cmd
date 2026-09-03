@echo off
rem Production-mode CraftStation launcher used by desktop shortcuts.
rem
rem Usage: launch-craftstation.cmd <repoRoot> <windowTitle> <logTag> [dataDir] [syncPeerDir]
rem
rem The launcher always runs the app from the built dist/ output (no Vite dev
rem server, no port 3100 dependency), so the window can never show the plain
rem background color while a dev server is slow to boot. Before launching it
rem rebuilds dist/ when tracked sources are newer than the last build, so a
rem desktop shortcut always opens the code you just updated.
setlocal EnableExtensions EnableDelayedExpansion

set "CRAFTSTATION_ROOT=%~1"
set "CRAFTSTATION_TITLE=%~2"
set "CRAFTSTATION_TAG=%~3"
set "CRAFTSTATION_DATA_DIR=%~4"
set "CRAFTSTATION_SYNC_PEER=%~5"

if not defined CRAFTSTATION_ROOT (
  echo [%~n0] Missing repo root argument.
  pause
  exit /b 1
)

if not exist "%CRAFTSTATION_ROOT%\package.json" (
  echo [%CRAFTSTATION_TAG%] Repository root is unavailable:
  echo %CRAFTSTATION_ROOT%
  echo.
  pause
  exit /b 1
)

set "CRAFTSTATION_ELECTRON=%CRAFTSTATION_ROOT%\node_modules\electron\dist\electron.exe"
set "CRAFTSTATION_DIST_MAIN=%CRAFTSTATION_ROOT%\dist\main\main.cjs"
set "CRAFTSTATION_DIST_RENDERER=%CRAFTSTATION_ROOT%\dist\renderer\index.html"
set "CRAFTSTATION_LOG=%TEMP%\craftstation-%CRAFTSTATION_TAG%.log"
set "NODE_HOME=C:\Program Files\nodejs"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"

if not exist "%CRAFTSTATION_ROOT%\node_modules\electron\dist\electron.exe" (
  echo [%CRAFTSTATION_TAG%] Dependencies missing; run: pnpm install
  echo Root: %CRAFTSTATION_ROOT%
  echo.
  pause
  exit /b 1
)

rem Keep the two acceptance data roots independent, but synchronize their
rem durable state before each launch when a peer directory was supplied.
if defined CRAFTSTATION_SYNC_PEER (
  call "%~dp0sync-craftstation-data.cmd" "%CRAFTSTATION_DATA_DIR%" "%CRAFTSTATION_SYNC_PEER%"
  if errorlevel 1 (
    echo [%CRAFTSTATION_TAG%] Data synchronization failed; launch aborted.
    pause
    exit /b 1
  )
)

rem Dist is stale when any tracked source/config file is newer than the
rem renderer entry. Rebuilding keeps the shortcut in sync with every update
rem without forcing a rebuild when nothing changed.
call "%~dp0craftstation-dist-stale.cmd" "%CRAFTSTATION_ROOT%" "%CRAFTSTATION_DIST_MAIN%" "%CRAFTSTATION_DIST_RENDERER%"
if errorlevel 1 (
  echo [%CRAFTSTATION_TAG%] Sources changed since last build; rebuilding dist ...
  pushd "%CRAFTSTATION_ROOT%"
  call pnpm build
  set "CRAFTSTATION_BUILD_EXIT=!ERRORLEVEL!"
  popd
  if not "!CRAFTSTATION_BUILD_EXIT!"=="0" (
    echo [%CRAFTSTATION_TAG%] Build failed. See messages above; fix build errors then reopen this shortcut.
    pause
    exit /b 1
  )
)

if not exist "%CRAFTSTATION_DIST_RENDERER%" (
  echo [%CRAFTSTATION_TAG%] Built renderer missing after build:
  echo %CRAFTSTATION_DIST_RENDERER%
  echo.
  pause
  exit /b 1
)

rem Validate / rebuild better-sqlite3 against the Electron ABI before launch.
rem ensure-native-deps.mjs loads electron/node-pty via pnpm-installed node so it
rem must run from the repo root; it repairs a mismatched ABI itself.
pushd "%CRAFTSTATION_ROOT%"
call node scripts/ensure-native-deps.mjs --electron-native
set "CRAFTSTATION_NATIVE_EXIT=!ERRORLEVEL!"
popd
if not "!CRAFTSTATION_NATIVE_EXIT!"=="0" (
  echo [%CRAFTSTATION_TAG%] Native dependency check failed; see output above.
  pause
  exit /b 1
)

echo [%CRAFTSTATION_TAG%] Launching from %CRAFTSTATION_ROOT%
echo [%DATE% %TIME%] Starting %CRAFTSTATION_TITLE%> "%CRAFTSTATION_LOG%"

set "CRAFTSTATION_LAUNCH_ARGS=%CRAFTSTATION_ROOT%"
if defined CRAFTSTATION_DATA_DIR (
  set "CRAFTSTATION_BASE_DIR=%CRAFTSTATION_DATA_DIR%"
)

rem Unset dev-only variables so the packaged-style production path is taken.
set "VITE_DEV_SERVER_URL="
set "CRAFTSTATION_OPEN_DEVTOOLS="

"%CRAFTSTATION_ELECTRON%" "%CRAFTSTATION_ROOT%" >> "%CRAFTSTATION_LOG%" 2>&1
set "CRAFTSTATION_EXIT=%ERRORLEVEL%"

rem Copy durable data back after the app closes. This makes the next dev/main
rem launch start from the state produced by the last acceptance run.
if defined CRAFTSTATION_SYNC_PEER (
  call "%~dp0sync-craftstation-data.cmd" "%CRAFTSTATION_DATA_DIR%" "%CRAFTSTATION_SYNC_PEER%"
  if errorlevel 1 echo [%CRAFTSTATION_TAG%] Post-exit data synchronization failed.
)

if not "%CRAFTSTATION_EXIT%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('%CRAFTSTATION_TITLE% exited with code %CRAFTSTATION_EXIT%. Log: %CRAFTSTATION_LOG%', '%CRAFTSTATION_TITLE%', 'OK', 'Error') | Out-Null"
)

exit /b %CRAFTSTATION_EXIT%
