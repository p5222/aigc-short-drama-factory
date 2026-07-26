@echo off
REM ASCII-only launcher. Double-click to deploy to manjiao.cloud.
title Deploy to manjiao.cloud
echo ============================================================
echo   Deploy: verify -> commit -> archive -> backup -> upload
echo           -> rebuild -> health check -> auto-rollback
echo   Local typecheck+build must pass before anything is uploaded.
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy_to_manjiao.ps1"
echo.
echo ============================================================
echo   If there is RED text above, screenshot it for Claude.
echo   This window will NOT auto-close.
echo ============================================================
pause
