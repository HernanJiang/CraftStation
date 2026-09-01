@echo off
setlocal EnableExtensions
rem Compatibility entry. Prefer CraftStation-Main.cmd for new shortcuts.
call "%~dp0CraftStation-Main.cmd"
exit /b %ERRORLEVEL%
