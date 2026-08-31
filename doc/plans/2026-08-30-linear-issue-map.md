# Crew–Pilot Integration — Linear Issue Map

> Source documents (read in full):
> - `doc/CREW_INTEGRATION.md` — the extensive integration plan (23 parts, §0–§105)
> - `doc/plans/2026-08-30-crew-pilot-bridge-v1.md` — V1 execution plan (13 tasks)
>
> **Rule:** one issue per FEATURE (grouped, not per code change). Issues spanning both products
> are filed **once per project** (project-specific framing) and connected with **Related to**.
> Projects: **Crew** (`1abf74e7-…`) and **Pilot** (`4ce5412d-…`).
>
> Status markers: 🟢 Wave 1 (V1 — get it running) · 🟡 Wave 2 (production hardening) · 🔵 Wave 3 (advanced UX) · ⚪ Backlog (unphased)

---

## EPIC (both projects — create in each, related to each other)

| # | Project | Title | Scope sketch | Source |
|---|---|---|---|---|
| E-C | Crew | **Epic: Crew–Pilot Integration (Crew side)** | Crew-side surfaces of the integration: pilot-mode workspace, employee lifecycle display, approval projection, org-derived access. Links plan doc. | whole doc |
| E-P | Pilot | **Epic: Crew–Pilot Integration (Pilot side)** | Pilot-side: bridge service, provisioning authority, external-work protocol, routines/awareness. Links plan doc. | whole doc |

---

## WAVE 1 — V1 (the get-it-running loop)

| # | Project | Title | Scope sketch | Source | Related |
|---|---|---|---|---|---|
| 1 | Pilot | **Bridge service core: relay → Pilot issue loop** | NIP-42 WS subscription (kind 40002), event verification, mention parsing, channel→project + agent mapping, sender authorization, dedupe/idempotency store, thread↔issue correlation, issue create, follow-up→comment, gateway service acks. Config file + health endpoint. | §13–§16, §22–§29, §67 P0, bridge Tasks 1–6 | — (core) |
| 2 | Pilot | **Pilot API client + live contract pinning** | Bearer service-auth REST client; issue create/comment/checkout 409 semantics; contract generated against pinned release OpenAPI; reconciliation-before-retry | §13.4, §25.1, §28, bridge Task 2 | — |
| 3 | Pilot | **Hire an employee → Crew onboarding (provisioning authority)** | `bridge hire`: mint npub → kind:0 profile → relay enrollment → channel joins → #welcome intro; key into Pilot secret custody. Enrollment authority never converses (§96) | Part XXI §95–96, bridge Task 7 | relates to Crew-5 |
| 4 | Pilot | **Offboard an employee → Crew deprovisioning** | `bridge offboard`: channel leaves, tombstone profile, enrollment revoke; audit log line. Graceful degrade if key not retrievable | Part XXI §95 offboard, bridge Task 7b | relates to Crew-5 |
| 5 | Crew | **Pilot-integration mode: "Your team" + creation policy** | Read `pilot_integration` community metadata → Agents section renders pilot-provisioned employees (read-only cards, "Managed in Pilot" badge, board deep-link); hide "New agent"/local creation while flag present; standalone Crew unaffected | §101, §103, bridge Task 12 | relates to Pilot 3+4 |
| 6 | Pilot | **Agent self-reply runtime package** | Per-agent Crew secrets bound in Pilot (`CREW_PRIVATE_KEY`/`CREW_AUTH_TAG` secret refs), `crew-cli` present in the runtime image, "Crew channel duty" operating-contract skill (acknowledge → progress → completion standards) | Part VII §30–§34, bridge Task 8 | relates to Crew-7 |
| 7 | Crew | **Employee workspace acceptance: SSO → onboard → mention → reply loop** | The §98 acceptance pass on the live systems: fresh SSO join, agent visible/mentionable, mention creates Pilot issue, agent replies as itself, follow-up comments same issue. Includes relay-membership verification per joiner | §98, bridge Task 9, §95 checklist | relates to Pilot 1 |
| 8 | Pilot | **Integration flag + deploy to rho-cluster** | Dockerfile, ECR build, helm install in `pilot` ns (2 replicas + DB idempotency per §62), health/metrics endpoint; publish `pilot_integration` metadata to relay | §104, bridge Tasks 10–11 | relates to Crew-5 |

