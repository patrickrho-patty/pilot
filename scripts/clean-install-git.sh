#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PILOT_TEST_ROOT="${PILOT_TEST_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/pilot-clean-install-git.XXXXXX")}"
PILOT_HOME="${PILOT_HOME:-$PILOT_TEST_ROOT/home}"
PILOT_CACHE="${PILOT_CACHE:-$PILOT_TEST_ROOT/npm-cache}"
KEEP_TEMP="${KEEP_TEMP:-0}"

cleanup() {
  if [ "$KEEP_TEMP" != "1" ]; then
    rm -rf "$PILOT_TEST_ROOT"
  fi
}
trap cleanup EXIT

mkdir -p "$PILOT_HOME" "$PILOT_CACHE"

echo "REPO_ROOT: $REPO_ROOT"
echo "PILOT_TEST_ROOT: $PILOT_TEST_ROOT"
echo "PILOT_HOME: $PILOT_HOME"

env \
  HOME="$PILOT_HOME" \
  PILOT_HOME="$PILOT_HOME/.pilot" \
  npm_config_cache="$PILOT_CACHE" \
  npm_config_userconfig="$PILOT_HOME/.npmrc" \
  PATH="$PILOT_HOME/.local/bin:$PATH" \
  pnpm --dir "$REPO_ROOT" pilotai install --yes

test -x "$PILOT_HOME/.local/bin/pilotai"
test -L "$PILOT_HOME/.pilot/cli/current"
test -f "$PILOT_HOME/.pilot/cli/install.json"

env HOME="$PILOT_HOME" PILOT_HOME="$PILOT_HOME/.pilot" PATH="$PILOT_HOME/.local/bin:$PATH" pilotai --version
env HOME="$PILOT_HOME" PILOT_HOME="$PILOT_HOME/.pilot" PATH="$PILOT_HOME/.local/bin:$PATH" pilotai doctor \
  --config "$PILOT_TEST_ROOT/missing-config.json" >/dev/null || true

env \
  HOME="$PILOT_HOME" \
  PILOT_HOME="$PILOT_HOME/.pilot" \
  PATH="$PILOT_HOME/.local/bin:$PATH" \
  pnpm --dir "$REPO_ROOT" pilotai uninstall

test ! -e "$PILOT_HOME/.pilot/cli"
test ! -e "$PILOT_HOME/.local/bin/pilotai"
