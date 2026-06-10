#!/bin/bash
# upload.sh — локальный фоллбек: сборка и пуш образа дистрибуции без CI.
# Собирает тот же tunnelcode.Dockerfile, что и Drone (один источник правды).
# Запуск: bash src/gptunnel/upload.sh [--push]
#
# Номер билда — timestamp (числовой, монотонный), поэтому локальный релиз
# виден auto-update как более новый и совместим с пиновкой тега в манифесте.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$REPO_ROOT"

source kube/env.sh tunnelcode
BUILD=$(date +%Y%m%d%H%M)
TAG="$VERSION.$BUILD"
# Dockerfile uses RUN --mount=type=cache, which needs BuildKit
export DOCKER_BUILDKIT=1

echo "==> Building ${IMAGE}:${TAG} (local fallback)"

docker build \
  --platform=linux/amd64 \
  --network=host \
  --build-arg BUN_VERSION="$BUN_VERSION" \
  --build-arg TUNNELCODE_BUILD="$BUILD" \
  -f tunnelcode.Dockerfile \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  .

echo ""
echo "==> Build complete: ${IMAGE}:${TAG}"

if [[ "${1:-}" == "--push" ]]; then
  echo "==> Pushing to registry..."
  docker push "${IMAGE}:${TAG}"
  docker push "${IMAGE}:latest"
  echo "==> Push complete!"
  echo ""
  echo "==> Deploy (манифест пинует тег, restart недостаточно):"
  echo "    kubectl set image deployment/tunnelcode tunnelcode=${IMAGE}:${TAG} -n timenote"
else
  echo ""
  echo "==> To push: bash src/gptunnel/upload.sh --push"
  echo "==> To test locally:"
  echo "    docker run -p 8080:80 ${IMAGE}:${TAG}"
  echo "    curl http://localhost:8080/releases/latest.txt"
fi
