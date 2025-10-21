#!/bin/sh
LOG_DIR="/app/logs"
DATA_DIR="/app/data"

mkdir -p "$LOG_DIR" "$DATA_DIR"
touch "$LOG_DIR/messages.log" "$LOG_DIR/email_messages.log" "$DATA_DIR/state.json" 2>/dev/null || true
chown -R node:node "$LOG_DIR" "$DATA_DIR" 2>/dev/null || true

if [ $# -eq 0 ]; then
  exec node 
else
  exec "$@"
fi