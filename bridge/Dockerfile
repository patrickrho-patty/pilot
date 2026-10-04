# syntax=docker/dockerfile:1.7
#
# Crew–Pilot bridge (PAT-1982). The sidecar that turns Crew mentions into
# Pilot issues and flips the community into pilot mode.
#
# Gateway acks and welcome posts go out through Crew's own CLI, so this image
# carries the `crew` binary copied out of the crew agent-runtime image. That
# binary is what builds the message event and resolves NIP-10 thread roots;
# reimplementing crew_sdk's builder here would duplicate a protocol Crew owns.
#
# Build (CI passes --build-arg CREW_RUNTIME_IMAGE=<published tag>):
#   docker build -f bridge/Dockerfile \
#     --build-arg CREW_RUNTIME_IMAGE=361645878435.dkr.ecr.ap-northeast-2.amazonaws.com/crew-agent-runtime:v0.1.0 .

ARG CREW_RUNTIME_IMAGE=361645878435.dkr.ecr.ap-northeast-2.amazonaws.com/crew-agent-runtime:latest

# `crew` (crew-cli) and `crew-admin` both live in Crew's own images.
FROM ${CREW_RUNTIME_IMAGE} AS crewtools

FROM node:24-trixie-slim AS build
# better-sqlite3 is a native addon: keep a toolchain so the build never depends
# on a prebuild being published for this Node version.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
# pnpm applies patchedDependencies from the root manifest during install.
COPY patches patches
COPY bridge/package.json bridge/
# --ignore-scripts: the workspace root postinstall runs dev-only tooling
# (scripts/link-plugin-dev-sdk.mjs) that a production image must not carry.
# Rebuild just the native addon the bridge actually loads.
RUN pnpm install --filter @pilotai/crew-bridge --frozen-lockfile --ignore-scripts \
    && pnpm rebuild better-sqlite3
COPY bridge bridge
RUN pnpm --filter @pilotai/crew-bridge build \
    && pnpm --filter @pilotai/crew-bridge --prod --ignore-scripts deploy /out

FROM node:24-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    BRIDGE_DB_PATH=/data/bridge.db \
    BRIDGE_PORT=3101 \
    CREW_CLI_PATH=/usr/local/bin/crew
# Reuse the node image's uid/gid 1000; the chart runs the pod as 1000:1000.
RUN mkdir -p /data && chown 1000:1000 /data
COPY --from=crewtools /usr/local/bin/crew /usr/local/bin/crew
COPY --from=build /out /app
USER 1000:1000
EXPOSE 3101
CMD ["node", "dist/index.js"]
