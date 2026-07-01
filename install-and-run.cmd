@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_HOME=%ROOT%.tools\node-v22.23.1-win-x64"
set "PATH=%NODE_HOME%;%PATH%"
cd /d "%ROOT%"
echo Using Node:
node -v
echo Using npm:
npm -v
echo.
echo Installing dependencies...
call npm install
if errorlevel 1 exit /b %errorlevel%
echo.
echo Running Prisma migration...
call npx prisma migrate dev
if errorlevel 1 exit /b %errorlevel%
echo.
echo Installing Playwright browsers...
call npx playwright install
if errorlevel 1 exit /b %errorlevel%
echo.
echo Starting Next.js dev server at http://localhost:3000
call npm run dev
