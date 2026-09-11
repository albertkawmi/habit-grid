#!/usr/bin/env bash
set -euo pipefail

PRODUCT_NAME="Habit Grid"
DEV_DB="${HOME}/Library/Application Support/habit-grid/habit-grid.db"
PROD_DIR="${HOME}/Library/Application Support/${PRODUCT_NAME}"
PROD_DB="${PROD_DIR}/habit-grid.db"

quit_if_running() {
  if ! pgrep -x "$PRODUCT_NAME" >/dev/null 2>&1; then
    return
  fi

  echo "Quitting ${PRODUCT_NAME}…"
  osascript -e "tell application \"${PRODUCT_NAME}\" to quit" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    pgrep -x "$PRODUCT_NAME" >/dev/null 2>&1 || return
    sleep 0.25
  done

  echo "Force-quitting ${PRODUCT_NAME}…"
  pkill -x "$PRODUCT_NAME" || true
  sleep 0.5
}

if [[ ! -f "$DEV_DB" ]]; then
  echo "No development database at ${DEV_DB}" >&2
  exit 1
fi

quit_if_running

mkdir -p "$PROD_DIR"
cp "$DEV_DB" "$PROD_DB"
echo "Copied development database to ${PROD_DB}"
