#!/usr/bin/env bash
# upload.sh — Загрузка архивов TunnelCode на сервер gptunnel.ru
# Запуск: bash src/gptunnel/upload.sh [user@server]
set -euo pipefail

cd "$(dirname "$0")/../.."

VERSION=$(node -p "require('./package.json').version")
REMOTE="${1:-deploy@gptunnel.ru}"
REMOTE_DIR="/var/www/gptunnel.ru/releases/v${VERSION}"

echo "==> TunnelCode v${VERSION}"
echo "==> Target: ${REMOTE}:${REMOTE_DIR}"
echo ""

# Collect files to upload
FILES=()
for f in dist/tunnelcode-*.tar.gz dist/tunnelcode-*.zip; do
  [ -e "$f" ] && FILES+=("$f")
done

if [ ${#FILES[@]} -eq 0 ]; then
  echo "No archives found in dist/. Run release.sh first."
  exit 1
fi

echo "==> Files to upload:"
for f in "${FILES[@]}"; do
  ls -lh "$f"
done
echo ""

read -rp "Upload to ${REMOTE}? [y/N] " confirm
case "$confirm" in
  y|Y) ;;
  *)   echo "Cancelled."; exit 0 ;;
esac

echo "==> Creating remote directory..."
ssh "$REMOTE" "mkdir -p $REMOTE_DIR"

echo "==> Uploading archives..."
scp "${FILES[@]}" "${REMOTE}:${REMOTE_DIR}/"

echo "==> Updating latest.txt..."
ssh "$REMOTE" "echo '$VERSION' > /var/www/gptunnel.ru/releases/latest.txt"

echo ""
echo "==> Done! Files uploaded to:"
echo "    https://gptunnel.ru/releases/v${VERSION}/"
echo ""
echo "==> Users can install with:"
echo "    curl -fsSL https://gptunnel.ru/install.sh | bash"
