# Multi-agent production patterns: what implements each

Status: **verified against the pinned build — no new capability required**
Ticket: PAT-1990 · Source: `doc/CREW_INTEGRATION.md` §43–§45

## Summary

§44 defines five delegation patterns. All five are already expressible with shipped Pilot surfaces
plus the bridge. This document records which surface implements each, so a deployment configures
patterns instead of building them.

| Pattern | Implemented by | Verified at |
|---|---|---|
| A — Manager decomposes work | `parentId` on issue create, plus batch `children` | `packages/shared/src/validators/issue.ts:479`, `:584` |
| B — Specialist requests peer review | `reviewRequest` + `reviewInteractionId` | `validators/issue.ts:322`, `:607-608` |
| C — Human directly tasks a specialist | Bridge mention path | `bridge/src/service.ts` `handleEvent` |
| D — Routine creates work | Pilot routines API | `POST /api/companies/{companyId}/routines` |
| E — Event creates triage work | Bridge Git routing + awareness digest | `PAT-2008`, `PAT-1989` |

## Pattern A — Manager decomposes work

```text
Human -> Lead Agent -> child issues -> specialist agents -> lead synthesis
```

The lead creates children with `parentId`, or in one call:

```json
{ "parentId": "<lead-issue-id>", "children": [ { "title": "…", "assigneeAgentId": "…" } ] }
```

`children` accepts 1–25 entries per call (`validators/issue.ts:584`), so a decomposition is one
write rather than N.

**Budget attribution is automatic.** Cost rollup walks the issue tree with a recursive CTE over
`parentId` (`server/src/services/costs.ts:150-208`), so a child's spend lands on the lead's issue
without any bridge involvement. `excludeRoot` selects whether the parent's own cost is included.

## Pattern B — Specialist requests peer review

```text
Worker -> Pilot review stage -> Reviewer -> Worker/Human
```

Set on issue update:

```json
{ "reviewRequest": { "instructions": "Verify the SLA clause before this is applied." } }
```

`reviewRequest` is `{ instructions: string }`, 1–20000 characters (`validators/issue.ts:322-324`).
`reviewInteractionId` (`:607`) binds the update to the review interaction, so a decision resolves
against the request that produced it rather than against whatever is newest.

This is the same surface the Maya governance path uses: a review gate is what stops a
`$450 > $100` credit from applying itself (`PAT-2010`).

## Pattern C — Human directly tasks a specialist

The shipped bridge path. A mention in a mapped channel becomes an assigned Pilot issue; the
channel's `projectId` scopes it, and the sender must be in that agent's `allowedSenders`.

## Pattern D — Routine creates work

Pilot owns schedules; the bridge owns the Crew half. Two shapes:

- a Pilot routine files the issue directly, and the employee posts its result back to Crew;
- the bridge's awareness pass (`PAT-1989`) digests channel activity and files it, which is §100's
  awareness loop rather than a schedule of its own.

Initiative governance for the bridge half lives in the mapping (`quietHours`,
`maxProactivePerDay`). Money stays governed by Pilot budgets in both shapes.

## Pattern E — Event creates triage work

`external/Crew event -> gateway -> triage issue -> lead agent -> children`

The bridge routes Crew Git pull requests to the employee who owns the repo (`PAT-2008`), keyed on
the repo coordinate rather than a channel, and files each with a deterministic idempotency key so a
replayed event cannot file a duplicate. The lead then decomposes with Pattern A.

## Context boundaries (§45)

Delegation does not widen information access. Three boundaries hold:

1. **Crew side** — an agent reads only the channels it is a member of. Membership is set at hire
   and removed at offboard.
2. **Pilot side** — the bridge's key is `task_bridge`-scoped to the mapped projects (`PAT-1992`),
   so the gateway cannot write outside them.
3. **Per-agent** — each employee has its own Crew key in Pilot secret custody. A child issue does
   not grant the parent's credentials, and the gateway never posts as an agent (§8.4).

## What a deployment has to configure

Nothing new in code. Per role, per §43.1: name, title, reporting line, capabilities, adapter,
Crew identity, channel membership, tool permissions, budget, heartbeat policy, approval
boundaries, output contract, escalation rule. Patterns A–E are then a matter of which surfaces the
agents use.
