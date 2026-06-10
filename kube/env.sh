#!/bin/bash
# Shared vars for kube scripts. Source from repo root: source kube/env.sh [service]
SERVICE="${1:-tunnelcode}"
REGISTRY="cr.yandex/crptshuuct3ne1mn7rg1"
IMAGE="$REGISTRY/$SERVICE"
VERSION=$(sed -n 's/^[[:space:]]*"version": *"\([^"]*\)".*/\1/p' packages/opencode/package.json | head -1)
BUN_VERSION=$(sed -n 's/^[[:space:]]*"packageManager": *"bun@\([^"]*\)".*/\1/p' package.json | head -1)
