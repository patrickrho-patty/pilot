# Crew–Pilot bridge operations

Day-2 runbook for the `crew-bridge` service (PAT-2009). It covers the fifteen scenarios
required by `doc/CREW_INTEGRATION.md` §88.

The bridge turns Crew mentions and Git pull requests into Pilot issues, and flips the Crew
community into pilot mode. It holds three credentials, and this runbook never prints any of
them:

| Credential | Env / mount | What it can do |
|---|---|---|
| Gateway identity | `CREW_GATEWAY_PRIVATE_KEY` (secret) | Publish as the gateway; post acks |
| Relay admin key | `CREW_RELAY_ADMIN_KEY_PATH` (file mount) | Join channels; publish the pilot-mode policy head |
| Pilot agent key | `PILOT_API_KEY` (secret) | Create issues, comment, assign skills — **must be `task_bridge`-scoped** |

Keep shell tracing off (`set +x`) before exporting any of these.

## Health signals

```sh
kubectl -n pilot port-forward deploy/pilot-bridge 3101:3101
curl -s localhost:3101/healthz | jq
curl -s localhost:3101/metrics | grep crew_pilot
```

`/healthz` reports `relayConnected` and `pilotReachable`. `/metrics` carries the §55 set;
the two numbers that page a human are `crew_pilot_dlq_depth` and
`crew_pilot_oldest_dlq_age_seconds`.

---

## 1. Gateway down

**Symptom:** no new Pilot issues from Crew; `/healthz` unreachable; mentions get no ack.

```sh
kubectl -n pilot get deploy pilot-bridge
kubectl -n pilot logs deploy/pilot-bridge --tail=200
```

A crash at startup is almost always one of three things, each of which logs its own reason:

- `refusing to start — least-privilege check failed: …` — the Pilot key is not
  `task_bridge`-scoped or does not cover a mapped project. See §10.
- `mapping … is invalid:` — the mapping failed validation. See §11.
- `Missing env …` — a secret key is absent from `crew-bridge-secrets`.

Restart once the cause is fixed:

```sh
kubectl -n pilot rollout restart deploy/pilot-bridge
kubectl -n pilot rollout status deploy/pilot-bridge --timeout=5m
```

**Verify:** `/healthz` returns `ok: true`, and a mention in a mapped channel produces a Pilot
issue. Receipts are only marked after success, so events that failed while the gateway was
down replay on reconnect.

## 2. Crew relay down

**Symptom:** `crew_pilot_relay_connected 0`; no events received; the bridge logs reconnect
attempts.

Nothing to do on the bridge. The bridge resubscribes and replays from a safe checkpoint. Check
the relay itself:

```sh
kubectl -n crew get deploy
```

**Verify:** `crew_pilot_relay_connected 1` returns, and `crew_pilot_events_received_total`
starts climbing again.

## 3. Pilot down

**Symptom:** `crew_pilot_pilot_reachable 0`; `crew_pilot_retries_total` climbs;
`crew_pilot_dlq_depth` grows after five attempts.

The bridge is designed to survive this: transport and 5xx failures retry with exponential
backoff, then dead-letter. When Pilot is back:

```sh
kubectl -n pilot get deploy pilot
kubectl -n pilot exec deploy/crew-bridge -- node dist/cli.js dlq list
kubectl -n pilot exec deploy/crew-bridge -- node dist/cli.js dlq replay --all
```

**Verify:** `dlq replay` prints `requeued: N`; the entries leave `pending` and the issues
appear.

## 4. Agent runtime repeatedly failing

**Symptom:** issues are created and assigned, but the employee never replies in the thread.

Check the issue in Pilot first: is it checked out, and did a run fail? The bridge's part is
only to file the issue and post the gateway ack.

```sh
kubectl -n pilot logs deploy/crew-bridge --tail=100 | grep -i ack
```

An ack failure is non-fatal by design (§1627) — the issue still exists. If the agent never
replies, the runtime is the problem, not the bridge.

## 5. Agent stuck in a loop

**Symptom:** the same thread produces repeated Pilot comments.

The bridge does not loop on its own: `seen_events` suppresses a replay, and a follow-up in a
linked thread becomes a comment rather than a new issue. Repeated comments therefore mean
distinct Crew messages. Confirm, then act on the agent:

```sh
kubectl -n pilot exec deploy/crew-bridge -- node dist/cli.js audit export --limit 200
```

Filter by `crewEventId` to count distinct source messages. If the agent itself is looping,
pause it in Pilot (the board), not here.

## 6. Budget exhausted

**Symptom:** `POST /checkout` returns 409, and the bridge records it as `project-paused`.

409 is **not** a lost race — Pilot returns it when the issue's project is paused on a budget
hard-stop (`server/src/routes/issues.ts`). The bridge does not retry it; the failure is
dead-lettered so the cause stays visible.

Action: raise the budget or unpause the project in Pilot. Then replay:

```sh
kubectl -n pilot exec deploy/crew-bridge -- node dist/cli.js dlq list --status abandoned
kubectl -n pilot exec deploy/crew-bridge -- node dist/cli.js dlq replay <event-id>
```

## 7. Model provider outage

Out of scope for the bridge — no model calls happen here. The failure shows up as agents not
producing work while issues are filed normally. Check the Pilot model gateway, not the bridge.

## 8. Compromised Crew agent key

**Symptom:** messages or acks attributed to an employee that the employee did not send.

The employee's key lives in Pilot secret custody (`CREW_PRIVATE_KEY`, bound as a
`secret_ref`). Rotate it by re-hiring the identity and offboarding the old one:

```sh
kubectl -n pilot exec deploy/crew-bridge -- node dist/cli.js offboard <name> --reason "key compromise"
```

