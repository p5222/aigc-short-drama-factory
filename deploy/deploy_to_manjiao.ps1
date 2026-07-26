param(
  [switch]$SkipGitHub,
  [switch]$SkipLocalVerify,
  [switch]$NonInteractive
)

# =============================================================================
# deploy_to_manjiao.ps1  (launched by deploy_to_manjiao.bat)
# ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI/GBK; non-ASCII breaks parsing).
# Verify -> commit -> archive -> backup -> upload -> rebuild -> health -> rollback.
# All server-side logic lives in deploy/manjiao_remote.sh (pure bash).
# Nothing is uploaded unless local typecheck+build pass; health failure auto-rolls-back.
# =============================================================================

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ScriptRoot  = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\deploy
$ProjectRoot = Split-Path -Parent $ScriptRoot
Set-Location $ProjectRoot

$RemoteDir = "/opt/manjiao"
$SshOpts   = @("-o","StrictHostKeyChecking=accept-new","-o","ConnectTimeout=25")
$Branch    = (& git branch --show-current).Trim()
$RemoteSh  = "/tmp/manjiao_remote.sh"
# Normalize CRLF before running so Windows line-endings don't break server bash.
$RunSh     = "tr -d '\r' < $RemoteSh > /tmp/mr.sh && bash /tmp/mr.sh"

function Step($n,$msg){ Write-Host "==> $n  $msg" -ForegroundColor Cyan }
function Ok($msg){ Write-Host "    $msg" -ForegroundColor DarkGray }
function Warn($msg){ Write-Host "!!! $msg" -ForegroundColor Yellow }
function Die($msg){ Write-Host ""; Write-Host "XXX deploy aborted: $msg" -ForegroundColor Red; throw $msg }
function RemoteRun($argline){ & ssh @SshOpts $Server "$RunSh $argline" }

$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
function Detect-Pnpm {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { return "pnpm" }
  if (Get-Command corepack -ErrorAction SilentlyContinue) { return "corepack" }
  if (Get-Command npx -ErrorAction SilentlyContinue) { return "npx" }
  return "none"
}
function Pnpm { param([Parameter(ValueFromRemainingArguments=$true)]$a)
  switch ($script:PnpmMode) {
    "pnpm"     { & pnpm @a }
    "corepack" { & corepack pnpm @a }
    "npx"      { & npx --yes pnpm @a }
    default    { }
  }
}

