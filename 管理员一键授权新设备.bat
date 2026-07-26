@echo off
setlocal
cd /d "%~dp0"
title Grant restricted Git access
echo This grants Git access only. It does not grant server shell access.
echo.
set /p "PUB=Drag or enter the new device .pub file: "
set "PUB=%PUB:"=%"
if not exist "%PUB%" (
  echo [ERROR] Public key file not found: %PUB%
  goto :end
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\grant_manjiao_git_access.ps1" -PublicKeyFile "%PUB%"
if errorlevel 1 (
  echo [FAILED] Access was not granted.
) else (
  echo [SUCCESS] The new device can now clone and push.
)
:end
echo.
pause
