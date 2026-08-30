# CLI Reference

Pilot CLI now supports both:

- installation and lifecycle management (`install`, `uninstall`, `update`, `upgrade`, `service`)
- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Security: safe invocation for content-bearing arguments

Use `npx pilotai` for any command whose argument can hold untrusted or
semi-trusted content. Untrusted content includes issue text, comment bodies,
Markdown, pasted snippets, and model output. `npx` runs the CLI binary directly.
It passes the argument as an inert `argv` value. It does not run a shell over the
value. `npx pilotai` works on any machine with Node: it runs a local install
of the `pilotai` package, and it fetches the published package when no local
install is present.

Do not use `pnpm pilotai` for a content-bearing argument. `pnpm pilotai`
is a `package.json` script. `pnpm` builds a `/bin/sh` command string and appends
the argument to it, so the shell reads the argument first. The shell interprets
these spans before the CLI starts:

- command substitution: a backtick pair or `$( )`
- variable expansion: `$NAME` or `${NAME}` (this can leak a secret value into the persisted argument)

A crafted value can run an arbitrary command as the invoking user. A crafted
value can also expand an environment variable into the stored argument. No
CLI-side check stops this, because the shell runs before `cli/src` starts. This
is true even when the argument comes from a quoted shell variable, because `pnpm`
re-evaluates the value in its own shell.

Safe forms:

- `npx pilotai <command> <args>` — the documented default. It passes an inert
  `argv` value and runs on any machine.
- `node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts <command> <args>` —
  the safe form to run the local source from a monorepo checkout. It is the exact
  command that the `pnpm pilotai` script wraps, but it runs directly, so no
  shell reads the argument. Use it when you must test your local `cli/src`
  changes with a content-bearing argument.

Unsafe or broken forms:

- `pnpm pilotai <command> <args>` — unsafe. `pnpm` runs the argument through a
  shell first.
- `pnpm run <script> -- <args>`, or any `package.json` script that wraps the CLI —
  unsafe for the same reason.
- `pnpm exec pilotai <command> <args>` — broken. The root workspace does not
  depend on the `pilotai` package, so `pnpm` does not link its binary into
  `node_modules/.bin`. The command fails with `Command "pilotai" not found`,
  even after a build. Do not use it.

Static placeholders only: a document must show a static placeholder such as
`<host>` in a command example, never a live `$( )` or `$NAME` span. The reader's
own shell expands such a span on paste, before any CLI or `npx` receives argv, so
a direct-exec form does not stop it.

`pnpm pilotai` stays acceptable only for a fully literal local lifecycle or
setup command. A fully literal command carries no substitutable value. It has no
placeholder, no example value the reader replaces, no interpolation, no path, no
ref, no id, and no name. It holds the subcommand and, at most, flags that take no
value.

The allowlist of literal commands lives in one place:
`server/src/__tests__/cli-invocation-safety.test.ts`. A guard test enforces it
fail-closed. Any `pnpm pilotai` line whose command string is not an exact
allowlist entry is an offender. The allowlist holds commands such as `run`,
`onboard`, `onboard --yes`, `doctor`, `configure --section <name>`, `connect`,
`env-lab up`, `env-lab down`, `context show`, `context list`,
`worktree ensure-seeded`, and `worktree env`.

Every invocation that carries a positional value or an option value uses
`npx pilotai` instead. This covers a hostname (`allowed-hostname`), an import
URL or folder (`company import`), an identifier or secret (`--company-id`,
`--agent-id`, `--claim-secret`), a payload (`--payload-json`), free text
(`--body`, `--title`, `--comment`), a data directory (`--data-dir`), an instance
(`--instance`), a bind preset (`--bind`), a context-profile name, and every
worktree path, ref, id, or name option. A runtime value counts as non-fixed even
when it looks safe. The private-hostname guard builds `allowed-hostname <value>`
from the request Host header, so it uses `npx pilotai`.

For a command that must run the local checked-out source with a value, use the
direct-exec form: `node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts
<command> <args>`.

The `pnpm --filter @pilotai/*` build and test commands are not CLI
invocation. They do not change.

### Offline and air-gapped use

`npx pilotai` runs offline when the `pilotai` package is already in a
local install or in the npm cache. It reaches the network only when the package
is in neither place.

To force cache-only resolution and block any network attempt, run
`npx --offline pilotai <command> <args>`. Use `npx --prefer-offline
pilotai` when you accept a fetch only for a missing package.

To prepare an air-gapped host, install the package one time while the host is
online. Run `npm install -g pilotai`, or run the documented `install.sh`
path. After that step, both `npx pilotai` and the installed `pilotai`
binary run offline. Both pass an inert `argv` value.

To move the package without a registry, run `npm pack pilotai` on an online
host. Copy the tarball to the air-gapped host. Run `npm install -g
./pilotai-<version>.tgz`.

Do not use `pnpm pilotai` as an offline fallback for a content-bearing
argument. It runs the argument through a shell first, offline or online. It also
resolves only inside a monorepo checkout.

A monorepo contributor who works offline uses the direct-exec form that this
section documents above: `node cli/node_modules/tsx/dist/cli.mjs
cli/src/index.ts <command> <args>`. It passes an inert `argv` value and runs the
local source.

## Base Usage

Use repo script in development:

```sh
pnpm pilotai --help
```

Recommended installation and interactive onboarding:

```sh
curl -fsSLO https://pilot.test/install.sh
curl -fsSLO https://pilot.test/install.sh.sha256
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c install.sh.sha256
else
  shasum -a 256 -c install.sh.sha256
fi
bash install.sh
```

The checksum detects transfer or publishing mistakes but is served from the
same origin as the installer. Use a release-tag or commit-pinned GitHub copy
when you need an independently hosted source. Piped installs require supported
Node.js, npm, and npx to already be installed; download the script first before
allowing it to bootstrap Node.js with privileged package-manager commands.

