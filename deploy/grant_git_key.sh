#!/usr/bin/env bash
set -euo pipefail

key_file="${1:-/tmp/manjiao_new_git_key.pub}"
key="$(tr -d '\r\n' < "$key_file")"
rm -f "$key_file"
if [[ ! "$key" =~ ^ssh-(ed25519|rsa)[[:space:]][A-Za-z0-9+/=]+([[:space:]].*)?$ ]]; then
  echo "invalid public key" >&2
  exit 2
fi

mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/authorized_keys"
prefix='command="git-shell -c \"$SSH_ORIGINAL_COMMAND\"",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding'
line="$prefix $key"
grep -Fqx "$line" "$HOME/.ssh/authorized_keys" || printf '%s\n' "$line" >> "$HOME/.ssh/authorized_keys"
echo "ACCESS_GRANTED"
