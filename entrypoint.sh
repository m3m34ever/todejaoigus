#!/bin/sh
set -e
mkdir -p /data
mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$LOG_FILE")" "$(dirname "$EMAIL_LOG_FILE")"
touch "$STATE_FILE" "$LOG_FILE" "$EMAIL_LOG_FILE"
chown -R node:node /data 2>/dev/null || true
exec "$@"