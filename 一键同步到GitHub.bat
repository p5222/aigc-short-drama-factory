@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 同步服务器最新代码到 GitHub

echo ============================================================
echo  将当前提交推送到 GitHub 当前分支和 main
echo ============================================================
echo.
for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if "%BRANCH%"=="" (
  echo [失败] 当前不在命名分支上。
  goto :end
)

git push -u origin "%BRANCH%"
if errorlevel 1 goto :failed
git push origin HEAD:main
if errorlevel 1 goto :failed
echo.
echo [成功] GitHub 当前分支和 main 已同步。
goto :end

:failed
echo.
echo [失败] GitHub 网络或认证不可用，服务器 Git 不受影响，稍后重试即可。

:end
echo.
pause