Then re-run `hire` for the same name with a fresh mapping entry. Offboard leaves channels,
tombstones the profile, revokes enrollment, and unbinds the env keys.

**Verify:** the old pubkey no longer appears as a channel member, and a mention of the
employee is filed under the new pubkey.

## 9. Compromised gateway key

**Symptom:** acks or the pilot-mode policy head published by an identity you do not control.

This is the highest-severity bridge event: the gateway key can join channels and publish the
39090 policy head. Rotate it in this order:

1. Stop the bridge: `kubectl -n pilot scale deploy/pilot-bridge --replicas=0`.
2. Mint a replacement gateway identity and enroll it with `crew-admin add-member`.
3. Replace `CREW_GATEWAY_PRIVATE_KEY` in `crew-bridge-secrets`.
4. Remove the old pubkey from the relay roster with `crew-admin remove-member`.
5. Restart: `kubectl -n pilot scale deploy/pilot-bridge --replicas=1`.

**Verify:** `/healthz` is green, a mention produces an issue, and the old pubkey is absent
from the roster.

## 10. Pilot credential rotation

The bridge's Pilot key must stay `task_bridge`-scoped, bounded to the projects in the
mapping. It refuses to start otherwise.

```sh
kubectl -n pilot create secret generic crew-bridge-secrets -n pilot \
  --from-literal=CREW_GATEWAY_PRIVATE_KEY=<64 hex> \
  --from-literal=PILOT_API_KEY=<task_bridge-scoped agent key> \
  --from-file=relay-admin-key=<path to hex key file> \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n pilot rollout restart deploy/pilot-bridge
```

**Verify:** the pod reaches Ready and the log shows `pilot policy: already pilot` or
`-> pilot`, plus no least-privilege refusal.

## 11. Incorrect mapping causing misassignment

**Symptom:** work lands with the wrong employee, or a channel is ignored
(`crew_pilot_mapping_miss_total` climbs).

Validate before applying — this is the GitOps gate:

```sh
crew-bridge mapping validate --mapping deploy/mapping.json
```

It reports **every** problem at once (bad channel UUID, non-hex pubkey, empty
`allowedSenders`, unknown agent named by a repo route) and exits non-zero. A malformed
mapping stops the bridge at startup rather than running with a partial map.

Then apply and restart, and replay anything the bad mapping dropped:

```sh
kubectl -n pilot exec deploy/crew-bridge -- node dist/cli.js dlq replay --all
```

**Verify:** a mention in the corrected channel files against the right agent.

## 12. DLQ replay

```sh
crew-bridge dlq list --status pending      # oldest first
crew-bridge dlq replay <event-id>          # one
crew-bridge dlq replay --all               # everything pending
```

Replay clears the event's receipt so the relay replays it into the normal loop — fix the
cause first, or it will simply dead-letter again with a higher attempt count. The DLQ holds
metadata only (event id, channel, thread root, sender, failure class, attempts, first/last
attempt, sanitized diagnostic), never message content.

**Verify:** `dlq list --status pending` is empty afterwards and the issues exist in Pilot.

## 13. User asks to delete or restrict retained integration data

The bridge stores **identifiers and metadata only** — no message bodies (§50). The Pilot issue
description is the one place customer text is duplicated, and it lives in Pilot, not here.

Per-channel retention:

```sh
crew-bridge retention prune --dry-run      # reports true counts, writes nothing
crew-bridge retention prune                # applies it
```

`retentionDays` is per channel in the mapping, with `--days` / `BRIDGE_RETENTION_DAYS` as the
default. `pruneRetention` covers the unscoped tables (`seen_events`, `audit`,
`rate_window`); `pruneChannelRetention` covers `thread_issue` and `message_issue` for that
channel only.

For a subject-access or deletion request, export the audit trail first so the request itself
is reconstructable:

```sh
crew-bridge audit export --since <iso> > request-audit.ndjson
```

## 14. Backup restore

The bridge's durable state is one SQLite file at `BRIDGE_DB_PATH` on its own PVC.

```sh
kubectl -n pilot scale deploy/pilot-bridge --replicas=0
kubectl -n pilot exec deploy/pilot-bridge -- \
  sh -c 'cp /data/bridge.db /data/bridge.db.bak'
```

Restore by replacing `/data/bridge.db`, then scaling back to 1. A lost receipt store is
recoverable but noisy: without it, replayed events can file duplicate issues. Pilot's
`idempotencyKey` protects Git-routed PR issues; mention-routed issues rely on the receipt
store, so prefer restoring the file.

**Verify:** `/healthz` green, `dlq list` shows the expected entries.

## 15. Version rollback

```sh
helm -n pilot history pilot
helm -n pilot rollback pilot <revision>
kubectl -n pilot rollout status deploy/pilot-bridge --timeout=5m
```

The chart pins both images (`image.tag` and `bridge.image.tag`). Rolling back the chart rolls
back the bridge image too. Confirm the bridge binary in the new image still carries `crew`:

```sh
kubectl -n pilot exec deploy/pilot-bridge -- /usr/local/bin/crew --help
```

**Verify:** `/healthz` green and one end-to-end mention files an issue.

---

## Escalation data to collect

Before escalating, gather these — they are the §58 join keys:

```sh
kubectl -n pilot exec deploy/crew-bridge -- node dist/cli.js audit export --limit 500 > audit.ndjson
kubectl -n pilot logs deploy/pilot-bridge --tail=500 > bridge.log
curl -s localhost:3101/metrics > metrics.txt
```

Include `correlationId`, `crewEventId` and `issueId` for the affected request. Do not attach
`crew-bridge-secrets` or any key material.
