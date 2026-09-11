#!/usr/bin/env bash
# Run as the existing deployment user after the private Hub key is generated.
set -euo pipefail
umask 077
key="$(sudo cat /opt/project-hub/config/ssh/id_ed25519.pub)"
[[ "$key" =~ ^ssh-ed25519[[:space:]][A-Za-z0-9+/=]+([[:space:]].*)?$ ]]
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/authorized_keys"
prefix='command="git-shell -c \"$SSH_ORIGINAL_COMMAND\"",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding'
line="$prefix $key"
if ! grep -Fqx "$line" "$HOME/.ssh/authorized_keys"; then
  cp -p "$HOME/.ssh/authorized_keys" "$HOME/.ssh/authorized_keys.before-hub.$(date +%Y%m%d_%H%M%S)"
  printf '%s\n' "$line" >> "$HOME/.ssh/authorized_keys"
fi
echo HUB_GIT_KEY_AUTHORIZED