## WAVE 2 — Production hardening (P1)

| # | Project | Title | Scope sketch | Source | Related |
|---|---|---|---|---|---|
| 9 | Pilot | **Bridge reliability: retry, outbox, DLQ + replay tooling** | Retry classes per §28.4, outbox/reconciliation worker, dead-letter store with replay CLI, idempotency markers on comments | §28, §67 P0 tail | — |
| 10 | Pilot | **Observability: metrics, structured logs, alerts** | §55 gateway metric set, JSON logs w/o content/secrets, DLQ depth + age alerts, relay/API health flags; alert routing | §55–§59, §67 P0 | — |
| 11 | Pilot | **Message-edit policy + rate limiting** | Edit-after-create → revision comment policy (§29 edit race); per-sender/channel rate limits | §29, §67 P1 | relates to Crew-8 |
| 12 | Crew | **Message-edit UX + cross-system edit integrity** | Edit events surface correctly in threads; gateway revision comments render as linked context; no silent mutation of requests | §29 edit race, bridge Task in P1 | relates to Pilot 11 |
| 13 | Pilot | **Mapping administration: GitOps config + validation** | mapping.json → validated config (schema, lint, dry-run), admin-inspectable mapping state; precursor to the V2 admin UI | §11, §26, §67 P1 | relates to Crew-9 |
| 14 | Crew | **Integration settings page (admin Connect flow)** | Workspace admin → Integrations → Pilot: URL + service key + validate/connect; stored as relay community config; bridge self-configures from it | §103, §105 V2 | relates to Pilot 8 |

## WAVE 3 — Advanced UX + governance surface

| # | Project | Title | Scope sketch | Source | Related |
|---|---|---|---|---|---|
| 15 | Pilot | **Approval projection protocol** | Human Crew↔Pilot user mapping, role verification, anti-replay, decision audit, stale-card handling, multi-approver stages, rejection reasons — the full §18.4 checklist before any Crew-side approval card | §18.4, §67 P2 | relates to Crew-16 |
| 16 | Crew | **Native Pilot approval/decision cards** | Pilot decisions rendered as Crew cards (approve/link-out), backed by the §18.4 protocol; chat alone never grants authority | §18.4, §67 P2, §92 | relates to Pilot 15 |
| 17 | Crew | **Rich Pilot issue previews + linked-issue UI** | Linked issue status/identifier rendered on messages/threads; deep links; artifact previews | §67 P2, §65 optional | relates to Pilot 18 |
| 18 | Pilot | **First-class Crew integration object + external-source metadata** | Crew origin as structured issue metadata (not prose footer), native outbound hooks on issue transitions, admin UI showing linked channel/thread | §66 optional, §67 P1 | relates to Crew-17 |

## WAVE 4 — Working day (awareness + proposals)

| # | Project | Title | Scope sketch | Source | Related |
|---|---|---|---|---|---|
| 19 | Pilot | **Office-awareness routines: channel digests as routine input** | Bridge digests mapped channels on schedule → routine input → employee wakes and exercises judgment (ignore/reply/escalate/propose) | Part XXII §100, bridge Task 13 | relates to Crew-20 |
| 20 | Crew | **Proposal lane UX: decision-queue proposals surface in channels** | Agent proposals post to Crew channels ("worth doing?"), approval → owned issue; initiative governance (quiet hours, proactive caps) enforced bridge-side | Part XXII, §37 pattern | relates to Pilot 19 |
| 21 | Pilot | **Multi-agent teams: child-issue delegation + review stages in production** | Lead-agent delegation patterns, cross-agent review gates, budget attribution per child (Patterns A/B, §43–§45) | §17, §19, §43–§45 | relates to Crew-22 |
| 22 | Crew | **Delegation visibility: child-work projections in threads** | Delegation/review status messages as social projection of the Pilot work tree | §17.2, §19 | relates to Pilot 21 |

