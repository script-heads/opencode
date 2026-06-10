#!/bin/bash
set -euo pipefail
# $1 - service name (tunnelcode).
# Dockerfile must be at repo root: $1.Dockerfile
# Image tag: <package.json version>.<drone build number>, e.g. 1.17.1.42 —
# the same version is baked into latest.txt/binaries via TUNNELCODE_BUILD.
source kube/env.sh "$1"
BUILD=$DRONE_BUILD_NUMBER
# Dockerfile uses RUN --mount=type=cache, which needs BuildKit
export DOCKER_BUILDKIT=1

echo "Building $SERVICE $VERSION build $BUILD"

docker build \
  --platform=linux/amd64 \
  --network=host \
  --build-arg BUN_VERSION="$BUN_VERSION" \
  --build-arg TUNNELCODE_BUILD="$BUILD" \
  -f "$SERVICE.Dockerfile" \
  -t "$IMAGE:$VERSION.$BUILD" \
  .
