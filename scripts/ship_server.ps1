param([Parameter(Position = 0)][string]$Message = "", [switch]$Check, [switch]$Retry)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
if ($Message) { Write-Host "This command no longer commits automatically. Commit and merge into GitHub main before deploying." }
$deployArgs = @()
if ($Check) { $deployArgs += "--check" }
if ($Retry) { $deployArgs += "--retry" }
& pnpm run deploy:server @deployArgs
exit $LASTEXITCODE
