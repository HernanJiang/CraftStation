@echo off
rem Synchronize two CraftStation data roots while both app instances are closed.
rem Usage: sync-craftstation-data.cmd <leftDataDir> <rightDataDir>
setlocal EnableExtensions
set "CS_NODE=node"
set "CS_ROOT=%~dp0"
"%CS_NODE%" "%CS_ROOT%sync-craftstation-data.mjs" "%~1" "%~2"
exit /b %ERRORLEVEL%
