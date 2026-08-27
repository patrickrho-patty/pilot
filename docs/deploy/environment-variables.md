---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that Pilot uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `PILOT_BIND` | `loopback` | Reachability preset: `loopback`, `lan`, `tailnet`, or `custom` |
| `PILOT_BIND_HOST` | (unset) | Required when `PILOT_BIND=custom` |
| `HOST` | `127.0.0.1` | Legacy host override; prefer `PILOT_BIND` for new setups |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `PILOT_HOME` | `~/.paperclip` | Base directory for all Pilot data |
| `PILOT_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `PILOT_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |
| `PILOT_DEPLOYMENT_EXPOSURE` | `private` | Exposure policy when deployment mode is `authenticated` |
| `PILOT_API_URL` | (auto-derived) | Pilot API base URL. When set externally (e.g., via Kubernetes ConfigMap, load balancer, or reverse proxy), the server preserves the value instead of deriving it from the listen host and port. Useful for deployments where the public-facing URL differs from the local bind address. |
| `PILOT_HIDDEN_SETTINGS` | (unset) | Comma-separated settings surfaces to hide from the UI and floor at the API, for operators hosting Pilot for others (managed cloud, internal shared server). See [Hiding settings surfaces](#hiding-settings-surfaces). |

### Hiding settings surfaces

`PILOT_HIDDEN_SETTINGS` takes keys from the registry in
`packages/shared/src/settings-visibility.ts`:

- Any instance settings page: `instance.profile`, `instance.environments`,
  `instance.access`, `instance.heartbeats`, `instance.experimental`,
  `instance.plugins`, `instance.adapters` — removed from navigation and
  routing (the General page is the settings root and stays visible). Hiding
  `instance.access`, `instance.plugins`, or `instance.adapters` also floors
  their management endpoints with `403 settings_operator_managed`; hiding
  `instance.experimental` floors every experimental toggle write.
- Any Instance → General section: `instance.general.censorUsernameInLogs`,
  `instance.general.keyboardShortcuts`, `instance.general.backupRetention`,
  `instance.general.feedbackDataSharingPreference` (each also rejects
  value-changing writes via `PATCH /api/instance/settings/general`), plus the
  UI-only `instance.general.deploymentStatus` and `instance.general.signOut`.
- Any experimental toggle: `instance.experimental.<flagKey>` (e.g.
  `instance.experimental.enableSmokeLab`) — the card disappears and
  value-changing writes are rejected.

Unknown keys are logged and ignored, so one list can be rolled across a fleet
of mixed app versions. With the variable unset nothing is hidden and behavior
is identical to earlier releases. Hiding a toggle does not change its value;
pair hiding with the desired default where it matters.

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `PILOT_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `PILOT_SECRETS_MASTER_KEY_FILE` | `~/.paperclip/.../secrets/master.key` | Path to key file |
| `PILOT_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `PILOT_AGENT_ID` | Agent's unique ID |
| `PILOT_COMPANY_ID` | Company ID |
| `PILOT_API_URL` | Pilot API base URL (inherits the server-level value; see Server Configuration above) |
| `PILOT_API_KEY` | Short-lived JWT for API auth |
| `PILOT_RUN_ID` | Current heartbeat run ID |
| `PILOT_TASK_ID` | Issue that triggered this wake |
| `PILOT_WAKE_REASON` | Wake trigger reason |
| `PILOT_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `PILOT_APPROVAL_ID` | Resolved approval ID |
| `PILOT_APPROVAL_STATUS` | Approval decision |
| `PILOT_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Code adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex adapter) |
