@echo off
setlocal
cd /d "%~dp0"
title Sync project to GitHub
for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if "%BRANCH%"=="" (
  echo [ERROR] Switch to a named branch first.
  goto :end
)
git push -u origin "%BRANCH%"
if errorlevel 1 goto :failed
git push origin HEAD:main
if errorlevel 1 goto :failed
echo [SUCCESS] GitHub branch and main are updated.
goto :end
:failed
echo [FAILED] GitHub network or authentication is unavailable.
:end
echo.
pause
