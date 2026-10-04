# Cross-workspace federation: design decision

Status: **decided — V1 topologies are supported today; federation is deferred with a trigger**
Ticket: PAT-1994 · Source: `doc/CREW_INTEGRATION.md` §67 P2, §104

## The question

§67 P2 lists "Cross-workspace federation" and §104 gives the V1 picture as one deployment stack:
one Crew relay, one Pilot server, one bridge connecting them. This ticket asked for the
multi-company / multi-workspace design.

## What the bridge already supports

The mapping is company-scoped **per channel**, so the data model is already multi-tenant:

```json
"channels": {
  "<channel-uuid>": { "companyId": "<company-a>", "projectId": "<project-a>" },
  "<other-uuid>":   { "companyId": "<company-b>", "projectId": "<project-b>" }
}
```

`BridgeService` files each issue into `channel.companyId` (`bridge/src/service.ts:406`), so one
bridge process can file work into more than one Pilot company.

## The constraint that decides the topology

`PAT-1992` makes the bridge refuse to start unless its Pilot key is `task_bridge`-scoped and
covers every mapped project (`bridge/src/index.ts:129-138`). A `task_bridge` key belongs to
**one company** — its scope is `{ projectIds | parentIssueIds, allowedAssigneeAgentIds }`.

So the multi-company mapping shape is real, but a single bridge cannot exercise it under the
least-privilege rule: one key cannot cover projects in two companies. That is not a bug to route
around. Widening the key to `standard` to make one bridge serve two companies is exactly the
broad-credential outcome §49 and §66 exist to prevent.

## Decision

| Topology | V1 status |
|---|---|
| One community, one company | **Supported.** The shipped shape. |
| One community, several companies | **Supported as one bridge per (community, company).** Same relay, same gateway identity, separate mapping, separate scoped key, separate receipt store. |
| Several communities, one company | **Supported as one bridge per community.** Each community has its own relay URL, gateway identity and 39090 policy head; the Pilot company and its key are shared. |
| One bridge spanning several companies | **Not supported, by design.** Would require a broad key. |
| Cross-community work routing (work raised in community A owned in B) | **Deferred.** See below. |

Running several bridges is a deployment concern, not a code change: the chart already takes
`bridge.*` values, and each instance is a separate release or a separate values file.

## Why cross-community routing is deferred

Cross-community routing needs identity federation, not plumbing:

1. **Which human is which.** A Crew pubkey maps to a Pilot board user today only through the
   mapping file (`users`). Across communities, the same human has a different pubkey per
   community relay. Without a shared IdP there is no way to know that `npub-A` and `npub-B` are
   one person, and guessing from display names is explicitly forbidden (§8.2: "Never infer a
   Pilot agent merely from a display-name substring in production").
2. **Which gateway is speaking.** Each community has its own gateway identity and its own policy
   head. A cross-community issue would be authored by a gateway that is not a member of the
   community it posts into.
3. **Which policy applies.** Retention (`PAT-2007`) and the pilot-mode gate are per community.

§105 already sequences the prerequisite: SSO against a shared OIDC IdP (Keycloak), which both
products support, is listed as post-V2 and "low effort". Identity federation is that work.

## Revisit trigger

**Revisit when a customer operates more than one Crew community against one Pilot company and
asks for a single work queue across them.** Not before: the per-(community, company) bridge
already delivers the operational outcome for every other case, and it does so without widening a
credential.

## How to check the constraint still holds

```sh
# the scope check that forces one key per company
rg -n -A6 'requiredProjects' bridge/src/index.ts

# the key scope shape a task_bridge key may carry
rg -n -A12 'taskBridgeAgentKeyScopeSchema = ' packages/shared/src/validators/agent.ts
```
