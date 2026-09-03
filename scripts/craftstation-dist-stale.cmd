@echo off
rem Batch wrapper around craftstation-dist-stale.mjs.
rem Usage: craftstation-dist-stale.cmd <repoRoot> <distMain> <distRenderer>
rem Exit 0 = up to date, exit 1 = rebuild needed.
setlocal EnableExtensions

set "CRAFTSTATION_ROOT=%~1"
set "CRAFTSTATION_NODE=%~dp0..\node_modules\.bin\node.exe"
if not exist "%CRAFTSTATION_NODE%" set "CRAFTSTATION_NODE=node"

"%CRAFTSTATION_NODE%" "%~dp0craftstation-dist-stale.mjs" "%CRAFTSTATION_ROOT%"
exit /b %ERRORLEVEL%
