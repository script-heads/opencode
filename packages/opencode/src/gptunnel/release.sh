#!/usr/bin/env bash
# release.sh — Сборка и переименование архивов TunnelCode
# Запуск: bash src/gptunnel/release.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "==> Building tunnelcode (single target)..."
bun run script/build.ts -- --single --skip-install

VERSION=$(node -p "require('./package.json').version")
echo "==> Version: $VERSION"

DIST=dist
mkdir -p "$DIST"

echo "==> Renaming archives: opencode-* → tunnelcode-*"
for f in "$DIST"/opencode-*; do
  [ -e "$f" ] || continue
  newname="${f/opencode-/tunnelcode-}"
  mv "$f" "$newname"
  echo "    $f → $newname"
done

echo ""
echo "==> Build complete. Archives in $DIST/:"
ls -lh "$DIST"/tunnelcode-* 2>/dev/null || echo "    (no archives — normal for --single build)"
echo ""
echo "==> Binary:"
find "$DIST" -name tunnelcode -type f | head -5

echo ""
echo "Done! Version $VERSION"
