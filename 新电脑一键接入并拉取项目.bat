@echo off
chcp 65001 >nul
setlocal
title 新电脑接入漫角项目

echo ============================================================
echo  首次运行：生成设备公钥，请把显示的公钥发给管理员授权
echo  授权以后：再次运行，自动拉取项目代码
echo ============================================================
echo.
set "DEFAULT_DIR=%USERPROFILE%\Documents\aigc-short-drama-factory"
set /p "TARGET=项目保存目录（直接回车使用 %DEFAULT_DIR%）: "
if "%TARGET%"=="" set "TARGET=%DEFAULT_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap_manjiao_git.ps1" -CloneTo "%TARGET%"
if errorlevel 1 (
  echo.
  echo [等待授权] 请把上方 PUBLIC key 或以下 .pub 文件发给管理员：
  echo %USERPROFILE%\.ssh\manjiao_git.pub
) else (
  echo.
  echo [成功] 项目已拉取到：%TARGET%
  echo 接下来进入目录运行：pnpm install --frozen-lockfile
)
echo.
pause
