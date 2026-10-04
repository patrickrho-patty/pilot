# Crew agent-job protocol: alignment decision

Status: **decided — do not adopt as the production work contract yet**
Ticket: PAT-1993 · Source: `doc/CREW_INTEGRATION.md` §89.3

## The question

§89.3 flagged Crew's agent-job event family as "an interesting future structured
inter-agent/integration surface, but do not make it the only production work contract until the
client-pinned version's payload/handoff semantics are stable and tested."

That ticket asked for a watch. This is the watch result.

## What the surface is now

The family moved. §89.3 did not name kinds, so it was pinned to whatever Crew shipped at the
time. As of Crew `57eac4f4` (`crates/crew-core/src/kind.rs:623`) it is **43000–43999**:

| Kind | Constant | Meaning |
|---|---|---|
| 43001 | `KIND_JOB_REQUEST` | An agent job was requested |
| 43002 | `KIND_JOB_ACCEPTED` | An agent accepted a job request |
| 43003 | `KIND_JOB_PROGRESS` | Progress update for an in-flight job |
| 43004 | `KIND_JOB_RESULT` | Final result of a completed job |
| 43005 | `KIND_JOB_CANCEL` | A job cancellation was requested |
| 43006 | `KIND_JOB_ERROR` | An agent job failed with an error |

The source comment is explicit that this is **not** NIP-90 (`5000–6999`): "Crew requires auth
chains (depth ≤ 3, breadth ≤ 10)". So the family is a Crew-specific protocol with its own
authorization model, not a generic job marketplace.

## Evidence of instability

`docs/remote-agents.md` — the formal specification for how Crew delegates agent execution to a
remote substrate — carries the status marker:

```
`draft`
```

The spec states five invariants (identity fail-closed, no secrets in configuration,
presence-is-status, at-most-one-live-instance, intentional-termination-is-final) and a scoping
rule that "the desktop is **one launcher among many**". A draft that is still naming its own
invariants has not frozen the payload and handoff semantics §89.3 asked us to wait for.

Two concrete consequences if we adopted it now:

1. **Two work contracts.** The bridge already files work as Pilot issues over the mention path,
   which is what every governance control in Pilot hangs off: atomic checkout, budgets,
   approvals, review gates, audit. Agent-job messages would be a second, parallel work contract
   with no checkout and no budget attribution.
2. **Auth-chain coupling.** The 43000 family carries a Crew-specific auth-chain model
   (depth ≤ 3, breadth ≤ 10). Binding Pilot's work contract to it would make Pilot's ingestion
   depend on Crew's authorization internals, which `doc/CREW_INTEGRATION.md` §1 and §6 explicitly
   rule out — the gateway bridges protocol boundaries, it does not become a third source of
   truth.

## Decision

**Keep mention → Pilot issue as the production work contract.** Do not consume the 43000 family
in the bridge.

The awareness loop (`PAT-1989`) and Git routing (`PAT-2008`) already prove the pattern: Crew
surfaces stay Crew surfaces, and everything that becomes *work* becomes a Pilot issue.

## What we do instead of aligning

Nothing in the bridge changes. The watch continues, with a concrete trigger:

**Revisit when all three hold.**

1. `docs/remote-agents.md` leaves `draft` in the pinned Crew build.
2. The 43001–43006 payload shapes are stable across two consecutive pinned releases.
3. A customer asks for agent-to-agent job handoff that the issue/checkout path cannot express —
   i.e. a real requirement, not a protocol that merely exists.

## How to check the trigger

```sh
# 1. has the spec left draft?
rg -n '^`draft`$' docs/remote-agents.md

# 2. did the kind constants or their comments move?
rg -n -A2 'Agent job protocol' crates/crew-core/src/kind.rs
```

Both commands run against the Crew worktree at the pinned revision. If either changes, re-open
PAT-1993 with the new evidence rather than assuming the decision still holds.
