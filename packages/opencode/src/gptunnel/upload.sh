#!/bin/bash
# build.sh — Сборка Docker-образа TunnelCode
# Запуск: bash src/gptunnel/build.sh [--push]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Получаем версию из package.json
VERSION=$(node -p "require('../../package.json').version")
IMAGE="cr.yandex/crptshuuct3ne1mn7rg1/tunnelcode"
TAG="v${VERSION}"

# Проверяем наличие docker-dist
if [ ! -d "docker-dist" ]; then
  echo "Error: docker-dist not found. Run release.sh first."
  echo "  bash release.sh"
  exit 1
fi

# Проверяем наличие архивов
ARCHIVE_COUNT=$(find docker-dist/releases -type f \( -name "*.tar.gz" -o -name "*.zip" \) 2>/dev/null | wc -l | tr -d ' ')
if [ "$ARCHIVE_COUNT" -eq 0 ]; then
  echo "Error: No release archives found in docker-dist/releases/"
  echo "Run release.sh without --single flag to build all platforms."
  exit 1
fi

echo "==> Building Docker image: ${IMAGE}:${TAG}"
echo "==> Archives included: $ARCHIVE_COUNT"
echo ""

docker build \
  --platform=linux/amd64 \
  --network=host \
  -f opencode.Dockerfile \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  .

echo ""
echo "==> Build complete!"
echo "    ${IMAGE}:${TAG}"
echo "    ${IMAGE}:latest"

if [[ "${1:-}" == "--push" ]]; then
  echo ""
  echo "==> Pushing to registry..."
  docker push "${IMAGE}:${TAG}"
  docker push "${IMAGE}:latest"
  echo "==> Push complete!"
  echo ""
  echo "==> Update deployment:"
  echo "    kubectl set image deployment/tunnelcode tunnelcode=${IMAGE}:${TAG} -n timenote"
else
  echo ""
  echo "==> To push:"
  echo "    docker push ${IMAGE}:${TAG}"
  echo "    docker push ${IMAGE}:latest"
  echo ""
  echo "==> To test locally:"
  echo "    docker run -p 8080:80 ${IMAGE}:${TAG}"
  echo "    curl http://localhost:8080/install.sh"
  echo "    curl http://localhost:8080/releases/latest.txt"
fi