First-time local bootstrap from a source checkout:

```sh
pnpm pilotai run
```

Choose local instance:

```sh
npx pilotai run --instance dev
```

## Install, Update, And Uninstall

Managed installs keep CLI payloads under `~/.pilot/cli`, expose a stable
`~/.local/bin/pilotai` shim, switch versions atomically, and retain two
previous payloads for rollback.

```sh
pilotai install
pilotai install --canary
pilotai install --version <version>
pilotai install --ref <branch|tag|sha> [--repo owner/repo]
pilotai update
pilotai update --latest|--canary|--version <version>
pilotai update --rollback
pilotai upgrade
pilotai uninstall
```

`upgrade` aliases `update`. `uninstall` removes managed code and the shim but
preserves instance data under `~/.pilot/instances/`. See
`doc/INSTALLING.md` for installation methods, security notes, PATH setup, and
the complete update and rollback behavior.

## Onboarding And Service Management

Interactive onboarding offers to install a background service on supported
platforms. `--yes` never installs it implicitly; automation must opt in.

```sh
pilotai onboard
pilotai onboard --yes
pilotai onboard --yes --install-service
pilotai onboard --yes --no-install-service
```

Service lifecycle commands remain under the `service` namespace:

```sh
pilotai service install [--no-start-now] [--no-start-on-login]
pilotai service uninstall
pilotai service start
pilotai service stop
pilotai service restart [--wait]
pilotai service status [--json]
pilotai service logs [-f]
```

Every service verb supports `--instance <id>` and `--json`. Linux and WSL2 use
a systemd user unit when available; macOS uses a LaunchAgent. Unsupported
environments receive foreground `pilotai run` guidance.

`pilotai doctor` includes managed-install and service-health diagnostics in
addition to configuration, storage, database, logging, and port checks.

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `pilotai onboard` and `pilotai configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `pilotai run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `PILOT_DEPLOYMENT_MODE`
- `pilotai run` and `pilotai doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
npx pilotai allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm pilotai env-lab up
pnpm pilotai env-lab doctor
pnpm pilotai env-lab status --json
pnpm pilotai env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

API base resolution order:

1. `--api-base <url>`
2. `PILOT_API_URL`
3. selected context profile `apiBase`
4. local Pilot config server port
5. `http://localhost:3100`

Connection failures include the attempted URL and a `GET /api/health` check hint.

## Connect Wizard

```sh
pnpm pilotai connect
```

`connect` confirms the resolved API base, verifies `GET /api/health`, authenticates board access when needed, and saves a persona-aware profile:

- `persona=board` for board operator profiles
- `persona=agent` with `agentId` and `agentName` for agent profiles

Profiles store token env-var names, not plaintext tokens. The wizard prints shell exports for the newly created token.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.pilot`:

```sh
npx pilotai run --data-dir ./tmp/pilot-dev
npx pilotai issue list --data-dir ./tmp/pilot-dev
```

## Context Profiles

Store local defaults in `~/.pilot/context.json`:

```sh
npx pilotai context set --api-base http://localhost:3100 --company-id <company-id>
npx pilotai context set --persona agent --agent-id <agent-id> --api-key-env-var-name PILOT_API_KEY
pnpm pilotai context show
pnpm pilotai context list
npx pilotai context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
npx pilotai context set --api-key-env-var-name PILOT_API_KEY
export PILOT_API_KEY=...
```

## Company Commands

```sh
npx pilotai company list
npx pilotai company get <company-id>
npx pilotai company current [--company-id <company-id>]
npx pilotai company stats
npx pilotai company create --payload-json '{...}'
npx pilotai company update <company-id> --payload-json '{...}'
npx pilotai company branding:update <company-id> --payload-json '{...}'
npx pilotai company archive <company-id>
npx pilotai company export <company-id> --out ./company --include company,agents,projects,issues,skills
npx pilotai company export:preview <company-id> --payload-json '{...}'
npx pilotai company export:api <company-id> --payload-json '{...}'
npx pilotai company import ./company --target new --new-company-name "Imported Company"
npx pilotai company import:preview <company-id> --payload-json '{...}'
npx pilotai company import:apply <company-id> --payload-json '{...}'
npx pilotai company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
npx pilotai company delete PIL --yes --confirm PIL
npx pilotai company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- With agent authentication, `company list` and `company current` are
  agent-safe company selectors. `company list` first tries the board-wide list;
  if that is forbidden, it uses `--company-id`, `PILOT_COMPANY_ID`, context,
  or `/api/agents/me` and then reads only that scoped company.
- `company create` requires board/instance-admin authentication because it is
  an instance-wide setup command.