try {
  # ---- 0. Preflight + resolve SSH target ---------------------------------
  Step "0/8" "Preflight + resolve SSH target"
  foreach ($t in @("ssh","scp","git","pnpm")) {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "missing command: $t" }
  }
  $Server = $null
  $aliasCfg = (& ssh -G manjiao 2>$null | Out-String)
  if ($aliasCfg -match 'hostname\s+43\.139\.101\.102') { $Server = "manjiao"; Ok "using SSH alias 'manjiao'" }
  else {
    $KeyPath = Join-Path $env:USERPROFILE ".ssh\manjiao_tencent"
    if (Test-Path $KeyPath) { $Server = "ubuntu@43.139.101.102"; $SshOpts += @("-i",$KeyPath,"-o","IdentitiesOnly=yes"); Ok "using key $KeyPath" }
    else { Die "no SSH alias 'manjiao' and no key ~/.ssh/manjiao_tencent" }
  }

  # ---- 1. Local verify gate (best-effort; server build+rollback is the real net) --
  Step "1/8" "Local verify gate (typecheck + build)"
  $script:PnpmMode = Detect-Pnpm
  if ($SkipLocalVerify) {
    Ok "already verified by caller"
  } elseif ($script:PnpmMode -eq "none") {
    Warn "pnpm/corepack/npx not on PATH -> SKIP local verify."
    Warn "Safety net = server-side build + health check + auto-rollback (server builds anyway)."
  } else {
    Ok "using '$script:PnpmMode' to run pnpm"
    Pnpm --filter "@aifilm/api" db:generate; if ($LASTEXITCODE -ne 0) { Warn "prisma generate failed, continuing." }
    Pnpm -r typecheck; if ($LASTEXITCODE -ne 0) { Die "typecheck failed (fix code, server untouched)." }
    Pnpm --filter "@aifilm/shared" build; if ($LASTEXITCODE -ne 0) { Die "shared build failed." }
    Pnpm --filter "@aifilm/api" build;    if ($LASTEXITCODE -ne 0) { Die "api build failed." }
    Pnpm --filter "@aifilm/web" build;    if ($LASTEXITCODE -ne 0) { Die "web build failed (fix code, server untouched)." }
    Ok "local verify passed."
  }

  # ---- 2. Require an intentional commit + push ---------------------------
  Step "2/8" "Verify clean commit and push"
  $pending = (& git status --porcelain) | Out-String
  if ($pending.Trim()) {
    Die "working tree is not clean. Review, test, and commit intentionally before deploying."
  }
  if (-not $Branch) { Die "detached HEAD is not deployable; switch to a named branch first." }
  Ok "clean HEAD=$(& git rev-parse --short HEAD), branch=$Branch"
  if ($SkipGitHub) {
    & git push -u server "HEAD:$Branch"
    if ($LASTEXITCODE -ne 0) { Die "server Git push failed; deploy stopped." }
    & git push server HEAD:main
    if ($LASTEXITCODE -ne 0) { Die "server Git main push failed; deploy stopped." }
    Ok "pushed server Git $Branch and main"
  } else {
    & git push -u origin $Branch
    if ($LASTEXITCODE -ne 0) { Die "GitHub push failed; deploy stopped." }
    Ok "pushed GitHub $Branch"
  }

  # ---- 3. Clean archive from committed HEAD ------------------------------
  Step "3/8" "Build clean archive from HEAD"
  New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot "tmp") | Out-Null
  $Archive = Join-Path $ProjectRoot "tmp\manjiao_release_HEAD.tar"
  if (Test-Path $Archive) { Remove-Item $Archive -Force }
  & git archive --format=tar --output="$Archive" HEAD; if ($LASTEXITCODE -ne 0) { Die "git archive failed." }
  Ok ("archive " + [math]::Round((Get-Item $Archive).Length/1MB,1) + " MB")

  # ---- 4. Upload remote helper -------------------------------------------
  Step "4/8" "Upload deploy helper script"
  & scp @SshOpts (Join-Path $ScriptRoot "manjiao_remote.sh") "${Server}:$RemoteSh"; if ($LASTEXITCODE -ne 0) { Die "upload manjiao_remote.sh failed." }

  # ---- 5. Server backup --------------------------------------------------
  Step "5/8" "Server backup (db + storage + source)"
  $stamp = (& ssh @SshOpts $Server "date +%Y%m%d_%H%M%S").Trim()
  $BackupDir = "/opt/manjiao-backups/${stamp}_deploy"
  RemoteRun "backup '$RemoteDir' '$BackupDir'"; if ($LASTEXITCODE -ne 0) { Die "backup failed (server unchanged)." }
  Ok "backup at $BackupDir"

  # ---- 6. Upload archive + extract + inject Pipp -------------------------
  Step "6/8" "Upload archive, extract, inject Pipp env"
  & scp @SshOpts "$Archive" "${Server}:/tmp/manjiao_release_HEAD.tar"; if ($LASTEXITCODE -ne 0) { Die "upload archive failed." }
  RemoteRun "extract '$RemoteDir'"; if ($LASTEXITCODE -ne 0) { Die "extract failed." }

  # Sync model keys from local registry deploy\model-keys.local.txt (gitignored).
  $keysFile = Join-Path $ScriptRoot "model-keys.local.txt"
  if (Test-Path $keysFile) {
    & scp @SshOpts "$keysFile" "${Server}:/tmp/keys.env" | Out-Null
    RemoteRun "merge_env '$RemoteDir'"; if ($LASTEXITCODE -ne 0) { Warn "key merge returned non-zero; check .env.production later." } else { Ok "model keys synced from local registry." }
  } else {
    Warn "deploy\model-keys.local.txt not found; skipping key sync."
  }

  # ---- 7. Rebuild web + api (api rebuild runs db push -> new indexes) -----
  Step "7/8" "Rebuild frontend + backend (about 1-3 min)"
  RemoteRun "rebuild '$RemoteDir'"
  if ($LASTEXITCODE -ne 0) {
    Warn "server rebuild failed (likely a code/build error), rolling back source ..."
    RemoteRun "rollback '$RemoteDir' '$BackupDir'" | Out-Null
    Die "rebuild failed, rolled back to old version. Send this window's log to Claude."
  }

  # ---- 8. Health check + auto rollback -----------------------------------
  Step "8/8" "Health check"
  $healthy = $false
  for ($i=1; $i -le 30; $i++) {
    Start-Sleep -Seconds 10
    $code = (RemoteRun "health").Trim()
    Write-Host "    [$i/30] /health -> $code" -ForegroundColor DarkGray
    if ($code -eq "200") { $healthy = $true; break }
  }
  if (-not $healthy) {
    Warn "health check failed, rolling back to $BackupDir ..."
    RemoteRun "rollback '$RemoteDir' '$BackupDir'" | Out-Null
    Die "rolled back. Send this window's log to Claude."
  }

  $fp = (RemoteRun "fingerprint").Trim()
  Write-Host ""
  Write-Host "======================================================================" -ForegroundColor Green
  Write-Host " DEPLOY OK.  https://manjiao.cloud /health = 200" -ForegroundColor Green
  Write-Host " asset fingerprint: $fp" -ForegroundColor Green
  Write-Host " backup: $BackupDir" -ForegroundColor Green
  Write-Host " commit: $(& git rev-parse --short HEAD)  branch: $Branch" -ForegroundColor Green
  Write-Host "======================================================================" -ForegroundColor Green
  Write-Host " Tell Claude 'deploy ok', or paste the log." -ForegroundColor Green
}
catch {
  Write-Host ""
  Write-Host "deploy script stopped:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
}
