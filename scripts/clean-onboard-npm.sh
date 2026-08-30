#!/bin/bash -ex
export PILOT_TEST_ROOT="$(mktemp -d /tmp/pilot-clean.XXXXXX)"
export PILOT_HOME="$PILOT_TEST_ROOT/home"
export PILOT_CACHE="$PILOT_TEST_ROOT/npm-cache"
export PILOT_DATA="$PILOT_TEST_ROOT/pilot-data"
mkdir -p "$PILOT_HOME" "$PILOT_CACHE" "$PILOT_DATA"
echo "PILOT_TEST_ROOT: $PILOT_TEST_ROOT"
echo "PILOT_HOME: $PILOT_HOME"
cd $PILOT_TEST_ROOT
env HOME="$PILOT_HOME" \
  npm_config_cache="$PILOT_CACHE" \
  npm_config_userconfig="$PILOT_HOME/.npmrc" \
  npx --yes pilotai onboard --yes --data-dir "$PILOT_DATA"