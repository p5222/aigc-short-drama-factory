@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 授权新设备访问服务器 Git

echo ============================================================
echo  仅授予 Git 拉取和推送权限，不授予服务器终端权限
echo ============================================================
echo.
set /p "PUB=请拖入或输入新设备的 .pub 公钥文件路径: "
set "PUB=%PUB:"=%"
if not exist "%PUB%" (
  echo [失败] 找不到公钥文件：%PUB%
  goto :end
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\grant_manjiao_git_access.ps1" -PublicKeyFile "%PUB%"
if errorlevel 1 (
  echo [失败] 授权没有完成。
) else (
  echo [成功] 新设备已获得受限 Git 权限，可以重新运行接入脚本。
)

:end
echo.
pause
