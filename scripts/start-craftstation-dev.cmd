@echo off
@echo off
rem Desktop shortcut entry: CraftStation Dev (v1.0.0 worktree, production mode).
rem Dev and main intentionally share the stable data root so threads, projects,
rem provider authorization, and settings are identical in both builds. Close
rem the other CraftStation window before opening this one because both use the
rem same single-instance lock and sqlite database.
setlocal EnableExtensions
call "%~dp0launch-craftstation.cmd" "D:\Work\CraftStation\.worktrees\v1.0.0" "CraftStation Dev (v1.0.0)" "dev-v1.0.0" "%USERPROFILE%\.craftstation-dev" "%USERPROFILE%\.craftstation"
exit /b %ERRORLEVEL%
