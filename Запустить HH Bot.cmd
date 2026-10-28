@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "NODE_HOME=%ROOT%.tools\node-v22.23.1-win-x64"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"
cd /d "%ROOT%"

echo HH Job Apply Bot
node -v
if errorlevel 1 (
  echo Install Node.js 22.12+ or use the portable Node folder.
  pause
  exit /b 1
)

if not exist ".env" copy ".env.example" ".env" >nul

echo Installing locked dependencies...
call npm ci
if errorlevel 1 goto :failed

echo Preparing database and Chromium...
call npm run setup
if errorlevel 1 goto :failed

start "HH Bot Dev Server" "%ROOT%start-project.cmd"
timeout /t 7 /nobreak >nul
start "" "http://localhost:3000"
exit /b 0

:failed
echo Setup failed. See the error above.
pause
exit /b 1