## BACKLOG — Mode B/C + unphased enhancements

| # | Project | Title | Scope sketch | Source |
|---|---|---|---|---|
| 23 | Pilot | **Crew ACP adapter (Mode B)** | Pilot adapter invoking crew-acp harness: lifecycle ownership, cancellation, cost extraction, ACP→run telemetry | §7 Mode B |
| 24 | Crew | **Pilot connector action in Crew workflows** | First-class workflow action: create Pilot work from Crew workflow rules | §65 optional, §21.2 |
| 25 | Pilot | **Scoped service-account permissions for bridge ingestion** | Dedicated least-privilege service credential replacing broad admin key (§66 last item, §49) | §66 |
| 26 | Crew | **"Create Pilot work" message action/context menu** | Direct work creation from any message without agent mention | §65 optional |
| 27 | Pilot | **Agent-job protocol alignment** | Align with Crew agent-job event family when payloads stabilize (§89.3 watch item) | §89.3 |
| 28 | Crew | **Channel-level admin UI: map channel → Pilot project/goal** | In-app mapping administration (beyond GitOps config) | §65 optional |
| 29 | Pilot | **Cross-workspace federation** | Multi-company bridge topologies | §67 P2 |

---

## Cross-project pairing summary (Related-to graph)

- Crew-5 (pilot mode) ↔ Pilot-3, Pilot-4, Pilot-8
- Crew-7 (acceptance) ↔ Pilot-1
- Crew-8 (edit UX) ↔ Pilot-11
- Crew-9 (mapping admin) ↔ Pilot-13
- Crew-14 (settings page) ↔ Pilot-8
- Crew-16 (approval cards) ↔ Pilot-15
- Crew-17 (issue previews) ↔ Pilot-18
- Crew-20 (proposal lane) ↔ Pilot-19
- Crew-22 (delegation visibility) ↔ Pilot-21
- Epics E-C ↔ E-P

## Existing tickets (already filed — do not duplicate)

- **PAT-1963** — Slack→Crew rollout (Crew project) — orthogonal, ships first
- **PAT-1969** — Crew deployment v2 + Supabase/S3 migration (Crew project) — infrastructure prerequisite for a clean crew release
- **PAT-1962** — value proposition (reference)

## Deliberately NOT filed

- Workplace scenarios (§35–42) — future use-case demos, not features
- Demo script, RACI, runbooks (§80–88) — client-engagement materials
- §65/§66 "required configuration/deployment" checklists — absorbed into Wave 1 tickets and PAT-1969

---

## Created in Linear (2026-08-31)

**Epics:** PAT-1975 (Crew side) ↔ PAT-1976 (Pilot side)

| Wave | Crew | Pilot |
|---|---|---|
| 1 | PAT-1995 (pilot mode), PAT-1996 (acceptance E2E) | PAT-1977 (core loop), PAT-1978 (API client), PAT-1979 (hire), PAT-1980 (offboard), PAT-1981 (runtime pkg), PAT-1982 (flag+deploy) |
| 2 | PAT-1997 (edit UX), PAT-1998 (settings page) | PAT-1983 (reliability), PAT-1984 (observability), PAT-1985 (edit policy), PAT-1986 (mapping config) |
| 3 | PAT-1999 (approval cards), PAT-2000 (previews) | PAT-1987 (protocol), PAT-1988 (integration object) |
| 4 | PAT-2001 (proposal lane), PAT-2002 (delegation visibility) | PAT-1989 (awareness), PAT-1990 (multi-agent) |
| Backlog | PAT-2003 (workflow action), PAT-2004 (message action), PAT-2005 (mapping UI) | PAT-1991 (Mode B), PAT-1992 (service account), PAT-1993 (job protocol watch), PAT-1994 (federation) |
