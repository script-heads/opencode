#!/usr/bin/env bash
# release.sh — Сборка Docker-образа TunnelCode для Kubernetes
# Запуск: bash src/gptunnel/release.sh [--single]
# 
# Флаги:
#   --single  — собрать только для текущей платформы (для локального теста)
#   (без флага) — собрать для всех платформ (linux/darwin/windows x64/arm64)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."

SINGLE_FLAG=""
CHECK_FLAG=""
if [[ "${1:-}" == "--single" ]]; then
  SINGLE_FLAG="--single"
  CHECK_FLAG="--allow-partial"
  echo "==> Building tunnelcode (single target for local testing)..."
else
  echo "==> Building tunnelcode (all platforms for Docker)..."
fi

VERSION=$(bun -p "require('./package.json').version")
# CI passes TUNNELCODE_BUILD so rebuilds of the same upstream version get a
# distinct, auto-update-visible version (latest.txt and binaries get 1.17.1.42).
if [ -n "${TUNNELCODE_BUILD:-}" ]; then
  VERSION="$VERSION.$TUNNELCODE_BUILD"
fi
echo "==> Version: $VERSION"

OPENCODE_VERSION=$VERSION bun run script/build.ts $SINGLE_FLAG

DIST=dist
DOCKER_DIST="$SCRIPT_DIR/docker-dist"

# Очистка и создание структуры docker-dist
rm -rf "$DOCKER_DIST"
mkdir -p "$DOCKER_DIST/releases/v${VERSION}"

echo "==> Renaming archives: opencode-* → tunnelcode-*"
for f in "$DIST"/opencode-*.tar.gz "$DIST"/opencode-*.zip; do
  [ -e "$f" ] || continue
  basename=$(basename "$f")
  newname="${basename/opencode-/tunnelcode-}"
  cp "$f" "$DOCKER_DIST/releases/v${VERSION}/$newname"
  echo "    $basename → releases/v${VERSION}/$newname"
done

# Проверяем, есть ли хоть какие-то архивы
ARCHIVE_COUNT=$(find "$DOCKER_DIST/releases/v${VERSION}" -type f \( -name "*.tar.gz" -o -name "*.zip" \) 2>/dev/null | wc -l | tr -d ' ')

if [ "$ARCHIVE_COUNT" -eq 0 ]; then
  # Для --single режима: создаем архив из бинарника
  echo "==> No archives found, creating from binary..."
  for d in "$DIST"/opencode-*/bin; do
    [ -d "$d" ] || continue
    parent=$(dirname "$d")
    name=$(basename "$parent")
    newname="${name/opencode-/tunnelcode-}"
    
    if [[ "$name" == *linux* ]]; then
      tar -czf "$DOCKER_DIST/releases/v${VERSION}/${newname}.tar.gz" -C "$d" tunnelcode
      echo "    Created ${newname}.tar.gz"
    elif [[ "$name" == *windows* ]]; then
      # Windows: бинарник называется tunnelcode.exe
      if [ -f "$d/tunnelcode.exe" ]; then
        (cd "$d" && zip -q "$DOCKER_DIST/releases/v${VERSION}/${newname}.zip" tunnelcode.exe)
        echo "    Created ${newname}.zip"
      else
        echo "    Skipped ${newname}.zip (no tunnelcode.exe found)"
      fi
    else
      (cd "$d" && zip -q "$DOCKER_DIST/releases/v${VERSION}/${newname}.zip" tunnelcode)
      echo "    Created ${newname}.zip"
    fi
  done
fi

# latest.txt
echo "$VERSION" > "$DOCKER_DIST/releases/latest.txt"
echo "==> Created releases/latest.txt with version $VERSION"

bun run script/gptunnel-release-check.ts --release-dir "$DOCKER_DIST/releases/v${VERSION}" $CHECK_FLAG

# Копируем install.sh, install.ps1 (нативный Windows), index.html и assets
cp "$SCRIPT_DIR/install.sh" "$DOCKER_DIST/"
cp "$SCRIPT_DIR/install.ps1" "$DOCKER_DIST/"
cp "$SCRIPT_DIR/index.html" "$DOCKER_DIST/"
cp -r "$SCRIPT_DIR/assets" "$DOCKER_DIST/"
echo "==> Copied install.sh, install.ps1, index.html and assets/"

echo ""
echo "==> Docker upload directory ready: $DOCKER_DIST"
echo ""
echo "Contents:"
find "$DOCKER_DIST" -type f | sort | while read f; do
  size=$(ls -lh "$f" | awk '{print $5}')
  echo "    $(echo "$f" | sed "s|$DOCKER_DIST/||") ($size)"
done

echo ""
echo "==> Next steps:"
echo "    cd $SCRIPT_DIR"
echo "    bash upload.sh"
echo ""
echo "Done! Version $VERSION"
