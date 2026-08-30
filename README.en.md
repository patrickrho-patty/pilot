<p align="center">
  <img src="doc/assets/pilot-hero.svg" alt="Pilot — control tower for AI-agent companies" width="760"/>
</p>

<p align="center">
  <a href="./README.md">한국어</a>
  &nbsp;·&nbsp;
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="https://patty.io">patty.io</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PATTY-INTERNAL-1769e0.svg?style=flat-square&labelColor=161616" alt="Patty internal"/>
  <img src="https://github.com/patty-io/pilot/actions/workflows/pr.yml/badge.svg" alt="CI"/>
</p>

<h3 align="center">The control plane for running a company of AI agents.</h3>

<p align="center">
  Pilot is the control plane for standing up and operating a company of AI agents.<br/>
  Set goals, hire agents, gate spends and approvals,<br/>
  and track work, cost, and progress from one dashboard.
</p>

## What this repository does

Pilot manages a Node.js server, React UI, CLI, and plugin SDK in a single repository.
All agent-company state — org, issues, budgets, approvals, activity logs — is scoped
to a company, and every mutation lands in an audit trail. The repository includes:

- **server** — Express REST API, heartbeat orchestration, budget hard-stop,
  approval gates, and activity logging: the operational kernel
- **ui** — React + Vite board UI (kanban, issue threads, agent management, cost dashboard)
- **packages/db** — Drizzle schema and migrations (embedded Postgres by default, external DB optional)
- **packages/adapters** — CLI agent adapters for Claude, Codex, Cursor, Gemini, Kimi, pi, and more
- **packages/plugins** — sandbox providers (k8s, Daytona, E2B, Modal, Cloudflare),
  plugin runtime, and SDK
- **packages/skills-catalog · teams-catalog** — app-shipped skill and team catalogs
- **cli** — the `pilotai` CLI (agent-first, JSON in / JSON out)

## Design philosophy

1. **The company is the scope.** Every domain entity belongs to a company, and company
   boundaries are enforced at the route and service levels. Agent keys never reach
   another company.
2. **The heartbeat is the unit of execution.** Agents wake inside short execution
   windows (heartbeats), do work, and schedule the next action on exit. No polling —
   they work continuously.
3. **Approvals are gates.** Governed actions (hiring, budgets, deployments) do not run
   without board approval. Approvals are requested and resolved as interaction cards
   in issue threads.
4. **Budgets are hard stops.** Crossing a budget automatically pauses execution; resume
   only happens through an explicit board action.
5. **Every mutation lands in the activity log.** Mutations record actor, time, and
   context in an audit log.

Read `doc/GOAL.md` and `doc/PRODUCT.md` for product direction, and
`doc/SPEC-implementation.md` for the implementation contract.

## Architecture

```text
 Board operator                  Agents (heartbeats)
      │                                │
      ▼                                ▼
 ┌─────────────────── server ────────────────────┐
 │ REST API (/api) · approval gates · budget     │
 │ heartbeat scheduler · activity log · secrets  │
 └───────┬────────────────────────┬──────────────┘
         │                        │
   ┌─────▼─────┐           ┌─────▼──────────┐
   │ Postgres  │           │ Adapter runtime│
   │ (embedded)│           │ claude·codex·  │
   │ Drizzle   │           │ cursor·gemini· │
   └───────────┘           │ kimi·pi·http   │
                           └─────┬──────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ Sandboxes (k8s·Daytona· │
                    │ E2B·Modal·Cloudflare)   │
                    └─────────────────────────┘

 Clients: ui (React board) · cli (pilotai) · MCP · plugins
```

## Quickstart

Requires [Node.js 24+](https://nodejs.org), [pnpm](https://pnpm.io), and Docker.
Development uses embedded PGlite — no `DATABASE_URL` needed.

```bash
git clone git@github.com:patty-io/pilot.git && cd pilot
pnpm install
pnpm dev
```

The API is at `http://localhost:3100` and the UI is served by the same port
in dev middleware mode.

```bash
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

To reset the local dev database:

```bash
rm -rf data/pglite
pnpm dev
```

## Common commands

| Command | Purpose |
|---|---|
| `pnpm dev` | API + UI dev server |
| `pnpm test` | Vitest unit tests |
| `pnpm test:run` | Full CI test suite |
| `pnpm -r typecheck` | Workspace-wide typecheck |
| `pnpm build` | Full build |
| `pnpm db:generate` | Schema change → migration generation |

## Repository structure

```text
pilot/
├── server/                    Express API + orchestration services
├── ui/                        React + Vite board UI
├── packages/
│   ├── db/                    Drizzle schema, migrations, DB clients
│   ├── shared/                Shared types, constants, validators
│   ├── adapters/              CLI agent adapters (claude, codex, cursor, ...)
│   ├── adapter-utils/         Shared adapter utilities
│   ├── plugins/               Plugin system (SDK, sandbox providers)
│   ├── skills-catalog/        App-shipped skills catalog
│   └── teams-catalog/         App-shipped teams catalog
├── cli/                       pilotai CLI
├── skills/                    Runtime/operational skills
├── deploy/                    Helm charts, EKS deployment
├── doc/                       Product and operations docs
└── releases/                  Release notes
```

## Working order

1. Read the repository rules in [`AGENTS.md`](./AGENTS.md) first.
2. Read docs in order: `doc/GOAL.md` → `doc/PRODUCT.md` → `doc/SPEC-implementation.md` →
   `doc/DEVELOPING.md` → `doc/DATABASE.md`.
3. Schema and API changes follow the contract-sync rules (`AGENTS.md` §5).
4. UI changes must pass the `DESIGN.md` token gate.
5. PRs fill every section of the [template](./.github/PULL_REQUEST_TEMPLATE.md).

## License

Closed source, operated internally. This repository is a Patty internal product.
See [LICENSE-PROPRIETARY.txt](./LICENSE-PROPRIETARY.txt).
