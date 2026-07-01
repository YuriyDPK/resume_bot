@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_HOME=%ROOT%.tools\node-v22.23.1-win-x64"
set "PATH=%NODE_HOME%;%PATH%"
cd /d "%ROOT%"
echo Using Node:
node -v
echo Starting Next.js dev server at http://localhost:3000
call npm run dev
