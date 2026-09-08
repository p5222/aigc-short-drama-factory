param(
  [string]$CloneTo = "",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\manjiao_git"
)

$ErrorActionPreference = "Stop"
$sshDir = Split-Path -Parent $KeyPath
New-Item -ItemType Directory -Force -Path $sshDir | Out-Null
if (-not (Test-Path $KeyPath)) {
  ssh-keygen -t ed25519 -f $KeyPath -N '""' -C "manjiao-git-$env:COMPUTERNAME"
}

$configPath = Join-Path $sshDir "config"
$marker = "Host manjiao-git"
$config = if (Test-Path $configPath) { Get-Content -Raw $configPath } else { "" }
if ($config -notmatch '(?m)^Host manjiao-git\s*$') {
  Add-Content -Path $configPath -Value "`nHost manjiao-git`n  HostName 43.139.101.102`n  User ubuntu`n  IdentityFile $($KeyPath -replace '\\','/')`n  IdentitiesOnly yes`n"
}

Write-Host "Send this PUBLIC key to the server administrator:"
Get-Content "$KeyPath.pub"

git -c core.sshCommand="ssh -o BatchMode=yes -o ConnectTimeout=8" ls-remote ssh://manjiao-git/opt/git/aigc-short-drama-factory.git refs/heads/main
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not authorized yet. Ask the administrator to run grant_manjiao_git_access.ps1 with this .pub file, then rerun this command."
  exit 2
}
if ($CloneTo) {
  git clone manjiao-git:/opt/git/aigc-short-drama-factory.git $CloneTo
}
Write-Host "MANJIAO_GIT_READY"
