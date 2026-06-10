# TunnelCode distribution server.
# Stage 1: build release archives for all platforms (bun cross-compile).
# Stage 2: nginx serving docker-dist (archives, latest.txt, install.sh, landing).
#
# BUN_VERSION must satisfy ^<packageManager> from root package.json —
# packages/script asserts this at import time. kube/build.sh passes it
# automatically; the default below is a fallback for manual builds.
ARG BUN_VERSION=1.3.14
FROM oven/bun:${BUN_VERSION} AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends zip unzip git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Native postinstall scripts (tree-sitter-*) spawn `node-gyp` directly and its
# gyp toolchain needs a real node binary; oven/bun ships neither.
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
RUN bun install -g node-gyp
ENV PATH="/root/.bun/bin:${PATH}"
ENV HUSKY=0
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
# RELEASE_FLAGS=--single builds only the current platform (local smoke test).
# TUNNELCODE_BUILD appends a build number to the release version (1.17.1 -> 1.17.1.42)
# so rebuilds of the same upstream version reach users via auto-update.
ARG RELEASE_FLAGS=""
ARG TUNNELCODE_BUILD=""
WORKDIR /app/packages/opencode
RUN bash src/gptunnel/release.sh $RELEASE_FLAGS

FROM nginx:alpine
COPY --from=build /app/packages/opencode/src/gptunnel/docker-dist/ /usr/share/nginx/html/

RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    \
    location / { \
        try_files $uri $uri/ =404; \
        autoindex on; \
    } \
    \
    location ~ \.sh$ { \
        default_type text/plain; \
    } \
    \
    location /releases/ { \
        autoindex on; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
