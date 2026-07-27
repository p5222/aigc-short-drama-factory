param(
  [Parameter(Position = 0, Mandatory = $true)]
  [string]$Message
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if (-not (git branch --show-current)) { throw "Detached HEAD: switch to a branch first." }

pnpm test
if ($LASTEXITCODE) { throw "Tests failed." }
pnpm typecheck
if ($LASTEXITCODE) { throw "Typecheck failed." }
pnpm build
if ($LASTEXITCODE) { throw "Build failed." }
git diff --check
if ($LASTEXITCODE) { throw "Diff check failed." }

# Existing tracked files are included automatically. New files must be staged explicitly.
git add -u
$secretPattern = 'ghp_[A-Za-z0-9]+|github_pat_|sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY'
$addedLines = git diff --cached --unified=0 | Where-Object { $_ -cmatch '^\+(?!\+\+)' }
if ($addedLines -match $secretPattern) { throw "Possible secret found in staged changes." }

git diff --cached --quiet
$stagedDiffExitCode = $LASTEXITCODE
if ($stagedDiffExitCode -gt 1) { throw "Unable to inspect staged changes." }
if ($stagedDiffExitCode -eq 1) {
  git commit -m $Message
  if ($LASTEXITCODE) { throw "Commit failed." }
}

$serverUrl = "ssh://manjiao-git/opt/git/aigc-short-drama-factory.git"
if (-not (git remote get-url server 2>$null)) { git remote add server $serverUrl }
$branch = git branch --show-current
git push -u server "HEAD:$branch"
if ($LASTEXITCODE) { throw "Server branch push failed." }
git push server HEAD:main
if ($LASTEXITCODE) { throw "Server main push or automatic deployment failed." }
$head = git rev-parse HEAD
$deployedLine = git ls-remote server refs/heads/deployed
$deployed = if ($deployedLine) { ($deployedLine -split "\s+")[0] } else { "" }
if ($deployed -ne $head) { throw "Code was pushed, but server deployment did not confirm this commit." }

Write-Host "SHIP_OK $(git rev-parse --short HEAD) - server main deployed"
