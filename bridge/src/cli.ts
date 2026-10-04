import { loadConfig } from "./config.js";
import { loadMapping } from "./crew.js";
import { hireEmployee } from "./hire.js";
import { offboardEmployee } from "./offboard.js";
import { PilotClient } from "./pilot.js";
import { CrewRelay } from "./relay.js";
import { BridgeStore } from "./store.js";

function usage(): never {
  console.error(`usage: crew-bridge <command>

commands:
  serve                                  run the relay→Pilot service loop
  hire <name> --role <role> --agent-id <id> --company <id>
        [--reports-to <name>] [--channels <uuid,uuid>] [--welcome-channel <uuid>]
        [--mapping <path>] [--db <path>]
  offboard <name> [--pubkey <hex>] [--reason <text>] [--agent-key-file <path>]
        [--channels <uuid,uuid>] [--mapping <path>] [--db <path>]
  dlq list [--status pending|replayed|abandoned] [--db <path>]
  dlq replay <event-id>|--all [--db <path>]
  mapping validate [--mapping <path>]
  audit export [--since <iso>] [--limit <n>] [--db <path>]
  retention prune [--dry-run] [--days <n>] [--mapping <path>] [--db <path>]

retention prune applies per-channel retentionDays (default --days, or
BRIDGE_RETENTION_DAYS). Only bridge-side identifiers and metadata are
removed; the bridge never stores message bodies.

audit export writes NDJSON (§58) for SIEM ingestion: one line per state
transition, joinable on correlation id, Crew event id and Pilot issue id.

dlq replays dead-lettered events: it clears the receipt so the relay replays
the event into the normal loop. Fix the cause (mapping, credentials) first.

hire mints the employee's Crew identity, publishes their profile, enrolls them
on the relay, joins the mapped channels, and places the signing key into Pilot
secret custody. The private key is never printed.`);
  process.exit(1);
}

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const mappingPath = arg("--mapping", rest) ?? process.env.BRIDGE_MAPPING_PATH ?? "./mapping.json";
  const dbPath = arg("--db", rest) ?? process.env.BRIDGE_DB_PATH ?? "./bridge.db";

  if (command === "hire") {
    const name = rest[0];
    const role = arg("--role", rest);
    const agentId = arg("--agent-id", rest);
    const companyId = arg("--company", rest);
    if (!name || !role || !agentId || !companyId) usage();

    const config = loadConfig(process.env, dbPath);
    const mapping = loadMapping(mappingPath);
    const relay = new CrewRelay(config.relayUrl, config.gatewayPrivateKey);
    const pilot = new PilotClient(config.pilotBaseUrl, config.pilotApiKey);

    const channelIdsArg = arg("--channels", rest);
    const channelIds = channelIdsArg
      ? channelIdsArg.split(",").map((c) => c.trim()).filter(Boolean)
      : Object.keys(mapping.channels);
    const result = await hireEmployee(config, relay, pilot, {
      name,
      role,
      agentId,
      companyId,
      channelIds,
      ...(arg("--welcome-channel", rest)
        ? { welcomeChannelId: arg("--welcome-channel", rest) }
        : {}),
      ...(arg("--reports-to", rest) ? { reportsTo: arg("--reports-to", rest) } : {}),
    });
    relay.close();

    // Secret-free summary (§10.4).
    console.log(
      JSON.stringify({
        hired: name,
        pubkey: result.pubkey,
        profileEventId: result.profileEventId,
        enrolledInRelay: result.enrolledInRelay,
        joinedChannelIds: result.joinedChannelIds,
        secretId: result.secretId,
        ...(result.welcomeEventId ? { welcomeEventId: result.welcomeEventId } : {}),
      }),
    );
    return;
  }

  if (command === "offboard") {
    const name = rest[0];
    if (!name) usage();

    const config = loadConfig(process.env, dbPath);
    const mapping = loadMapping(mappingPath);
    const relay = new CrewRelay(config.relayUrl, config.gatewayPrivateKey);
    const pilot = new PilotClient(config.pilotBaseUrl, config.pilotApiKey);

    const channelsArg = arg("--channels", rest);
    const result = await offboardEmployee(config, relay, pilot, mapping, {
      name,
      ...(arg("--pubkey", rest) ? { pubkey: arg("--pubkey", rest) } : {}),
      ...(arg("--reason", rest) ? { reason: arg("--reason", rest) } : {}),
      ...(arg("--agent-key-file", rest)
        ? { agentKeyFile: arg("--agent-key-file", rest) }
        : {}),
      ...(channelsArg
        ? { channelIds: channelsArg.split(",").map((c) => c.trim()).filter(Boolean) }
        : {}),
    });
    relay.close();

    console.log(
      JSON.stringify({
        offboarded: result.name,
        pubkey: result.pubkey,
        leftChannelIds: result.leftChannelIds,
        tombstoned: result.tombstoned,
        enrollmentRevoked: result.enrollmentRevoked,
        envUnbound: result.envUnbound,
        auditedAt: result.auditedAt,
      }),
    );
    return;
  }

  if (command === "dlq") {
    const sub = rest[0];
    const store = new BridgeStore(dbPath);
    try {
      if (sub === "list") {
        const statusArg = arg("--status", rest);
        const status =
          statusArg === "replayed" || statusArg === "abandoned" || statusArg === "pending"
            ? statusArg
            : "pending";
        console.log(JSON.stringify(store.listFailures(status), null, 2));
        return;
      }
      if (sub === "replay") {
        const targets = rest.includes("--all")
          ? store.listFailures("pending").map((e) => e.eventId)
          : [rest[1]].filter((v): v is string => Boolean(v));
        // `--all` on an empty queue is a successful no-op; only a missing
        // explicit event id is a usage error.
        if (targets.length === 0 && !rest.includes("--all")) usage();
        for (const eventId of targets) store.markForReplay(eventId);
        console.log(
          JSON.stringify({ requeued: targets.length, eventIds: targets }),
        );
        return;
      }
      usage();
    } finally {
      store.close();
    }
  }

  if (command === "mapping") {
    if (rest[0] !== "validate") usage();
    // Dry-run: report every problem, exit non-zero so GitOps can gate on it.
    try {
      const mapping = loadMapping(mappingPath);
      console.log(
        JSON.stringify(
          {
            ok: true,
            mapping: mappingPath,
            channels: Object.keys(mapping.channels).length,
            agents: Object.keys(mapping.agents).length,
          },
          null,
          2,
        ),
      );
      return;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (command === "audit") {
    if (rest[0] !== "export") usage();
    const store = new BridgeStore(dbPath);
    try {
      const since = arg("--since", rest);
      const limitArg = arg("--limit", rest);
      const rows = store.listAudit(since, limitArg ? Number(limitArg) : 1000);
      for (const row of rows) console.log(JSON.stringify(row));
      return;
    } finally {
      store.close();
    }
  }

  if (command === "retention") {
    if (rest[0] !== "prune") usage();
    const mapping = loadMapping(mappingPath);
    const store = new BridgeStore(dbPath);
    try {
      const daysArg = arg("--days", rest);
      const defaultDays = Number(daysArg ?? process.env.BRIDGE_RETENTION_DAYS ?? "90");
      const dryRun = rest.includes("--dry-run");

      const cutoffs: Array<{ channel: string; days: number; before: string }> = [];
      for (const [channelId, channel] of Object.entries(mapping.channels)) {
        const days = channel.retentionDays ?? defaultDays;
        cutoffs.push({
          channel: channelId,
          days,
          before: new Date(Date.now() - days * 86_400_000).toISOString(),
        });
      }
      const globalBefore = new Date(
        Date.now() - Math.min(defaultDays, ...cutoffs.map((c) => c.days)) * 86_400_000,
      ).toISOString();

      // Dry run runs the real deletes inside a transaction and rolls it back,
      // so the reported counts are the true counts.
      const ROLLBACK = "__dry_run__";
      let removed: Record<string, Record<string, number>> = {};
      try {
        store.transaction(() => {
          for (const c of cutoffs) {
            removed[c.channel] = store.pruneChannelRetention(c.channel, c.before);
          }
          removed["__global__"] = store.pruneRetention(globalBefore);
          if (dryRun) throw new Error(ROLLBACK);
        });
      } catch (err) {
        if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
      }

      console.log(
        JSON.stringify({ dryRun, defaultDays, cutoffs, globalBefore, removed }, null, 2),
      );
      return;
    } finally {
      store.close();
    }
  }

  if (command === "serve") {
    await import("./index.js");
    return;
  }

  usage();
}

void main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
