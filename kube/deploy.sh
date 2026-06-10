#!/bin/bash
set -euo pipefail

source kube/env.sh tunnelcode
BUILD=$DRONE_BUILD_PARENT

echo "Deploy $SERVICE $VERSION build $BUILD"

KUBECONFIG_FILE=$(mktemp)
chmod 600 "$KUBECONFIG_FILE"
trap 'rm -f "$KUBECONFIG_FILE"' EXIT
echo "$KUBE_CONFIG" | base64 -d > "$KUBECONFIG_FILE"

# Concatenate all manifests, substitute the image tag, apply.
awk 'FNR==1{print "---"}{print}' ./kube/manifests/*.yaml | \
  sed "s/_VERSION/$VERSION.$BUILD/g" | \
  kubectl --kubeconfig="$KUBECONFIG_FILE" apply -f -

# Fails the pipeline if the new image cannot be pulled or pods never get ready.
kubectl --kubeconfig="$KUBECONFIG_FILE" rollout status deployment/tunnelcode -n timenote --timeout=300s
