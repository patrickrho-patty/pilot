# Apps, Connections, and Integrations

Audience: internal engineers and product contributors working on integrations.

Post-read action: classify a new integration request, pick the right Pilot
layer to change, and avoid creating a parallel connection framework.

## Decision Record

Board decisions from [PIL-13211](/PIL/issues/PIL-13211) make the Apps v2
substrate on the PIL-10341 branch canonical:

- **D1: Apps v2 is the substrate.** The active model is
  `tool_applications`, `tool_connections`, catalog entries, profiles, policy
  rules, action requests, gateway sessions, audit events, and runtime slots.
  Connections v1 is retired as an implementation path.
- **D2: one vault, brokered projections.** Durable third-party credentials live
  in `company_secrets` as secret refs. Adapter config, plugin config, harness
  credential files, and run environments may receive only brokered or projected
  credentials.
- **D3: the vocabulary and three-door IA are product law.** The default product
  doors are Apps, Connections, and Review. Protocol and operator-depth concepts
  live behind Developer or Advanced surfaces.
- **D4: unification lands on PIL-10341.** Pages, CircleBack-style harness MCP
  OAuth, provider gallery work, and plugin-provided integrations converge on
  this branch instead of spawning new integration substrates.
- **D5: inbound stays thin.** External clients that call Pilot use scoped
  Pilot tokens and existing profiles/rules. They do not get a separate
  permission model.

## Canonical Object Model

Use **connection** as the unifying noun. A connection is four things:

1. A stored credential reference.
2. A capability catalog.
3. A governance layer.
4. An audit trail.

Everything else is an axis on that object:

| Axis | Values | It answers |
| --- | --- | --- |
| Direction | outbound, inbound | Who is the client? |
| Transport | MCP, native REST/OpenAPI, OAuth app install, webhook | How do bytes move? |
| Auth mode | OAuth, API key/PAT, app installation, none | What does the secret represent? |
| Credential owner | company, user, run | Whose identity acts? |
| Packaging | catalog entry, plugin, skill | How does it ship? |

MCP is a transport, not a product category. "Install the Discord app",
"connect Google Drive", and "add an MCP endpoint" all produce governed
connections with different transport/auth values.

## Layer Stack

When you are unsure where a change belongs, place it on the narrowest layer that
solves the problem:

| Layer | Owns | Examples |
| --- | --- | --- |
| Surface | user-facing Apps, Connections, Review, Developer/Advanced screens | gallery cards, setup wizard, review queue |
| Governance | profiles, bindings, allow/ask-first/block rules, quarantine, audit | read-only profile, ask-first write policy |
| Capability | action catalogs, schemas, risk classes, changed-tool review | `search_issues`, `create_comment`, schema hash |
| Credential | `company_secrets`, OAuth broker, credential resolver, token broker | Slack bot token ref, Google OAuth refresh token ref |
| Identity | actor attribution and token exchange | board user, agent run, first-party service identity |
| Transport | how the external system is reached | remote HTTP MCP, local stdio, REST/OpenAPI, webhook |

The agent should not hold a durable provider credential. It should hold a
Pilot run/session token; the server or broker resolves the connection,
checks governance, invokes the provider, and writes audit.

## Identity vs. connections

Signing a user *in* and connecting a *resource* are different planes with
different owners, different token profiles, and different homes. Do not merge
them. This section is the public, connections-side statement of the identity
model so connector implementers inherit the rule without depending on private
identity-service documentation or re-deriving it.

| Plane | Question | Lives where | Token profile |
| --- | --- | --- | --- |
| **P1. Sign-in methods** | *Who are you?* | `pilot-id` (id.pilot.test → Account) | Minimal-scope provider tokens (`openid email profile`), used once to authenticate, encrypted at rest, never exported |
| **P2. Connections (Apps)** | *What may your agents touch?* | Pilot App instances (`tool_connections`), acquired via the **connect broker** for hosted + self-hosted | Rich-scope, long-lived resource tokens in the **instance's** encrypted vault; per-agent grants; ask-first on writes |
| **P3. Login with Pilot** | *Who may authenticate against us?* | `pilot-id` OIDC provider + DB-backed client registry | Our ES256 ID/access tokens issued *by* us to registered RPs (instances, the broker, future third parties) |

