#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 /path/to/tunnelcode-linux-*.tar.gz" >&2
  exit 2
fi

ARCHIVE="$1"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

tar -xzf "$ARCHIVE" -C "$ROOT"

BIN="$ROOT/tunnelcode"
if [ ! -x "$BIN" ]; then
  echo "missing executable tunnelcode in $ARCHIVE" >&2
  exit 1
fi

"$BIN" --version >/dev/null

if command -v timeout >/dev/null 2>&1 && command -v script >/dev/null 2>&1; then
  LOG="$ROOT/tui.log"
  set +e
  timeout 5s script -q "$LOG" -c "$BIN" >/dev/null 2>&1
  CODE=$?
  set -e
  if grep -E "Failed to initialize OpenTUI|setTerminalEnvVar|Cannot find module|Error loading shared library" "$LOG" >/dev/null 2>&1; then
    cat "$LOG" >&2
    exit 1
  fi
  if [ "$CODE" != "0" ] && [ "$CODE" != "124" ]; then
    cat "$LOG" >&2
    exit "$CODE"
  fi
fi

