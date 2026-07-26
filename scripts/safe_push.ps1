param(
  [Parameter(Position = 0, Mandatory = $true)]
  [string]$Message
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (git branch --show-current)) { throw "Detached HEAD: switch to a branch first." }
if (git status --porcelain | Select-String '^\?\?') {
  throw "Untracked files found. Add intended new files explicitly, then run this command again."
}

pnpm test
if ($LASTEXITCODE) { throw "Tests failed." }
pnpm typecheck
if ($LASTEXITCODE) { throw "Typecheck failed." }
pnpm build
if ($LASTEXITCODE) { throw "Build failed." }
git diff --check
if ($LASTEXITCODE) { throw "Diff check failed." }

git add -u
if (-not (git diff --cached --quiet)) {
  git commit -m $Message
  if ($LASTEXITCODE) { throw "Commit failed." }
}
git push -u origin HEAD
if ($LASTEXITCODE) { throw "Push failed." }

Write-Host "PUSH_OK $(git rev-parse --short HEAD) $(git branch --show-current)"
