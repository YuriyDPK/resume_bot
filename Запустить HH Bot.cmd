@echo off
chcp 65001 >nul
setlocal
set "ROOT=%USERPROFILE%\Documents\BOT_HH"
set "NODE_HOME=%ROOT%\.tools\node-v22.23.1-win-x64"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"
cd /d "%ROOT%"
echo ==============================================
echo HH Job Apply Bot
echo Project: %ROOT%
echo ==============================================
echo.
echo Checking Node.js...
node -v
if errorlevel 1 (
  echo.
  echo Node.js not found. Check portable Node folder:
  echo %NODE_HOME%
  pause
  exit /b 1
)
echo.
echo Installing dependencies: npm i
call npm i
if errorlevel 1 (
  echo.
  echo npm i failed.
  pause
  exit /b 1
)
echo.
echo Applying Prisma migrations...
call npx prisma migrate dev
if errorlevel 1 (
  echo.
  echo Prisma migration failed.
  pause
  exit /b 1
)
echo.
echo Starting dev server in a new window...
if exist "%ROOT%\start-project.cmd" (
  start "HH Bot Dev Server" "%ROOT%\start-project.cmd"
) else (
  start "HH Bot Dev Server" cmd /k npm run dev
)
echo Waiting for localhost:3000...
timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"
echo.
echo Browser opened: http://localhost:3000
echo You can close this window.
timeout /t 3 /nobreak >nul
exit /b 0
