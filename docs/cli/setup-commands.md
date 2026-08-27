---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `pilotai run`

One-command bootstrap and start:

```sh
pnpm pilotai run
```

Does:

1. Auto-onboards if config is missing
2. Runs `pilotai doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
npx paperclipai run --instance dev
```

## `pilotai onboard`

Interactive first-time setup:

```sh
pnpm pilotai onboard
```

If Pilot is already configured, rerunning `onboard` keeps the existing config in place. Use `pilotai configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm pilotai onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm pilotai onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Pilot with that setup.

## `pilotai doctor`

Health checks with optional auto-repair:

```sh
pnpm pilotai doctor
pnpm pilotai doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration, including AWS Secrets Manager non-secret env
  config when selected
- Storage configuration
- Missing key files

## `pilotai configure`

Update configuration sections:

```sh
pnpm pilotai configure --section server
pnpm pilotai configure --section secrets
pnpm pilotai configure --section storage
```

`--section secrets` updates the deployment-level provider used as the fallback
for secrets that do not target a specific company vault. Per-company provider
vaults (named instances, default vault selection, multiple vaults per provider,
coming-soon GCP/Vault) live in the board UI under
`Company Settings → Secrets → Provider vaults` and the
`/api/companies/{companyId}/secret-provider-configs` API.

## `pilotai env`

Show resolved environment configuration:

```sh
pnpm pilotai env
```

This now includes bind-oriented deployment settings such as `PILOT_BIND` and `PILOT_BIND_HOST` when configured.

## `pilotai allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
npx paperclipai allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.paperclip/instances/default/config.json` |
| Database | `~/.paperclip/instances/default/db` |
| Logs | `~/.paperclip/instances/default/logs` |
| Storage | `~/.paperclip/instances/default/data/storage` |
| Secrets key | `~/.paperclip/instances/default/secrets/master.key` |

Override with:

```sh
PILOT_HOME=/custom/home PILOT_INSTANCE_ID=dev pnpm pilotai run
```

Or pass `--data-dir` directly on any command:

```sh
npx paperclipai run --data-dir ./tmp/paperclip-dev
npx paperclipai doctor --data-dir ./tmp/paperclip-dev
```
