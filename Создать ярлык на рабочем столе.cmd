@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "SOURCE=%ROOT%Запустить HH Bot.cmd"
set "DESKTOP=%USERPROFILE%\Desktop"
set "TARGET=%DESKTOP%\Запустить HH Bot.cmd"
if not exist "%SOURCE%" (
  echo Launcher not found:
  echo %SOURCE%
  pause
  exit /b 1
)
if not exist "%DESKTOP%" (
  set "DESKTOP=%USERPROFILE%\OneDrive\Desktop"
  set "TARGET=%DESKTOP%\Запустить HH Bot.cmd"
)
if not exist "%DESKTOP%" (
  set "DESKTOP=%USERPROFILE%\OneDrive\Рабочий стол"
  set "TARGET=%DESKTOP%\Запустить HH Bot.cmd"
)
if not exist "%DESKTOP%" (
  echo Desktop folder not found.
  echo Copy this file manually:
  echo %SOURCE%
  pause
  exit /b 1
)
copy /Y "%SOURCE%" "%TARGET%" >nul
if errorlevel 1 (
  echo Failed to create desktop launcher.
  pause
  exit /b 1
)
echo Desktop launcher created:
echo %TARGET%
pause
