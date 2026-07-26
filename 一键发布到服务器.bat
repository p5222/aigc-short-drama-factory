@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 一键发布到服务器

echo ============================================================
echo  验证代码 - 提交 - 推送服务器 Git - 自动部署 - 健康检查
echo ============================================================
echo.
set /p "MSG=请输入本次更新说明: "
if "%MSG%"=="" (
  echo [失败] 更新说明不能为空。
  goto :end
)

call pnpm ship:server -- "%MSG%"
if errorlevel 1 (
  echo.
  echo [失败] 发布未完成，请把上方错误发给开发智能体。
) else (
  echo.
  echo [成功] 代码已保存到服务器 Git，并已部署生产环境。
)

:end
echo.
pause
