#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
echo 'Open http://127.0.0.1:4318 in your browser. Press Ctrl+C to stop.'
exec node server.mjs
