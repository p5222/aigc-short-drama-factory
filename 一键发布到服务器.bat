@echo off
setlocal
cd /d "%~dp0"
title Ship project to server
echo ============================================================
echo  Test - Commit - Push server Git - Deploy - Health check
echo ============================================================
echo.
set /p "MSG=Commit message: "
if "%MSG%"=="" (
  echo [ERROR] Commit message is required.
  goto :end
)
call pnpm ship:server -- "%MSG%"
if errorlevel 1 (
  echo.
  echo [FAILED] Check the error above.
) else (
  echo.
  echo [SUCCESS] Server Git and production are updated.
)
:end
echo.
pause
