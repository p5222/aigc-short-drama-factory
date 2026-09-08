param(
  [Parameter(Mandatory = $true)]
  [string]$PublicKeyFile
)

$ErrorActionPreference = "Stop"
$key = (Get-Content -Raw $PublicKeyFile).Trim()
if ($key -notmatch '^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+(?:\s+.*)?$') { throw "Invalid SSH public key." }
$temp = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -Path $temp -Value $key -NoNewline -Encoding ascii
  scp $temp manjiao:/tmp/manjiao_new_git_key.pub
  if ($LASTEXITCODE) { throw "Public key upload failed." }
  scp (Join-Path $PSScriptRoot "..\deploy\grant_git_key.sh") manjiao:/tmp/grant_git_key.sh
  if ($LASTEXITCODE) { throw "Authorization helper upload failed." }
  ssh manjiao "tr -d '\r' < /tmp/grant_git_key.sh > /tmp/grant_git_key_runtime.sh && chmod 700 /tmp/grant_git_key_runtime.sh && /tmp/grant_git_key_runtime.sh /tmp/manjiao_new_git_key.pub"
  if ($LASTEXITCODE) { throw "Server rejected the public key." }
} finally {
  Remove-Item $temp -Force -ErrorAction SilentlyContinue
}
