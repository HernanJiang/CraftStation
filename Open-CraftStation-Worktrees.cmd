@echo off
setlocal EnableExtensions

set "CRAFTSTATION_ROOT=%~dp0"

:menu
cls
echo ==============================================
echo            CraftStation-Dev Menu
echo ==============================================
echo.
echo   1. main     - Stable CraftStation-Main source
echo   2. v0.7     - Dev: Native Harnesses
echo   3. v0.8     - Dev: OpenCode Native
echo   4. v0.9     - Dev: Cross-Harness Handoff
echo   5. v0.10    - Dev: Cross-Thread Collaboration
echo   6. Open all version worktrees
echo   7. Show Git worktree topology
echo   0. Exit
echo.
set "CRAFTSTATION_CHOICE="
set /p "CRAFTSTATION_CHOICE=Select: " || exit /b 0

if "%CRAFTSTATION_CHOICE%"=="1" goto open_main
if "%CRAFTSTATION_CHOICE%"=="2" goto open_v07
if "%CRAFTSTATION_CHOICE%"=="3" goto open_v08
if "%CRAFTSTATION_CHOICE%"=="4" goto open_v09
if "%CRAFTSTATION_CHOICE%"=="5" goto open_v010
if "%CRAFTSTATION_CHOICE%"=="6" goto open_all
if "%CRAFTSTATION_CHOICE%"=="7" goto show_topology
if "%CRAFTSTATION_CHOICE%"=="0" exit /b 0
goto menu

:open_main
call :open_path "%CRAFTSTATION_ROOT%"
goto menu

:open_v07
call :open_path "%CRAFTSTATION_ROOT%.worktrees\v0.7-native-harnesses"
goto menu

:open_v08
call :open_path "%CRAFTSTATION_ROOT%.worktrees\v0.8-opencode-native"
goto menu

:open_v09
call :open_path "%CRAFTSTATION_ROOT%.worktrees\v0.9-cross-harness-handoff"
goto menu

:open_v010
call :open_path "%CRAFTSTATION_ROOT%.worktrees\v0.10-cross-thread-collaboration"
goto menu

:open_all
call :open_path "%CRAFTSTATION_ROOT%.worktrees\v0.7-native-harnesses"
call :open_path "%CRAFTSTATION_ROOT%.worktrees\v0.8-opencode-native"
call :open_path "%CRAFTSTATION_ROOT%.worktrees\v0.9-cross-harness-handoff"
call :open_path "%CRAFTSTATION_ROOT%.worktrees\v0.10-cross-thread-collaboration"
goto menu

:show_topology
cls
git -C "%CRAFTSTATION_ROOT%" worktree list
echo.
pause
goto menu

:open_path
if not exist "%~1\" (
  echo.
  echo [ERROR] Path not found: %~1
  pause
  exit /b 1
)
start "" explorer.exe "%~1"
exit /b 0
