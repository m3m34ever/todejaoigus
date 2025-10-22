#!/bin/sh
set -e

# preferred persistent mount (change if you mounted at a different path in Render)
PERSISTENT_DIR="/data"
FALLBACK_DIR="./data"

# choose writable mount if available, otherwise fallback
if [ -d "$PERSISTENT_DIR" ] && [ -w "$PERSISTENT_DIR" ]; then
  MOUNT="$PERSISTENT_DIR"
else
  echo "Warning: $PERSISTENT_DIR not present or not writable — falling back to $FALLBACK_DIR"
  MOUNT="$FALLBACK_DIR"
  # try to create fallback (don't fail the script if it cannot)
  mkdir -p "$FALLBACK_DIR" 2>/dev/null || true
fi

# allow env vars to override; if not set, use chosen mount
: "${STATE_FILE:=$MOUNT/state.json}"
: "${LOG_FILE:=$MOUNT/messages.log}"
: "${EMAIL_LOG_FILE:=$MOUNT/email_messages.log}"

# create parent dirs and files where possible (non-fatal)
mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$LOG_FILE")" "$(dirname "$EMAIL_LOG_FILE")" 2>/dev/null || true
touch "$STATE_FILE" "$LOG_FILE" "$EMAIL_LOG_FILE" 2>/dev/null || true

echo "Using files:"
echo "  STATE_FILE=$STATE_FILE"
echo "  LOG_FILE=$LOG_FILE"
echo "  EMAIL_LOG_FILE=$EMAIL_LOG_FILE"

# run the real command
exec "$@"