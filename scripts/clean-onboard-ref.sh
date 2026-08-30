#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_REF="${1:-HEAD}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/clean-onboard-ref.sh [git-ref]

Examples:
  ./scripts/clean-onboard-ref.sh
  ./scripts/clean-onboard-ref.sh HEAD
  ./scripts/clean-onboard-ref.sh v0.2.7

Environment overrides:
  KEEP_TEMP=1                 Keep the temp directory and detached worktree for debugging
  PILOT_TEST_ROOT=/tmp/custom    Base temp directory to use
  PILOT_DATA=/tmp/data           Pilot data dir to use
  PILOT_HOST=127.0.0.1    Host passed to the onboarded server
  PILOT_PORT=3232         Port passed to the onboarded server

Notes:
  - Defaults to the current committed ref (HEAD), not uncommitted local edits.
  - Creates an isolated temp HOME, npm cache, data dir, and detached git worktree.
EOF
}

if [ $# -gt 1 ]; then
  usage
  exit 1
fi

if [ $# -eq 1 ] && [[ "$1" =~ ^(-h|--help)$ ]]; then
  usage
  exit 0
fi

TARGET_COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify "${TARGET_REF}^{commit}")"

export KEEP_TEMP="${KEEP_TEMP:-0}"
export PILOT_TEST_ROOT="${PILOT_TEST_ROOT:-$(mktemp -d /tmp/pilot-clean-ref.XXXXXX)}"
export PILOT_HOME="${PILOT_HOME:-$PILOT_TEST_ROOT/home}"
export PILOT_CACHE="${PILOT_CACHE:-$PILOT_TEST_ROOT/npm-cache}"
export PILOT_DATA="${PILOT_DATA:-$PILOT_TEST_ROOT/pilot-data}"
export PILOT_REPO="${PILOT_REPO:-$PILOT_TEST_ROOT/repo}"
export PILOT_HOST="${PILOT_HOST:-127.0.0.1}"
export PILOT_PORT="${PILOT_PORT:-3100}"
export PILOT_OPEN_ON_LISTEN="${PILOT_OPEN_ON_LISTEN:-false}"

cleanup() {
  if [ "$KEEP_TEMP" = "1" ]; then
    return
  fi

  git -C "$REPO_ROOT" worktree remove --force "$PILOT_REPO" >/dev/null 2>&1 || true
  rm -rf "$PILOT_TEST_ROOT"
}

trap cleanup EXIT

mkdir -p "$PILOT_HOME" "$PILOT_CACHE" "$PILOT_DATA"

echo "TARGET_REF: $TARGET_REF"
echo "TARGET_COMMIT: $TARGET_COMMIT"
echo "PILOT_TEST_ROOT: $PILOT_TEST_ROOT"
echo "PILOT_HOME: $PILOT_HOME"
echo "PILOT_DATA: $PILOT_DATA"
echo "PILOT_REPO: $PILOT_REPO"
echo "PILOT_HOST: $PILOT_HOST"
echo "PILOT_PORT: $PILOT_PORT"

git -C "$REPO_ROOT" worktree add --detach "$PILOT_REPO" "$TARGET_COMMIT"

cd "$PILOT_REPO"
pnpm install

env \
  HOME="$PILOT_HOME" \
  npm_config_cache="$PILOT_CACHE" \
  npm_config_userconfig="$PILOT_HOME/.npmrc" \
  HOST="$PILOT_HOST" \
  PORT="$PILOT_PORT" \
  PILOT_OPEN_ON_LISTEN="$PILOT_OPEN_ON_LISTEN" \
  pnpm pilotai onboard --yes --data-dir "$PILOT_DATA"
