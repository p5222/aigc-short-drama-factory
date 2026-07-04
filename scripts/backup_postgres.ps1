param(
  [string]$ContainerName = "aigc_drama_postgres",
  [string]$Database = "aigc_drama",
  [string]$User = "aigc",
  [string]$OutputDir = "backups"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $root $OutputDir
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$fileName = "$Database`_$stamp.sql"
$targetPath = Join-Path $targetDir $fileName

docker exec $ContainerName pg_dump -U $User $Database | Out-File -FilePath $targetPath -Encoding utf8
Write-Host "Backup written: $targetPath"
