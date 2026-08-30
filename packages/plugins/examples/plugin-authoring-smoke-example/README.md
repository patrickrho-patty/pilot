# Plugin Authoring Smoke Example

A Pilot plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

## Install Into Pilot

```bash
npx pilotai plugin install ./
```

## Build Options

- `pnpm build` uses esbuild presets from `@pilotai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
