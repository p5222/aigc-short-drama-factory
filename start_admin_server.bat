@echo off
setlocal
cd /d %~dp0

echo ============================================================
echo AI Film one-click local launcher
echo Frontend: http://localhost:5173
echo Admin:    http://localhost:5173/admin
echo API:      http://localhost:4000/health
echo ============================================================
echo.

set "PNPM_CMD=pnpm"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found in this CMD session. Trying Corepack...
  where corepack >nul 2>nul
  if not errorlevel 1 (
    call corepack enable >nul 2>nul
    call corepack prepare pnpm@11.7.0 --activate >nul 2>nul
  )
  where pnpm >nul 2>nul
  if errorlevel 1 (
    where npm >nul 2>nul
    if errorlevel 1 (
      echo Node.js/npm was not found. Please install Node.js 24 LTS, then run this file again.
      pause
      exit /b 1
    )
    echo Falling back to npx pnpm@11.7.0 for this launch.
    set "PNPM_CMD=npx --yes pnpm@11.7.0"
  )
)

echo [1/6] Starting PostgreSQL and Redis...
docker compose up -d postgres redis
if errorlevel 1 (
  echo.
  echo Docker command failed. Checking whether PostgreSQL and Redis are already reachable...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$okPg=(Test-NetConnection -ComputerName localhost -Port 5432 -InformationLevel Quiet); $okRedis=(Test-NetConnection -ComputerName localhost -Port 6379 -InformationLevel Quiet); if($okPg -and $okRedis){ exit 0 } exit 1"
  if errorlevel 1 (
    echo.
    echo PostgreSQL or Redis is not reachable.
    echo Please fully restart Docker Desktop. If Docker shows "Linux engine" errors, quit Docker Desktop from the tray and open it as administrator, then run this file again.
    pause
    exit /b 1
  )
  echo PostgreSQL and Redis are already reachable. Continuing without Docker control.
)

echo [2/6] Syncing Prisma client and database schema...
call %PNPM_CMD% --filter @aifilm/api db:generate
if errorlevel 1 pause & exit /b 1
call %PNPM_CMD% --filter @aifilm/api db:push
if errorlevel 1 pause & exit /b 1

echo [3/6] Releasing old dev ports 4000 and 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@(4000,5173); Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | ForEach-Object { try { $p=Get-Process -Id $_.OwningProcess -ErrorAction Stop; if ($p.ProcessName -in @('node','pnpm','tsx')) { Stop-Process -Id $p.Id -Force } } catch {} }"

echo [4/6] Starting API service...
if not exist outputs\logs mkdir outputs\logs
start "AIFilm API - http://localhost:4000" cmd /k "cd /d %~dp0 && %PNPM_CMD% --filter @aifilm/api dev"

echo [5/6] Starting Web and Admin service...
start "AIFilm Web - http://localhost:5173" cmd /k "cd /d %~dp0 && %PNPM_CMD% --filter @aifilm/web dev"

echo [6/6] Waiting for services and opening pages...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(90); $okApi=$false; $okWeb=$false; while((Get-Date) -lt $deadline -and (-not($okApi -and $okWeb))) { try { $api=Invoke-WebRequest -UseBasicParsing http://localhost:4000/health -TimeoutSec 3; if($api.StatusCode -lt 500){ $okApi=$true } } catch {}; try { $web=Invoke-WebRequest -UseBasicParsing http://localhost:5173 -TimeoutSec 3; if($web.StatusCode -lt 500){ $okWeb=$true } } catch {}; Start-Sleep -Seconds 2 }; if(-not $okApi){ Write-Host 'API is still starting or failed. Check the AIFilm API window.' }; if(-not $okWeb){ Write-Host 'Web is still starting or failed. Check the AIFilm Web window.' }"
start http://localhost:5173
start http://localhost:5173/admin

echo.
echo Web: http://localhost:5173
echo Admin: http://localhost:5173/admin
echo Backend API: http://localhost:4000/health
echo Dependency check: http://localhost:4000/api/system/health/dependencies
echo Database: postgresql://aigc:aigc@localhost:5432/aigc_drama
echo Redis: redis://localhost:6379
echo Demo login: demo@aifilm.local / demo123456
echo Admin login: admin@aifilm.local / admin123456
echo.
pause
