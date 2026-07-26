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
  ssh manjiao 'set -e; key=$(cat /tmp/manjiao_new_git_key.pub); rm -f /tmp/manjiao_new_git_key.pub; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; line="command=\"git-shell -c \\\"\$SSH_ORIGINAL_COMMAND\\\"\",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding $key"; grep -Fqx "$line" ~/.ssh/authorized_keys || echo "$line" >> ~/.ssh/authorized_keys; echo ACCESS_GRANTED'
} finally {
  Remove-Item $temp -Force -ErrorAction SilentlyContinue
}
