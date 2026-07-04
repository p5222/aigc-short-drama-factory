$ErrorActionPreference = "Continue"

Write-Host "=== AI Film local diagnosis ==="
Write-Host "Workspace: $(Resolve-Path (Join-Path $PSScriptRoot '..'))"

Write-Host "`n[Node / pnpm]"
node -v
npm -v
pnpm --version

Write-Host "`n[Environment files]"
Get-ChildItem (Join-Path $PSScriptRoot "..") -Force -Filter ".env*" | Select-Object Name,Length,LastWriteTime

Write-Host "`n[Docker]"
Get-Service com.docker.service -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType
docker version

Write-Host "`n[Ports]"
foreach ($port in @(4000,5173,5432,6379)) {
  $ok = Test-NetConnection -ComputerName localhost -Port $port -InformationLevel Quiet
  Write-Host "localhost:$port => $ok"
}

Write-Host "`n[HTTP]"
try {
  Invoke-WebRequest -UseBasicParsing http://localhost:4000/health -TimeoutSec 2 | Select-Object StatusCode,Content
} catch {
  Write-Host "API unavailable: $($_.Exception.Message)"
}
try {
  Invoke-WebRequest -UseBasicParsing http://localhost:5173 -TimeoutSec 2 | Select-Object StatusCode
} catch {
  Write-Host "Web unavailable: $($_.Exception.Message)"
}
