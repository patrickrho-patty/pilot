# Hermes Gateway Adapter Compatibility Shim

`@pilotai/adapter-hermes-gateway` is a deprecated compatibility shim.

Use `@pilotai/hermes-pilot-adapter` for new installs and import gateway
entrypoints from `@pilotai/hermes-pilot-adapter/gateway`. The adapter
type remains `hermes_gateway`; only package ownership changed.

`hermes_gateway` is for an already-running Hermes API server. It does not start
the local Hermes CLI. If Pilot should launch local `hermes chat` as a child
process, use `hermes_local` from `@pilotai/hermes-pilot-adapter`
instead.

The shim preserves the legacy exports for one release:

- `.`
- `./server`
- `./ui`
- `./cli`
- `./ui-parser`

These exports forward to the unified Hermes package. Existing
`@pilotai/adapter-hermes-gateway` plugin installs should continue to load
during the compatibility window, but should migrate to
`@pilotai/hermes-pilot-adapter` before the shim is removed.
