#!/usr/bin/env bash
set -euo pipefail

unset ELECTRON_RUN_AS_NODE
export CSC_IDENTITY_AUTO_DISCOVERY=false

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PRODUCT_NAME="Habit Grid"
APP_NAME="${PRODUCT_NAME}.app"
DEST="/Applications/${APP_NAME}"
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

quit_if_running

echo "Building…"
npm run package:mac

APP_SRC=""
# Prefer the host architecture when both arm64 and x64 were built.
HOST_ARCH="$(uname -m)"
if [[ "$HOST_ARCH" == "arm64" ]]; then
  PREFERRED=("mac-arm64" "mac" "mac-x64")
else
  PREFERRED=("mac-x64" "mac" "mac-arm64")
fi
for dir in "${PREFERRED[@]}"; do
  candidate="${ROOT}/dist/${dir}/${APP_NAME}"
  if [[ -d "$candidate" ]]; then
    APP_SRC="$candidate"
    break
  fi
done

if [[ -z "$APP_SRC" ]]; then
  echo "Built app not found under dist/. Looked for ${APP_NAME}." >&2
  exit 1
fi

echo "Installing to ${DEST}…"
rm -rf "$DEST"
ditto "$APP_SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true
codesign --force --deep --sign - "$DEST"

if [[ -f "$DEV_DB" && ! -f "$PROD_DB" ]]; then
  mkdir -p "$PROD_DIR"
  cp "$DEV_DB" "$PROD_DB"
  echo "Copied development database to production (first install)."
elif [[ -f "$PROD_DB" ]]; then
  echo "Production database already exists; leaving it unchanged."
else
  echo "No development database found; production will start empty."
fi

echo "Installed ${DEST}"
open -a "$PRODUCT_NAME"