Everything in `doc/connections/` — the [First-30 matrix](./FIRST-30-MATRIX.md),
the [connector playbook](./CONNECTOR-PLAYBOOK.md), and the connect-broker work —
lives on **plane P2**. It never acquires, stores, or brokers a P1 sign-in token.

### The standing rule (D7)

Adopted as a standing rule (decision D7) with the identity-model plan. State it
verbatim in any P2 design so the app-store work cannot drift into merging the
planes:

> Sign-in tokens are never reused as resource tokens; id.pilot.test never
> stores resource tokens; no connections hub on the ID service.

P2 tokens flow broker → instance vault as pass-through only; the id.pilot.test
Account page therefore must **not** grow a "Connections" hub. The reasons to
hold the planes apart (from the plan §3):

- **Scope discipline.** Sign-in wants the narrowest grant; connections want
  deliberately broad ones. One button that does both is how you grant repo
  access just to log in.
- **Blast radius.** id.pilot.test holding every customer's Vercel/Slack/GitHub
  resource tokens would make it the single juiciest target in the fleet; the
  broker is intentionally pass-through.
- **Self-hosted symmetry.** Instances own their vaults, so self-hosters don't
  depend on our uptime to *use* their own connections.
- **Legibility.** Sign-in and connections answer different user questions, and
  every product we benchmarked (Vercel, Railway, GitHub, Google) keeps them on
  separate pages with separate names.

### Naming alignment

Use the surface-correct name for each plane; they intentionally differ:

| Surface | Plane | Name to use |
| --- | --- | --- |
| Pilot App instances | P2 | **"Connections"** |
| id.pilot.test Account | P1 | **"Ways to sign in"** |
| id.pilot.test admin | P3 | **"OIDC clients"** (until the app store productizes it) |

## Packaging Rule

Default to a **catalog entry** when an integration can be described as metadata:
manifest, auth config, action catalog, resource filters, and policy defaults.

Use a **plugin** only when the integration needs product code such as custom UI
pages, its own tables, workers, migrations, routines, or specialized ingestion.
A plugin may bundle catalog entries, but it must not bypass the connection,
profile, policy, credential, and audit model.

Use a **skill** for agent instructions. Skills may use connections; they must
not own durable tokens.

## Canonical Docs

