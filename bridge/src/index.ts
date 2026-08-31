import { loadConfig } from "./config.js";
import { loadMapping } from "./crew.js";
import { createHealthApp, type HealthState } from "./health.js";
import { PilotClient } from "./pilot.js";
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
};

const service = new BridgeService(config, mapping, store, pilot);

const agentPubkeys = Object.values(mapping.agents).map((a) => a.pubkey);

async function main(): Promise<void> {
  await relay.subscribe(
    { kinds: [40002], "#p": agentPubkeys },
    (event) => {
      void service
        .handleEvent(event)
        .then((result) => {
          health.eventsHandled += 1;
          health.lastEventAt = new Date().toISOString();
          if (result.action === "issue-created") health.issuesCreated += 1;
          if (result.action === "commented") health.commentsPosted += 1;
          console.log(`event ${event.id.slice(0, 8)}: ${result.action}${result.action === "ignored" ? ` (${result.reason})` : ""}`);
        })
        .catch((err) => {
          // Receipt not marked — the event replays on reconnect for retry.
          console.error(`event ${event.id.slice(0, 8)} failed:`, err);
        });
    },
  );

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
