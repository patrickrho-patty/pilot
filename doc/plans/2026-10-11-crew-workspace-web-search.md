# Crew workspace web search

Date: 2026-10-11 (Asia/Seoul).

## Product behavior

The workspace admin activates **Web search / 웹 검색** once. All agents can then
search public information using the company Serper credential. Existing agents
need no configuration migration or per-agent tool selection. Members have no
account connection or agent-access task for this service. The admin can disable
it in the same control; subsequent searches fail closed.

This uses the existing Crew Connections management and execution surfaces. It
adds no service, process per member, database migration, or HTTP route. Native
Pilot work authorization and personal Gmail/KB account flows retain their own
authority, consent and permission requirements.

## Server-owned configuration

- Registry app: `web-search`; action: `search`.
- MCP tool: `connections_web_search`; qualified runtime name:
  `dev__connections_web_search`; broker action: `web-search.search`.
- Vault: active company-scoped, `local_encrypted` secret with canonical key
  `crew_serper_api_key`, pinned to its current active version. There is no runtime
  environment-key fallback or caller-supplied credential.
- Workspace policy: `connection_availability`, scoped to the exact binding.
  Activation requires current owner/admin authority and a usable server credential.
  Missing/revoked credentials report `requires-setup`; disabling remains possible.
- Platform approvals: the tool must appear in the approved runtime profile,
  MCP server registry and managed tool ceiling. Mirr projections additionally
  require the operator-owned tool schema. These are operator configuration;
  customers do not edit tool IDs.

## Authority and provider boundary

The new strict execution schema is `crew.connection-workspace-execution/v1`.
It carries audience `patty.connections`, exact organization/workspace/community,
requester account/pubkey, agent pubkey, enrollment, generation, channel,
conversation, turn, one source member account and a positive lifetime of at most
60 seconds. It has no `audienceAccountIds` property. Only `web-search.search`
accepts this schema; personal execution authority cannot be substituted for it.

Crew derives identity from current custody, runtime grants, the claimed dispatch
journal and current Accounts/channel membership. No model can choose a requester.
Distinct joined human sources are rejected. Pilot re-introspects the trusted Crew
endpoint with no positive authority cache, then checks the exact workspace flag
and credential version before provider I/O and before returning a result.

The fixed direct-TLS endpoint is `https://google.serper.dev/search`. Arguments are
strict: `query` (1–1024 characters, no control characters), optional `maxResults`
(1–10), optional two-letter lowercase `language` and `country`. Only these values
are sent to Serper. Tool guidance requires public queries and prohibits secrets,
private email content and proprietary source code; this instruction is not an
automatic data-classification guarantee.

Responses are limited to public titles, HTTP(S) source URLs and snippets, with no
provider metadata or key. Provider errors, redirects, malformed/oversized bodies
and credential echoes are contained. The direct transport validates TLS, bypasses
ambient proxies, refuses redirects and bounds the entire response. Serialized
model text is at most 32 KiB, including Korean/multibyte text and JSON escapes.

Audit records identify the initiating user, agent and exact workspace/channel/
conversation/turn. They record eligibility, provider phase and outcome without
search query contents, credentials, or provider response bodies. Existing secret
access audit records the responsible user when the company credential is resolved.

## Release and acceptance

Release coordinated Crew relay and Pilot server source, provision the approved
vault secret, add the fixed tool to operator runtime approvals, and ship the Mac
admin/agent UI. Keep the workspace flag disabled until an actual admin activates
it through the signed management operation. Do not seed member grants or copy a
personal OAuth credential into this path.

Acceptance must show: admin enable; a channel member's agent search with zero
personal connection/grant rows; correct requester/agent audit; admin disable
blocking both new and in-flight results; and a second workspace remaining blocked
until its own admin enables search. Confirm actual running image provenance and
runtime tool approval before calling the deployed feature complete. Local fixture
tests and a successful direct Serper request do not establish deployed agent use.
