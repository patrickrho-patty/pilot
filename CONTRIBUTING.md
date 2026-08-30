# Contributing to Pilot

Pilot is a Patty-internal project. This guide gets you from clone to a
merged pull request. If something here is wrong or missing, fix the doc
in the same PR that taught you.

Questions go to the internal dev channel — not GitHub Discussions.

---

## Table of Contents

1. [Before You Open a PR](#before-you-open-a-pr)
2. [Development Setup](#development-setup)
3. [Running the App](#running-the-app)
4. [Running Tests](#running-tests)
5. [Code Style](#code-style)
6. [Commit Messages](#commit-messages)
7. [Making a Pull Request](#making-a-pull-request)
8. [Repository Rules](#repository-rules)
9. [How to Add Common Things](#how-to-add-common-things)

---

## Before You Open a PR

Search [open PRs](https://github.com/patty-io/pilot/pulls) for
duplicates first — agents in this company often work in parallel, and two
branches solving the same thing is waste. Link the closest PR in your
description (or write "none found").

For anything beyond a small fix, talk it over in the internal dev channel
before building. A one-paragraph problem statement costs minutes; a
parallel implementation costs days.

AI-assisted PRs are the norm here — this is an agent company; eat your own
cooking. You own the final code either way: submissions that were clearly
never reviewed may be closed.

We squash-merge. Your PR title becomes the commit subject on `main`, so
write it in [Conventional Commits](https://www.conventionalcommits.org/)
format from the start.

---

## Development Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 24+ | `node -v` to check; use nvm if older |
| pnpm | 9.15+ | `corepack enable` or `npm i -g pnpm` |
| Docker | 24+ | Only needed for sandbox/e2e suites — not unit tests |
| kubectl + AWS CLI | — | Only for deploy work (`deploy/`) |

### First-Time Setup

```bash
git clone git@github.com:patty-io/pilot.git && cd pilot
pnpm install
pnpm dev
```

No `DATABASE_URL` needed — development runs embedded PGlite. The API
starts at `http://localhost:3100` and the UI is served from the same port.

Quick sanity check:

```bash
curl http://localhost:3100/api/health
# {"status":"ok",...}
```

Reset local state:

```bash
rm -rf data/pglite
pnpm dev
```

### Repo Layout

Read [`AGENTS.md`](AGENTS.md) first — it is the authoritative rulebook
(contract-sync rules, control-plane invariants, definition of done).
Then, in order: `doc/GOAL.md` → `doc/PRODUCT.md` →
`doc/SPEC-implementation.md` → `doc/DEVELOPING.md` → `doc/DATABASE.md`.

---

## Running the App

```bash
pnpm dev          # server + UI, watch mode (the default loop)
pnpm dev:server   # server only
pnpm dev:ui       # UI only (Vite)
pnpm storybook    # component workshop for ui/ changes
```

---

## Running Tests

```bash
pnpm test          # vitest suite (the cheap default — run this first)
pnpm -r typecheck  # full workspace typecheck
pnpm build         # full build
```

Browser suites are opt-in (slow, Docker-dependent):

```bash
pnpm test:e2e
pnpm test:release-smoke
```

Run the narrowest check that proves your change. Don't run the whole
suite on every heartbeat when one package's tests cover it. Before
hand-off (or a PR-ready claim), run the full set:

```bash
pnpm -r typecheck && pnpm test:run && pnpm build
```

If something can't be run, say so explicitly in the PR — don't imply it
passed.

---

## Code Style

- **TypeScript strict.** No `any` where a type exists. `pnpm -r typecheck`
  is the gate.
- **Contracts stay synchronized.** Schema/API changes update all layers:
  `packages/db`, `packages/shared`, `server`, `ui` (AGENTS.md §5).
- **Company scoping is invariant.** Every entity belongs to a company;
  routes and services enforce the boundary (AGENTS.md §5.1).
- **Control-plane invariants are load-bearing.** Single-assignee tasks,
  atomic issue checkout, approval gates, budget hard-stop, activity
  logging for mutations (AGENTS.md §5.3).
- **UI changes pass the token gate.** Every color/spacing/radius/type
  value in `ui/src/components` and `ui/src/pages` comes from the token
  layer in `ui/src/index.css`. Run `pnpm check:token-gates` before
  committing UI work. `DESIGN.md` is the source of truth.
- **Write plan docs where the rules say.** Repo plan files live in
  `doc/plans/` with `YYYY-MM-DD-slug.md` names (AGENTS.md §5.5). If a
  Pilot issue asks for a plan, it goes in the issue's plan document —
  not a stray markdown file.

---

## Commit Messages

Conventional Commits, signed:

```
feat(adapters): add kimi-local thinking-level config
fix(heartbeat): stop double-charging budget on resumed runs
docs(rename): record the tier-6 deferral table
refactor(db): extract company-scope guards into shared middleware
```

Sign every commit (`git commit -s`). The DCO check blocks unsigned PRs.

---

## Making a Pull Request

### What a good PR looks like

1. **Focused** — one logical change. Bug fix + refactor = two PRs.
2. **Tested** — new behavior has tests; bug fixes carry a regression
   test. If a test is impractical, say why in the description.
3. **Gated green** — typecheck, tests, and build pass locally before
   push. CI mirrors them.
4. **Contracts synced** — schema or API changes show all four layers
   updated in the same PR.
5. **UI shown** — any `ui/` change includes before/after screenshots
   (or a short recording for interactions) in the description.
6. **Template filled** — every section of
   [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)
   is completed: Thinking Path, What Changed, Verification, Risks, Model
   Used, Checklist.

The **Thinking Path** traces reasoning from the top of the project down
to the change:

> - Pilot is the control plane for AI-agent companies
> - Agents run in heartbeat windows orchestrated by the server
> - A heartbeat that crashes mid-run loses its checkout lock until the reaper runs
> - So checkout release needs to happen in a finally block, not on the success path
> - This PR moves the release into the run teardown for all adapters
> - The benefit is no stale-checkout window between crash and reaper

The **Model Used** section records which AI produced or assisted the
change (provider, model ID, context window). If none: `None —
human-authored`.

### What to expect

- Review happens as capacity allows; focused PRs following this guide
  move fastest.
- Address comments by pushing new commits — don't force-push during
  review.
- Once approved, a maintainer squash-merges.

---

## Repository Rules

These live in [`AGENTS.md`](AGENTS.md) and are enforced by CI:

- `pnpm check:token-gates` — UI token compliance
- `pnpm check:node-version` — Node 24 policy
- PR template completeness — Commitpilot checks
- `pnpm -r typecheck` + `pnpm test:run` — the merge gate

Breaking any AGENTS.md invariant (company scoping, single-assignee,
budget hard-stop, approval gates, activity logging) is a PR-blocker
regardless of what CI catches.

---

## How to Add Common Things

- **New agent adapter** — follow
  [`.agents/skills/create-agent-adapter/SKILL.md`](.agents/skills/create-agent-adapter/SKILL.md)
- **New issue-thread interaction card** — follow
  [`.agents/skills/create-issue-interaction-ui/SKILL.md`](.agents/skills/create-issue-interaction-ui/SKILL.md)
- **New bundled skill** — follow
  [`.agents/skills/create-pilot-bundled-skill/SKILL.md`](.agents/skills/create-pilot-bundled-skill/SKILL.md)
- **New plugin** — follow
  [`.agents/skills/pilot-create-plugin/SKILL.md`](.agents/skills/pilot-create-plugin/SKILL.md)
- **Database migration** — edit `packages/db/src/schema/*.ts`, export new
  tables from `schema/index.ts`, then `pnpm db:generate`. Historical
  migration files are append-only; never edit one that has shipped.

When you add a workflow or surface this guide doesn't cover, extend this
list in the same PR.
