@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_HOME=%ROOT%.tools\node-v22.23.1-win-x64"
set "PATH=%NODE_HOME%;%PATH%"
cd /d "%ROOT%"
echo Portable Node is ready in this terminal.
echo Node:
node -v
echo npm:
npm -v
echo.
cmd /k
