#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PILOT_INSTALL_DRIVER="${PILOT_INSTALL_DRIVER:-source}"

PILOT_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pilot-clean-install.XXXXXX")"
PILOT_HOME="$PILOT_TEST_ROOT/home"
PILOT_CACHE="$PILOT_TEST_ROOT/npm-cache"
mkdir -p "$PILOT_HOME" "$PILOT_CACHE"
trap 'rm -rf "$PILOT_TEST_ROOT"' EXIT

export HOME="$PILOT_HOME"
export PILOT_HOME="$PILOT_HOME/.pilot"
export npm_config_cache="$PILOT_CACHE"
export npm_config_userconfig="$PILOT_HOME/.npmrc"
export PATH="$PILOT_HOME/.local/bin:$PATH"

if [ "$PILOT_INSTALL_DRIVER" = "published" ]; then
  (cd "$PILOT_TEST_ROOT" && npx --yes --registry https://registry.npmjs.org pilotai install)
else
  (cd "$REPO_ROOT" && pnpm pilotai install --yes)
fi

test -x "$PILOT_HOME/.local/bin/pilotai"
test -L "$PILOT_HOME/cli/current"
test -f "$PILOT_HOME/cli/install.json"
pilotai --version

mkdir -p "$PILOT_HOME/instances/default"
touch "$PILOT_HOME/instances/default/user-data-marker"
(cd "$REPO_ROOT" && pnpm pilotai uninstall)

test ! -e "$PILOT_HOME/cli"
test ! -e "$PILOT_HOME/.local/bin/pilotai"
test -f "$PILOT_HOME/instances/default/user-data-marker"