- Deletion is server-gated by `PILOT_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `PILOT_COMPANY_ID`), not another company.

## Issue Commands

```sh
npx pilotai issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
npx pilotai issue get <issue-id-or-identifier>
npx pilotai issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
npx pilotai issue update <issue-id> [--status in_progress] [--comment "..."]
npx pilotai issue delete <issue-id> --yes
npx pilotai issue comment <issue-id> --body "..." [--reopen]
npx pilotai issue comments <issue-id> [--limit 50]
npx pilotai issue comment:get <issue-id> <comment-id>
npx pilotai issue comment:delete <issue-id> <comment-id>
npx pilotai issue runs <issue-id-or-identifier>
npx pilotai issue live-runs <issue-id-or-identifier>
npx pilotai issue active-run <issue-id-or-identifier>
npx pilotai issue heartbeat-context <issue-id>
npx pilotai issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
npx pilotai issue release <issue-id>
npx pilotai issue force-release <issue-id>
```

Issue subresources are exposed as Pilot API wrappers. Commands that map to broad server schemas accept JSON payloads and validate them with shared schemas before sending.

```sh
npx pilotai issue child:create <issue-id> --payload-json '{"title":"Child task"}'
npx pilotai issue approvals <issue-id>
npx pilotai issue approval:link <issue-id> <approval-id>
npx pilotai issue approval:unlink <issue-id> <approval-id>
npx pilotai issue read <issue-id>
npx pilotai issue unread <issue-id>
npx pilotai issue archive <issue-id>
npx pilotai issue unarchive <issue-id>
npx pilotai issue recovery-actions <issue-id>
npx pilotai issue recovery:resolve <issue-id> --outcome restored --source-issue-status todo
```

```sh
npx pilotai issue documents <issue-id> [--include-system]
npx pilotai issue document:get <issue-id> <key>
npx pilotai issue document:put <issue-id> <key> --body-file ./plan.md [--title Plan]
npx pilotai issue document:lock <issue-id> <key>
npx pilotai issue document:unlock <issue-id> <key>
npx pilotai issue document:revisions <issue-id> <key>
npx pilotai issue document:restore <issue-id> <key> <revision-id>
npx pilotai issue document:delete <issue-id> <key>
```

```sh
npx pilotai issue work-products <issue-id>
npx pilotai issue work-product:create <issue-id> --payload-json '{"type":"pull_request","provider":"github","title":"PR"}'
npx pilotai issue work-product:update <work-product-id> --payload-json '{"status":"archived"}'
npx pilotai issue work-product:delete <work-product-id>
npx pilotai issue interactions <issue-id>
npx pilotai issue interaction:create <issue-id> --payload-json '{"kind":"request_confirmation","payload":{"version":1,"prompt":"Continue?"}}'
npx pilotai issue interaction:accept <issue-id> <interaction-id> [--selected-client-keys key1,key2]
npx pilotai issue interaction:reject <issue-id> <interaction-id> [--reason "..."]
npx pilotai issue interaction:respond <issue-id> <interaction-id> --answers-json '[{"questionId":"q1","optionIds":["yes"]}]'
npx pilotai issue interaction:cancel <issue-id> <interaction-id> [--reason "..."]
```

```sh
npx pilotai issue tree-state <issue-id>
npx pilotai issue tree-preview <issue-id> --payload-json '{"mode":"pause"}'
npx pilotai issue tree-holds <issue-id> [--status active] [--include-members]
npx pilotai issue tree-hold:create <issue-id> --payload-json '{"mode":"pause","reason":"review"}'
npx pilotai issue tree-hold:get <issue-id> <hold-id>
npx pilotai issue tree-hold:release <issue-id> <hold-id> [--payload-json '{"reason":"done"}']
npx pilotai issue attachments <issue-id>
npx pilotai issue attachment:upload <issue-id> --company-id <company-id> --file ./artifact.txt
npx pilotai issue attachment:download <attachment-id> [--out ./artifact.txt]
npx pilotai issue attachment:delete <attachment-id>
npx pilotai issue label:list --company-id <company-id>
npx pilotai issue label:create --company-id <company-id> --name bug --color '#ff0000'
npx pilotai issue label:delete <label-id>
npx pilotai issue feedback:votes <issue-id>
npx pilotai issue feedback:vote <issue-id> --payload-json '{"targetType":"issue_comment","targetId":"...","vote":"up"}'
```

## Project Commands

```sh
npx pilotai project list --company-id <company-id>
npx pilotai project get <project-id-or-shortname> [--company-id <company-id>]
npx pilotai project create --company-id <company-id> --name "Launch Site" [--goal-ids <id1,id2>] [--lead-agent-id <id>]
npx pilotai project update <project-id-or-shortname> [--status in_progress] [--company-id <company-id>]
npx pilotai project delete <project-id-or-shortname> --yes [--company-id <company-id>]
```

Advanced project fields accept JSON:

```sh
npx pilotai project create --company-id <company-id> --name "Ops" --env-json '{"OPENAI_API_KEY":{"kind":"secret","secretName":"openai-api-key"}}'
npx pilotai project update <project-id> --execution-workspace-policy-json '{"enabled":true,"defaultMode":"shared_workspace"}'
```

## Goal Commands

```sh
npx pilotai goal list --company-id <company-id>
npx pilotai goal get <goal-id>
npx pilotai goal create --company-id <company-id> --title "Grow revenue" [--level company] [--status active]
npx pilotai goal update <goal-id> [--title "..."] [--status achieved]
npx pilotai goal delete <goal-id> --yes
```

## Agent Commands

```sh
npx pilotai agent list --company-id <company-id>
npx pilotai agent get <agent-id>
npx pilotai agent create --company-id <company-id> --payload-json '{"name":"Builder","adapterType":"codex_local"}'
npx pilotai agent hire --company-id <company-id> --payload-json '{...}'
npx pilotai agent update <agent-id> --payload-json '{"title":"Senior Builder"}'
npx pilotai agent delete <agent-id> --yes
npx pilotai agent me
npx pilotai agent inbox
npx pilotai agent inbox-mine --user-id <board-user-id>
npx pilotai agent wake <agent-id-or-shortname> [--company-id <company-id>] [--reason "..."] [--payload '{"issueId":"..."}']
npx pilotai agent pause <agent-id>
npx pilotai agent resume <agent-id>
npx pilotai agent approve <agent-id>
npx pilotai agent terminate <agent-id>
npx pilotai agent heartbeat:invoke <agent-id>
npx pilotai agent claude-login <agent-id>
npx pilotai agent local-cli <agent-id-or-shortname> --company-id <company-id>
```

Agent configuration and runtime endpoints:

```sh
npx pilotai agent permissions:update <agent-id> --payload-json '{"canCreateAgents":true,"canCreateSkills":true,"canAssignTasks":true}'
npx pilotai agent configuration <agent-id>
npx pilotai agent config-revisions <agent-id>
npx pilotai agent config-revision:get <agent-id> <revision-id>
npx pilotai agent config-revision:rollback <agent-id> <revision-id>
npx pilotai agent runtime-state <agent-id>
npx pilotai agent runtime-state:reset-session <agent-id> [--task-key <key>]
npx pilotai agent task-sessions <agent-id>
npx pilotai agent skills <agent-id>
npx pilotai agent skills:sync <agent-id> --desired-skills pilot,github --mode add
npx pilotai agent instructions-path:update <agent-id> --payload-json '{"path":"/path/to/AGENTS.md"}'
npx pilotai agent instructions-bundle <agent-id>
npx pilotai agent instructions-bundle:update <agent-id> --payload-json '{"mode":"managed"}'
npx pilotai agent instructions-file:get <agent-id> --path AGENTS.md
npx pilotai agent instructions-file:put <agent-id> --path AGENTS.md --content-file ./AGENTS.md
npx pilotai agent instructions-file:delete <agent-id> --path AGENTS.md
```

Agent config, instructions, skills, project env, environment, secret, and workspace edits affect the next run. Active runs finish with the config they started with. When a saved session, reused workspace, or sandbox lease no longer matches the effective next-run config, Pilot may start fresh execution and records non-sensitive freshness categories in run result JSON and workspace operation logs.

`agent local-cli` is the quickest way to run local Claude/Codex manually as a Pilot agent:

- creates a new long-lived agent API key
- installs missing Pilot skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `PILOT_API_URL`, `PILOT_COMPANY_ID`, `PILOT_AGENT_ID`, and `PILOT_API_KEY`

Example for shortname-based local setup:

```sh
npx pilotai agent local-cli codexcoder --company-id <company-id>
npx pilotai agent local-cli claudecoder --company-id <company-id>
```

## Token Commands

Agent API keys are scoped to one company and one agent. Plaintext tokens are printed once at creation.

```sh
npx pilotai token agent create --company-id <company-id> --agent <agent-id-or-name> --name external-worker
npx pilotai token agent list --company-id <company-id> --agent <agent-id-or-name>
npx pilotai token agent revoke --company-id <company-id> --agent <agent-id-or-name> <key-id>
```

Named board API keys use the board authorization model, support revocation and expiration metadata, and are audited server-side.

```sh
npx pilotai token board create --company-id <company-id> --name external-admin
npx pilotai token board create --name short-lived --ttl-days 7
npx pilotai token board list
npx pilotai token board revoke <key-id>
```

## Run Commands

`pilotai run` without a subcommand still bootstraps and starts a local Pilot instance. The subcommands below inspect and control API heartbeat runs.

```sh
npx pilotai run list --company-id <company-id> [--agent-id <agent-id>] [--limit 50]
npx pilotai run live --company-id <company-id> [--limit 50] [--min-count 0]
npx pilotai run get <run-id>
npx pilotai run events <run-id> [--after-seq 0] [--limit 200]
npx pilotai run log <run-id> [--offset 0] [--limit-bytes 16384] [--text]
npx pilotai run cancel <run-id>
npx pilotai run issues <run-id>
npx pilotai run workspace-operations <run-id>
npx pilotai run workspace-log <operation-id> [--offset 0] [--limit-bytes 16384] [--text]
npx pilotai run watchdog-decision <run-id> --decision continue [--reason "..."]
```

## Routine Commands

`pilotai routines disable-all` remains the local maintenance command. The singular `routine` group maps to the REST API.

```sh
npx pilotai routine list --company-id <company-id> [--project-id <project-id>]
npx pilotai routine create --company-id <company-id> --payload-json '{...}'
npx pilotai routine get <routine-id>
npx pilotai routine update <routine-id> --payload-json '{...}'
npx pilotai routine revisions <routine-id>
npx pilotai routine revision:restore <routine-id> <revision-id>
npx pilotai routine runs <routine-id> [--limit 50]
npx pilotai routine run <routine-id> [--payload-json '{...}']
npx pilotai routine trigger:create <routine-id> --payload-json '{...}'
npx pilotai routine trigger:update <trigger-id> --payload-json '{...}'
npx pilotai routine trigger:delete <trigger-id>
npx pilotai routine trigger:rotate-secret <trigger-id>
npx pilotai routine trigger:fire <public-id> [--payload-json '{...}']
```

## Prompt Handoff

Prompt handoff creates Pilot work. It does not create a chat session.

```sh
npx pilotai agent-prompt <agent-name-or-id> <agent-api-key> "Prompt here"
npx pilotai agent prompt --agent <agent-name-or-id> --api-key-env PILOT_API_KEY "Prompt here"
npx pilotai agent prompt --profile my-agent "Prompt here"
npx pilotai board prompt --company-id <company-id> --agent <agent-name-or-id> "Prompt here"
```

By default the command creates a `todo` issue assigned to the target agent and wakes the agent. Use `--issue <issue-id>` to add a comment to existing work, and `--no-wake` to skip the wakeup.

## Skills Commands

`pilotai skills` covers three distinct operations:

1. **Company install** — adds or updates a row in `company_skills` for the
   whole company. This is what `skills install`, `skills import`, `skills create`,
   and `skills scan-projects` do.
2. **Agent attach** — merges an agent's *desired* company skill set with an
   explicit `add`, `remove`, or `replace` mode (`skills agent sync`/`clear`).
   This is a desired-state operation on the agent's adapter config; it does not
   change the company library.
3. **Adapter runtime sync** — the adapter reconciles the desired skill set
   with files on disk and reports an `AgentSkillSnapshot` (`skills agent list`).
   `skills agent sync` triggers this automatically after updating desired state.

Required Pilot runtime skills (heartbeat, etc.) remain server-enforced and
are added on top of whatever the desired set names.

Company skill mutations (`skills install`, `skills import`, `skills create`, and
`skills scan-projects`) are open to same-company actors by default. Missing
`skills:create` grants and `canCreateSkills` settings do not deny these commands;
only an explicit company skill policy restriction does. Core safety and company
boundary checks still apply, and `agents:create` remains required when a command
also creates agents.

### Catalog (app-shipped skills)

The Pilot app ships a curated catalog under `@pilotai/skills-catalog`.
Browse and inspect commands never mutate company state; `install` adds a catalog
skill to the company library.

```sh
npx pilotai skills browse [--kind bundled|optional] [--category <slug>] [--query <text>]
npx pilotai skills search "<text>" [--kind bundled|optional] [--category <slug>]
npx pilotai skills inspect <catalog-id-or-key-or-slug>
npx pilotai skills install <catalog-id-or-key-or-slug> [--as <slug>] [--force] --company-id <company-id>
```

Catalog semantics:

- **Bundled** skills live in `packages/skills-catalog/catalog/bundled/<category>/<slug>`
  and are recommended defaults for most companies. They use canonical key
  `pilotai/bundled/<category>/<slug>`.
- **Optional** skills live in `packages/skills-catalog/catalog/optional/<category>/<slug>`
  and are role-specific or domain-specific (browser, AWS ops, etc.). Same key
  shape with `optional` in place of `bundled`.
- `skills install` materializes the catalog files into a company-managed skill
  directory and records provenance (`catalogId`, `catalogKey`, `packageVersion`,
  `originHash`, …) so future updates and audit decisions stay consistent.
- `--as <slug>` overrides the company skill slug. `--force` may replace a
  same-key catalog-managed skill but never bypasses hard validation or hard-stop
  audit findings.

Examples:

```sh
npx pilotai skills browse --kind bundled --company-id <company-id>
npx pilotai skills search "pull request" --kind bundled
npx pilotai skills inspect github-pr-workflow
npx pilotai skills install github-pr-workflow --company-id <company-id>
npx pilotai skills install pilotai:optional:browser:agent-browser --company-id <company-id>
```

External GitHub, skills.sh, local-path, and URL sources still go through
`skills import`; catalog commands are for the app-shipped catalog only.

### Company library

```sh
npx pilotai skills list --company-id <company-id>
npx pilotai skills show <skill-id-or-key-or-slug> --company-id <company-id>
npx pilotai skills file <skill-id-or-key-or-slug> [--path SKILL.md] --company-id <company-id>
npx pilotai skills import <source> --company-id <company-id>
npx pilotai skills create --name "Review PRs" [--slug review-prs] [--description "..."] [--body-file SKILL.md] --company-id <company-id>
npx pilotai skills scan-projects [--project-id <id>...] [--workspace-id <id>...] --company-id <company-id>
npx pilotai skills check [skill-id-or-key-or-slug] --company-id <company-id>
npx pilotai skills update <skill-id-or-key-or-slug> [--force] --company-id <company-id>
npx pilotai skills update --all [--force] --company-id <company-id>
npx pilotai skills audit [skill-id-or-key-or-slug] --company-id <company-id>
npx pilotai skills reset <skill-id-or-key-or-slug> [--yes] [--force] --company-id <company-id>
npx pilotai skills remove <skill-id-or-key-or-slug> --yes --company-id <company-id>
```

`skills import <source>` accepts a skills.sh URL, the equivalent
`<owner>/<repo>/<skill>` shorthand, a GitHub URL, a local path, or an
`npx skills add …` command. See `references/company-skills.md` in the agent
skill bundle for the source-type table.

`skills check`, `skills update`, `skills audit`, and `skills reset` are the
maintenance loop for catalog-installed skills:

- `check` reports whether each skill's installed bytes match its pinned origin
  (`hasUpdate`, `installedHash`, `originHash`, `updateHoldReason`,
  `auditVerdict`).
- `update` installs the pinned update through the existing install-update API.
  `--all` checks every company skill and updates only those with
  `hasUpdate=true`. `--force` discards local-modification or soft-audit holds;
  hard-stop audit findings still block the update.
- `audit` re-scans installed bytes and reports findings without executing
  anything.
- `reset` reinstalls a catalog-managed skill from its pinned origin, discarding
  local edits. Prompts in a TTY; requires `--yes` for non-interactive use.

### Agent attach

```sh
npx pilotai skills agent list <agent-id-or-shortname> --company-id <company-id>
npx pilotai skills agent sync <agent-id-or-shortname> --skill <skill-id-or-key-or-slug> [--skill <skill-id-or-key-or-slug>...] --mode <add|remove|replace> --company-id <company-id>
npx pilotai skills agent clear <agent-id-or-shortname> --yes --company-id <company-id>
```

`skills agent sync` requires a merge mode and returns the resulting adapter
`AgentSkillSnapshot`. `add` preserves all unnamed assignments, `remove` deletes
only named assignments, and `replace` destructively overwrites the complete
non-required desired skill set.
`skills agent clear` sends an empty desired list. Required Pilot skills are
still enforced by the server in both cases.

### Notes

- Skill references accept company skill `id`, canonical `key`, or unique
  `slug`; catalog references accept catalog `id`, `key`, or unique `slug`.
- `skills file` prints raw file content in human mode so it can be piped.
- `skills create --body-file -` reads the skill markdown body from stdin.
- `skills remove`, `skills reset`, and `skills agent clear` prompt in a TTY and
  require `--yes` in non-interactive use.
- `--json` prints the raw API result for each command.

## Teams Commands

`pilotai teams` works with the app-shipped team catalog in
`@pilotai/teams-catalog`. Browse, search, inspect, and file reads do not
change company state. `preview` runs the company import planner, and `install`
imports the catalog team into an existing company.

```sh
npx pilotai teams browse [--kind bundled|optional] [--category <slug>] [--query <text>]
npx pilotai teams search "<text>" [--kind bundled|optional] [--category <slug>]
npx pilotai teams inspect <catalog-id-or-key-or-slug> [--file TEAM.md]
npx pilotai teams preview <catalog-id-or-key-or-slug> --company-id <company-id>
npx pilotai teams install <catalog-id-or-key-or-slug> --company-id <company-id>
```

Preview/install options:

- Under agent authentication, use `pilotai company list --json`,
  `pilotai company current --json`, or `PILOT_COMPANY_ID` to select the
  target company. `company list` falls back to the scoped current company when
  board-wide listing is forbidden. `teams install` creates agents and therefore
  requires board authentication, an `agents:create` grant, or an agent with
  explicit `canCreateAgents` permission.
- `--request-approval-on-forbidden` turns a 403 install denial into a linked
  board approval request instead of a raw failed command; use
  `--approval-issue-id <id>` to attach it to a specific issue. During Pilot
  task runs with `PILOT_TASK_ID` set, this fallback is automatic so
  agent-run walkthroughs leave a pending approval path instead of a raw 403.
- `--target-manager-agent-id <id>` or `--target-manager-slug <slug>` reparents
  catalog root agents under an existing manager.
- `--agent <slug>` and `--selected-file <path>` narrow the import.
- `--collision-strategy rename|skip|replace` controls name/key collisions.
- `--allow-external-sources`, `--allow-unpinned-optional-sources`, and
  `--allow-local-path-sources` explicitly opt into higher-trust source policy.
  Local-path sources are development-only and stay blocked unless that flag is
  passed.

## Secrets Commands

```sh
npx pilotai secrets list --company-id <company-id>
npx pilotai secrets declarations --company-id <company-id> [--include agents,projects] [--kind secret]
npx pilotai secrets create --company-id <company-id> --name anthropic-api-key --value-env ANTHROPIC_API_KEY
npx pilotai secrets link --company-id <company-id> --name prod-stripe-key --provider aws_secrets_manager --external-ref <provider-ref>
npx pilotai secrets doctor --company-id <company-id>
npx pilotai secrets provider-configs --company-id <company-id>
npx pilotai secrets provider-config:create --company-id <company-id> --payload-json '{...}'
npx pilotai secrets provider-config:discovery-preview --company-id <company-id> --payload-json '{...}'
npx pilotai secrets provider-config:get <config-id>
npx pilotai secrets provider-config:update <config-id> --payload-json '{...}'
npx pilotai secrets provider-config:default <config-id>
npx pilotai secrets provider-config:health <config-id>
npx pilotai secrets provider-config:delete <config-id>
npx pilotai secrets remote-import:preview --company-id <company-id> --payload-json '{...}'
npx pilotai secrets remote-import --company-id <company-id> --payload-json '{...}'
npx pilotai secrets migrate-inline-env --company-id <company-id> [--apply]
```

Secret listing and declarations never print secret values. `create` accepts
`--value-env` so shell history does not capture the value. `link` records
provider-owned references without copying the secret value into Pilot.
For AWS-backed secrets, `secrets doctor` reports missing non-secret provider
env and the expected AWS SDK runtime credential source; do not store AWS
bootstrap credentials in Pilot secrets.

Per-company provider vaults (multiple vault instances per provider, default
vault selection, coming-soon GCP/Vault) can be configured from the board UI under
`Company Settings → Secrets → Provider vaults` or through the provider-config CLI
commands above. See the
[secrets deploy guide](../docs/deploy/secrets.md#provider-vaults) and
[API reference](../docs/api/secrets.md#provider-vaults) for the contract.

## Approval Commands

```sh
npx pilotai approval list --company-id <company-id> [--status pending]
npx pilotai approval get <approval-id>
npx pilotai approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
npx pilotai approval approve <approval-id> [--decision-note "..."]
npx pilotai approval reject <approval-id> [--decision-note "..."]
npx pilotai approval request-revision <approval-id> [--decision-note "..."]
npx pilotai approval resubmit <approval-id> [--payload '{"...":"..."}']
npx pilotai approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
npx pilotai activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
npx pilotai activity create --company-id <company-id> --payload-json '{...}'
npx pilotai activity issue <issue-id>
```

## Dashboard Commands

```sh
npx pilotai dashboard get --company-id <company-id>
```

## Org And Agent Config Commands

```sh
npx pilotai whoami
npx pilotai openapi
npx pilotai org get --company-id <company-id>
npx pilotai org svg --company-id <company-id> [--out org.svg]
npx pilotai org png --company-id <company-id> [--out org.png]
npx pilotai agent-config list --company-id <company-id>
```

## Access, Profile, And Instance Commands

```sh
npx pilotai profile session
npx pilotai profile get
npx pilotai profile update --payload-json '{...}'
npx pilotai profile company-user <user-slug> --company-id <company-id>
npx pilotai invite list --company-id <company-id>
npx pilotai invite create --company-id <company-id> --payload-json '{...}'
npx pilotai invite revoke <invite-id>
npx pilotai invite show <token>
npx pilotai invite accept <token> [--payload-json '{...}']
npx pilotai invite onboarding:text <token>
npx pilotai join list --company-id <company-id> [--status pending_approval]
npx pilotai join approve <request-id> --company-id <company-id>
npx pilotai join reject <request-id> --company-id <company-id>
npx pilotai join claim-key <request-id> --claim-secret <secret>
npx pilotai member list --company-id <company-id>
npx pilotai member update <member-id> --company-id <company-id> --payload-json '{...}'
npx pilotai member role-and-grants <member-id> --company-id <company-id> --payload-json '{...}'
npx pilotai member permissions <member-id> --company-id <company-id> --payload-json '{...}'
npx pilotai member archive <member-id> --company-id <company-id> [--payload-json '{...}']
npx pilotai admin user list [--query <text>]
npx pilotai admin user promote <user-id>
npx pilotai admin user demote <user-id>
npx pilotai admin user company-access <user-id>
npx pilotai admin user company-access:update <user-id> --payload-json '{...}'
```

CLI auth challenge endpoints are also exposed for tooling that needs the raw challenge lifecycle:

```sh
npx pilotai auth challenge create --payload-json '{...}'
PILOT_CHALLENGE_SECRET=<challenge-secret> npx pilotai auth challenge get <challenge-id> --token-env PILOT_CHALLENGE_SECRET
PILOT_CHALLENGE_SECRET=<challenge-secret> npx pilotai auth challenge approve <challenge-id> --token-env PILOT_CHALLENGE_SECRET
PILOT_CHALLENGE_SECRET=<challenge-secret> npx pilotai auth challenge cancel <challenge-id> --token-env PILOT_CHALLENGE_SECRET
npx pilotai auth revoke-current
```

`--token <challenge-secret>` is still supported for compatibility, but `--token-env` avoids putting challenge secrets in shell history or process arguments.

## Instance Settings Commands

```sh
npx pilotai instance scheduler-heartbeats
npx pilotai instance settings:general
npx pilotai instance settings:general:update --payload-json '{...}'
npx pilotai instance settings:experimental
npx pilotai instance settings:experimental:update --payload-json '{...}'
npx pilotai instance database-backup
```

Experimental features are opt-in and are provided without compatibility guarantees. They may break, change, or be removed at any time. Use them at your own risk.

```sh
npx pilotai sidebar preferences
npx pilotai sidebar preferences:update --payload-json '{...}'
npx pilotai sidebar project-preferences --company-id <company-id>
npx pilotai sidebar project-preferences:update --company-id <company-id> --payload-json '{...}'
npx pilotai sidebar badges --company-id <company-id>
npx pilotai inbox dismissals --company-id <company-id>
npx pilotai inbox dismiss --company-id <company-id> --payload-json '{"itemKey":"run:<run-id>"}'
npx pilotai board-claim show <token>
npx pilotai board-claim claim <token> [--payload-json '{...}']
npx pilotai openclaw invite-prompt --company-id <company-id> --payload-json '{...}'
npx pilotai available-skill list
npx pilotai available-skill index
npx pilotai available-skill get <skill-name>
npx pilotai llm agent-configuration
npx pilotai llm agent-configuration:adapter <adapter-type>
npx pilotai llm agent-icons
```

Hermes gateway uses the generic invite/join commands above rather than
`openclaw invite-prompt`. Create an agent invite, read
`invite onboarding:text`, submit a join request with
`adapterType: "hermes_gateway"` and `agentDefaultsPayload.apiBaseUrl` /
`agentDefaultsPayload.apiKey`, then approve and claim the key with the `join`
commands. See [HERMES_GATEWAY_ONBOARDING.md](./HERMES_GATEWAY_ONBOARDING.md).

## Adapter, Asset, And Skill Commands

```sh
npx pilotai adapter list
npx pilotai adapter install --payload-json '{"packageName":"@scope/adapter","version":"1.2.3"}'
npx pilotai adapter get <adapter-type>
npx pilotai adapter update <adapter-type> --payload-json '{"disabled":true}'
npx pilotai adapter override <adapter-type> --payload-json '{"paused":true}'
npx pilotai adapter reload <adapter-type>
npx pilotai adapter reinstall <adapter-type>
npx pilotai adapter delete <adapter-type>
npx pilotai adapter config-schema <adapter-type>
npx pilotai adapter ui-parser <adapter-type>
npx pilotai adapter models <adapter-type> --company-id <company-id> [--refresh] [--environment-id <id>]
npx pilotai adapter model-profiles <adapter-type> --company-id <company-id>
npx pilotai adapter detect-model <adapter-type> --company-id <company-id>
npx pilotai adapter test-environment <adapter-type> --company-id <company-id> --payload-json '{...}'
```

```sh
npx pilotai asset image:upload --company-id <company-id> --file ./image.png [--namespace docs] [--alt "..."]
npx pilotai asset logo:upload --company-id <company-id> --file ./logo.svg
npx pilotai asset content <asset-id> --out ./asset.bin
```

```sh
npx pilotai skill list --company-id <company-id>
npx pilotai skill get <skill-id> --company-id <company-id>
npx pilotai skill file <skill-id> --company-id <company-id> [--path SKILL.md]
npx pilotai skill create --company-id <company-id> --payload-json '{...}'
npx pilotai skill file:update <skill-id> --company-id <company-id> --payload-json '{...}'
npx pilotai skill import --company-id <company-id> --payload-json '{"source":"github:owner/repo/path"}'
npx pilotai skill scan-projects --company-id <company-id> --payload-json '{...}'
npx pilotai skill update-status <skill-id> --company-id <company-id>
npx pilotai skill install-update <skill-id> --company-id <company-id>
npx pilotai skill delete <skill-id> --company-id <company-id>
```

## Cost, Finance, And Budget Commands

```sh
npx pilotai cost summary --company-id <company-id>
npx pilotai cost by-agent --company-id <company-id>
npx pilotai cost by-agent-model --company-id <company-id>
npx pilotai cost by-provider --company-id <company-id>
npx pilotai cost by-biller --company-id <company-id>
npx pilotai cost by-project --company-id <company-id>
npx pilotai cost window-spend --company-id <company-id>
npx pilotai cost quota-windows --company-id <company-id>
npx pilotai cost issue <issue-id>
npx pilotai cost event:create --company-id <company-id> --payload-json '{...}'
```

```sh
npx pilotai finance event:create --company-id <company-id> --payload-json '{...}'
npx pilotai finance events --company-id <company-id>
npx pilotai finance summary --company-id <company-id>
npx pilotai finance by-biller --company-id <company-id>
npx pilotai finance by-kind --company-id <company-id>
npx pilotai budget overview --company-id <company-id>
npx pilotai budget policy:upsert --company-id <company-id> --payload-json '{...}'
npx pilotai budget company:update --company-id <company-id> --payload-json '{...}'
npx pilotai budget agent:update <agent-id> --payload-json '{...}'
npx pilotai budget incident:resolve <incident-id> --company-id <company-id> [--payload-json '{...}']
```

## Workspace And Environment Commands

```sh
npx pilotai workspace list --company-id <company-id>
npx pilotai workspace get <execution-workspace-id>
npx pilotai workspace close-readiness <execution-workspace-id>
npx pilotai workspace operations <execution-workspace-id>
npx pilotai workspace update <execution-workspace-id> --payload-json '{...}'
npx pilotai workspace runtime-service <execution-workspace-id> start --payload-json '{...}'
npx pilotai workspace runtime-command <execution-workspace-id> run --payload-json '{...}'
```

```sh
npx pilotai environment list --company-id <company-id>
npx pilotai environment capabilities --company-id <company-id>
npx pilotai environment create --company-id <company-id> --payload-json '{...}'
npx pilotai environment get <environment-id>
npx pilotai environment leases <environment-id>
npx pilotai environment lease <lease-id>
npx pilotai environment update <environment-id> --payload-json '{...}'
npx pilotai environment delete <environment-id>
npx pilotai environment probe <environment-id>
npx pilotai environment probe-config --company-id <company-id> --payload-json '{...}'
```

```sh
npx pilotai project-workspace list <project-id>
npx pilotai project-workspace create <project-id> --payload-json '{...}'
npx pilotai project-workspace update <project-id> <workspace-id> --payload-json '{...}'
npx pilotai project-workspace delete <project-id> <workspace-id>
npx pilotai project-workspace runtime-service <project-id> <workspace-id> restart --payload-json '{...}'
npx pilotai project-workspace runtime-command <project-id> <workspace-id> run --payload-json '{...}'
```

## Plugin Commands

Existing plugin lifecycle commands remain available: `plugin init`, `list`, `install`, `uninstall`, `enable`, `disable`, `inspect`, and `examples`.

```sh
npx pilotai plugin ui-contributions
npx pilotai plugin tools
npx pilotai plugin tool:execute --payload-json '{...}'
npx pilotai plugin health <plugin-id>
npx pilotai plugin logs <plugin-id>
npx pilotai plugin upgrade <plugin-id>
npx pilotai plugin config <plugin-id> --company-id <company-id>
npx pilotai plugin config:set <plugin-id> --company-id <company-id> --payload-json '{"configJson":{...}}'
npx pilotai plugin config:test <plugin-id> --company-id <company-id> --payload-json '{"configJson":{...}}'
npx pilotai plugin jobs <plugin-id>
npx pilotai plugin job:runs <plugin-id> <job-id>
npx pilotai plugin job:trigger <plugin-id> <job-id> [--payload-json '{...}']
npx pilotai plugin webhook <plugin-id> <endpoint-key> [--payload-json '{...}']
npx pilotai plugin dashboard <plugin-id>
npx pilotai plugin bridge:data <plugin-id> --payload-json '{...}'
npx pilotai plugin bridge:action <plugin-id> --payload-json '{...}'
npx pilotai plugin bridge:stream <plugin-id> <channel> [--duration-ms 10000]
npx pilotai plugin data <plugin-id> <key> --payload-json '{...}'
npx pilotai plugin action <plugin-id> <key> --payload-json '{...}'
npx pilotai plugin local-folders <plugin-id> --company-id <company-id>
npx pilotai plugin local-folder:status <plugin-id> <folder-key> --company-id <company-id>
npx pilotai plugin local-folder:validate <plugin-id> <folder-key> --company-id <company-id> [--payload-json '{...}']
npx pilotai plugin local-folder:set <plugin-id> <folder-key> --company-id <company-id> --payload-json '{...}'
```

Feedback traces can be fetched directly by ID when automating export workflows:

```sh
npx pilotai feedback trace <trace-id>
npx pilotai feedback bundle <trace-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
npx pilotai heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Local Pilot data lives under the selected instance root. `PILOT_HOME` chooses the home directory and `PILOT_INSTANCE_ID` chooses the instance.

```text
~/.pilot/                                     # PILOT_HOME
└── instances/
    └── default/                                  # instance root (PILOT_INSTANCE_ID)
        ├── config.json                           # runtime config
        ├── .env                                  # instance env file
        ├── db/                                   # embedded PostgreSQL data
        ├── data/
        │   ├── storage/                          # local_disk uploads
        │   └── backups/                          # automatic DB backups
        ├── logs/
        ├── secrets/
        │   └── master.key                        # local_encrypted master key
        ├── workspaces/                           # default agent workspaces
        ├── projects/                             # project execution workspaces
        ├── companies/                            # per-company adapter homes (e.g. codex-home)
        └── codex-home/                           # per-instance codex home (when not company-scoped)
```

Default paths for the canonical install:

- config: `~/.pilot/instances/default/config.json`
- embedded db: `~/.pilot/instances/default/db`
- logs: `~/.pilot/instances/default/logs`
- storage: `~/.pilot/instances/default/data/storage`
- secrets key: `~/.pilot/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
PILOT_HOME=/custom/home PILOT_INSTANCE_ID=dev pnpm pilotai run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm pilotai configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
