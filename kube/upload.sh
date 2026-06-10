#!/bin/bash
set -euo pipefail
# $1 - service/image name (tunnelcode)
source kube/env.sh "$1"
BUILD=$DRONE_BUILD_NUMBER

echo "Uploading $SERVICE $VERSION build $BUILD"

echo "$DOCKER_KEY" | base64 -d | docker login --username json_key --password-stdin cr.yandex

docker tag "$IMAGE:$VERSION.$BUILD" "$IMAGE:latest"
docker push "$IMAGE:$VERSION.$BUILD"
docker push "$IMAGE:latest"
