param([switch]$SkipGitHub, [switch]$SkipLocalVerify, [switch]$NonInteractive, [switch]$Check, [switch]$Retry)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
if ($SkipGitHub -or $SkipLocalVerify) {
  Write-Error "Bypassing GitHub main or verification is no longer supported. Use pnpm deploy:server."
  exit 2
}
$deployArgs = @()
if ($Check) { $deployArgs += "--check" }
if ($Retry) { $deployArgs += "--retry" }
& pnpm run deploy:server @deployArgs
exit $LASTEXITCODE
