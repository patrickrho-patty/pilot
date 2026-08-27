#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PC_INSTALL_DRIVER="${PC_INSTALL_DRIVER:-source}"

PC_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/paperclip-clean-install.XXXXXX")"
PC_HOME="$PC_TEST_ROOT/home"
PC_CACHE="$PC_TEST_ROOT/npm-cache"
mkdir -p "$PC_HOME" "$PC_CACHE"
trap 'rm -rf "$PC_TEST_ROOT"' EXIT

export HOME="$PC_HOME"
export PILOT_HOME="$PC_HOME/.paperclip"
export npm_config_cache="$PC_CACHE"
export npm_config_userconfig="$PC_HOME/.npmrc"
export PATH="$PC_HOME/.local/bin:$PATH"

if [ "$PC_INSTALL_DRIVER" = "published" ]; then
  (cd "$PC_TEST_ROOT" && npx --yes --registry https://registry.npmjs.org pilotai install)
else
  (cd "$REPO_ROOT" && pnpm paperclipai install --yes)
fi

test -x "$PC_HOME/.local/bin/pilotai"
test -L "$PILOT_HOME/cli/current"
test -f "$PILOT_HOME/cli/install.json"
pilotai --version

mkdir -p "$PILOT_HOME/instances/default"
touch "$PILOT_HOME/instances/default/user-data-marker"
(cd "$REPO_ROOT" && pnpm paperclipai uninstall)

test ! -e "$PILOT_HOME/cli"
test ! -e "$PC_HOME/.local/bin/pilotai"
test -f "$PILOT_HOME/instances/default/user-data-marker"