- [Glossary](./GLOSSARY.md) defines product and internal terms.
- [Identity vs. connections](#identity-vs-connections) is the public statement
  of the P1/P2/P3 boundary and the D7 standing rule for connections work.
- [Security threat model](./SECURITY-THREAT-MODEL.md) harvests the keeper from
  [PIL-2359](/PIL/issues/PIL-2359) and maps it onto Apps v2.
- [First-30 matrix](./FIRST-30-MATRIX.md) harvests the keeper from
  [PIL-2432](/PIL/issues/PIL-2432) and is the source matrix for connector
  playbook work.
- [Connector playbook](./CONNECTOR-PLAYBOOK.md) is the repeatable template for
  adding a vendor as a catalog entry on Apps v2.
- [MCP access governance](../MCP-ACCESS-GOVERNANCE.md) remains the operator
  runbook for the current gateway, profile, policy, approval, runtime, and audit
  APIs.

## Migration Notes

Connections v1 contributed useful policy, UX, and rollout thinking, but its
implementation branch is no longer the target. When you see old tickets or code
using `connections`, `connection_grants`, or a provider-directory mental model,
translate the intent into Apps v2:

| Connections v1 intent | Apps v2 home |
| --- | --- |
| Provider directory | Apps gallery / `tool_applications` |
| Configured provider instance | Connection / `tool_connections` |
| Grant allowlist | Profiles, profile bindings, policies |
| Resource filters | Policy/profile conditions plus provider config |
| Tool broker | Tool gateway and runtime supervisor |
| Connection UX tail | Apps, Connections, Review, Developer/Advanced IA |

Do not add new work to the retired v1 branch. If an old ticket still describes a
valid product gap, retarget it to an active Apps v2 issue or close it as
superseded with a link to the replacement.

## Shared Crew workspace authority

Crew uses the existing Apps v2 resource namespace through an operator-owned
`connection_workspace_bindings` row. Its `company_id` identifies storage; it
does not prove a Pilot subscription and does not require a native Pilot issue,
agent, or heartbeat run. Each row maps an exact Accounts organization, Crew
workspace and community to a trusted HTTPS introspection endpoint. Bindings
default to disabled. A workspace/community pair can belong to only one binding,
including while disabled; rebinding is an explicit operator lifecycle.
`connection_organization_bindings` maps each shared company namespace to exactly
one Accounts organization, and that organization to exactly one namespace.
A composite company/organization foreign key enforces this for every workspace
binding, including concurrent inserts. Multiple Crew workspaces from the same
organization may share the namespace; native Pilot companies need no such row.

`connectionAuthorityService(db).resolveConnectionAuthority(input)` fetches the
current persisted binding, asks its exact endpoint for a fresh verdict, and
returns `{ binding, context }`. Management input supplies `bindingId`, opaque
`token`, `purpose: "management"`, exact `action` and SHA256 `requestDigest`.
Execution input supplies `bindingId`, opaque `token`, `purpose: "execution"`
and the downstream broker action. Caller identities and URLs are rejected.
There is no positive authority cache, and an in-flight disable or rebind also
denies the verdict.

The trusted relay receives only:

```json
{ "schema": "crew.connection-introspection/v1", "token": "opaque-capability" }
```

The strict response is `{ schema: "crew.connection-authority/v1", valid: true,
context }`. A management context has schema `crew.connection-management/v1`,
immutable requester account and pubkey, current `owner|admin|member` role,
verified Nostr `requestId`, exact action and request digest. An execution context
has schema `crew.connection-execution/v1`, requester and agent identity,
enrollment, active generation (at least 1), channel, conversation, turn, immutable
source member IDs and exact audience account IDs. Both contexts carry audience
`patty.connections`, exact organization/workspace/community, and integer UTC
`issuedAt`/`expiresAt` seconds. Lifetime is positive and at most 60 seconds;
future-issued and expired verdicts are denied with exclusive expiry. Extra keys,
mixed purposes, wrong scopes, and mismatched management action/digest deny.

Transport accepts only a canonical HTTPS origin plus the fixed
`/api/connections/introspect` path, with no credentials, query or fragment.
Redirects are refused. The request and streaming response are bounded to 16 KiB
and 64 KiB respectively, and headers plus body have a five-second budget.
The resolver persists neither opaque tokens nor invocation/response payloads,
and errors disclose neither tokens nor upstream bodies. Immutable IDs are bounded
to 256 characters, actions to 128, and each unique nonempty account list to 100
entries. Workspace/community/enrollment/channel/turn IDs are lowercase UUIDs;
pubkeys, event IDs and digests are 64 lowercase hexadecimal characters.

This foundation does not grant owner consent, application availability or tool
permission. Those checks remain separate and must use current Apps v2/vault
records before every resource call. A member verdict is not admin authority.
Execution action permission belongs to the broker; it is not an extra identity
claim sent to the relay. Native Pilot flows retain their existing authorization.

> Sign-in tokens are never reused as resource tokens; id.pilot.test never
> stores resource tokens; no connections hub on the ID service.

See [the implementation contract](../plans/2026-10-08-shared-connections.md)
for storage, exact wire fields, validation evidence and remaining integration
gates. This foundation adds no management route, token issuer, OAuth consent,
provider credential store or automatic binding activation.

### Crew Gmail drafting and sending

The shared Crew execution broker supports Gmail draft list/create/read/update
under an explicit `write` grant and draft sending under a separate `send` grant.
Neither is granted by default. Workspace policy, owner Google consent, current
per-agent access and the Crew tool ceiling must all permit the action. Existing
read-only connections require Google reauthorization for `gmail.compose`;
changing workspace policy alone does not widen their scopes. Patty KB remains
read/search only. These external Crew actions do not change native Pilot review
or ask-first policies.

`connection_mutations` (generated migration `0005_sturdy_maggott.sql`) records
metadata-only operation claims before provider writes. Creation/revision use
operation UUIDs and digests; sending permits one claim per draft. Current draft
message IDs prevent using a stale version, and sending includes the broker-read
raw snapshot. Unknown provider outcomes block automatic replay. Mail contents,
recipients and credentials are not copied into mutation or audit records.
Creation/revision supports bounded complete plain text; unsupported HTML or
attachment drafts are refused before replacement. Live acceptance still requires
the coordinated service/runtime release and owner consent round trip.
