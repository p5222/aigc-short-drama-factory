@echo off
setlocal
title Setup new device and clone project
set "DEFAULT_DIR=%USERPROFILE%\Documents\aigc-short-drama-factory"
echo First run creates a public key for administrator approval.
echo Run again after approval to clone the project.
echo.
set /p "TARGET=Clone directory [%DEFAULT_DIR%]: "
if "%TARGET%"=="" set "TARGET=%DEFAULT_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap_manjiao_git.ps1" -CloneTo "%TARGET%"
if errorlevel 1 (
  echo.
  echo Send this PUBLIC key file to the administrator:
  echo %USERPROFILE%\.ssh\manjiao_git.pub
) else (
  echo.
  echo [SUCCESS] Project cloned to: %TARGET%
)
echo.
pause
