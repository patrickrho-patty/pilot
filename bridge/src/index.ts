import { loadConfig } from "./config.js";
import { loadMapping } from "./crew.js";
import { bump, createHealthApp, type HealthState } from "./health.js";
import { publishPilotPolicy } from "./integration.js";
import { threadRootOf } from "./mentions.js";
import { backoffMs, classifyFailure, isRetryable, PilotClient } from "./pilot.js";
import { CrewRelay } from "./relay.js";
import { BridgeService } from "./service.js";
import { BridgeStore } from "./store.js";

const mappingPath = process.env.BRIDGE_MAPPING_PATH ?? "./mapping.json";

const config = loadConfig(process.env);
const mapping = loadMapping(mappingPath);
const store = new BridgeStore(config.dbPath);
const pilot = new PilotClient(config.pilotBaseUrl, config.pilotApiKey);
const relay = new CrewRelay(config.relayUrl, config.gatewayPrivateKey);

const health: HealthState = {
  startedAt: new Date().toISOString(),
  eventsHandled: 0,
  issuesCreated: 0,
  commentsPosted: 0,
  lastEventAt: null,
  relayConnected: false,
  pilotReachable: false,
  counters: new Map(),
  dlq: () => store.listFailures("pending"),
};

const service = new BridgeService(config, mapping, store, pilot);

const agentPubkeys = Object.values(mapping.agents).map((a) => a.pubkey);

const MAX_ATTEMPTS = 5;

function channelOf(event: { tags: string[][] }): string | null {
  for (const [tag, value] of event.tags) {
    if (tag === "h" && typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * §28.4/§28.5: retry the classes that can succeed, dead-letter the rest, and
 * always record the failure so nothing is lost silently.
 */
async function handleWithRetry(
  event: { id: string; kind: number; pubkey: string; tags: string[][] },
  health: HealthState,
): Promise<void> {
  const channelId = channelOf(event);
  const threadRoot = threadRootOf(event as never);
  bump(health, "crew_pilot_events_received_total", {
    kind: String(event.kind),
    channel: channelId ?? "none",
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await service.handleEvent(event as never);
      health.eventsHandled += 1;
      health.lastEventAt = new Date().toISOString();
      if (result.action === "issue-created") health.issuesCreated += 1;
      if (result.action === "commented") health.commentsPosted += 1;
      bump(health, "crew_pilot_events_processed_total", { result: result.action });
      if (result.action === "issue-created") {
        bump(health, "crew_pilot_issue_create_total", { result: "success" });
      }
      if (result.action === "commented") {
        bump(health, "crew_pilot_comment_create_total", { result: "success" });
      }
      if (result.action === "ignored") {
        if (result.reason === "unmapped-channel" || result.reason === "no-agent-mention") {
          bump(health, "crew_pilot_mapping_miss_total", { type: result.reason });
        }
        if (result.reason === "unauthorized-sender") {
          bump(health, "crew_pilot_unauthorized_request_total");
        }
      }
      console.log(
        `event ${event.id.slice(0, 8)}: ${result.action}${result.action === "ignored" ? ` (${result.reason})` : ""}`,
      );
      return;
    } catch (err) {
      const failureClass = classifyFailure(err);
      const retryable = isRetryable(failureClass) && attempt < MAX_ATTEMPTS;
      bump(health, "crew_pilot_issue_create_total", { result: failureClass });
      if (retryable) {
        bump(health, "crew_pilot_retries_total", {
          operation: "handle-event",
          reason: failureClass,
        });
      }
      store.recordFailure({
        eventId: event.id,
        channelId,
        threadRoot,
        senderPubkey: event.pubkey,
        targetMapping: channelId ? (mapping.channels[channelId]?.companyId ?? null) : null,
        failureClass,
        diagnostic: err instanceof Error ? err.message : String(err),
        replayStatus: retryable ? "pending" : "abandoned",
      });
      if (!retryable) {
        console.error(`event ${event.id.slice(0, 8)} dead-lettered (${failureClass}):`, err);
        return;
      }
      const wait = backoffMs(attempt);
      console.warn(
        `event ${event.id.slice(0, 8)} attempt ${attempt}/${MAX_ATTEMPTS} failed (${failureClass}); retry in ${wait}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function main(): Promise<void> {
  await relay.subscribe(
    { kinds: [40002, 40003], "#p": agentPubkeys },
    (event) => {
      void handleWithRetry(event, health);
    },
  );
  health.relayConnected = true;

  // PAT-1982: flip Crew into pilot mode once the relay is connected and Pilot
  // accepts our agent key. Loud but not fatal — a policy problem must not stop
  // the mention → issue loop.
  try {
    const me = await pilot.whoami();
    health.pilotReachable = true;
    const policy = await publishPilotPolicy(config, relay);
    console.log(
      policy.changed
        ? `pilot policy: ${policy.previous} -> pilot as ${me.id}`
        : `pilot policy: already pilot (agent ${me.id})`,
    );
  } catch (err) {
    console.error("pilot policy publish skipped:", err);
  }

  const app = createHealthApp(health);
  const server = app.listen(config.port, () => {
    console.log(`crew-bridge listening on :${config.port} (relay ${config.relayUrl})`);
  });

  const shutdown = (): void => {
    console.log("shutting down");
    server.close();
    relay.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
