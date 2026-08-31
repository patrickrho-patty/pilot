import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { finalizeEvent, type Event as NostrEvent } from "nostr-tools";
import type { BridgeConfig } from "./config.js";
import { runCrewCli } from "./crew.js";
import { hexToBytes, type CrewRelay } from "./relay.js";
import { mintKey } from "./keys.js";
import type { PilotClient } from "./pilot.js";

export type HireInput = {
  name: string;
  role: string;
  reportsTo?: string;
  /** Existing Pilot agent record this hire binds to (secret custody target). */
  agentId: string;
  companyId: string;
  /** Mapped Crew channels the employee joins. */
  channelIds: string[];
  /** Optional #welcome-style channel for the intro post. */
  welcomeChannelId?: string;
};

export type HireResult = {
  pubkey: string;
  profileEventId: string;
  enrolledInRelay: boolean;
  joinedChannelIds: string[];
  secretId: string;
  welcomeEventId?: string;
};

/**
 * Ports for the hire pipeline; every step is injectable for tests. Defaults
 * shell out to crew-admin / crew-cli and publish over the bridge's relay
 * connection.
 */
export type HirePorts = {
  mint?: () => { pubkey: string; privateKeyHex: string };
  /** Sign the template with the agent key, publish, return the event id. */
  publishAsAgent?: (privateKeyHex: string, template: OutboxTemplate) => Promise<string>;
  enrollRelayMember?: (pubkey: string) => Promise<void>;
  joinChannel?: (channelId: string, pubkey: string) => Promise<void>;
  postGatewayMessage?: (channelUuid: string, text: string) => Promise<string | undefined>;
  storeSecret?: (
    companyId: string,
    name: string,
    key: string,
    value: string,
    description?: string,
  ) => Promise<{ id: string }>;
  bindAgentEnv?: (
    agentId: string,
    entries: Record<string, string | { type: "secret_ref"; secretId: string }>,
  ) => Promise<void>;
};

/** Unsigned event template (no id/sig yet). */
export type OutboxTemplate = {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
};

function runAdmin(crewAdminPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(crewAdminPath, args, { timeout: 30_000 });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`crew-admin exited ${code}: ${stderr.slice(0, 200)}`)),
    );
    child.on("error", (err) => reject(new Error(`crew-admin spawn failed: ${err.message}`)));
  });
}

function parseEventId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { event_id?: string };
    return typeof parsed.event_id === "string" ? parsed.event_id : undefined;
  } catch {
    return undefined;
  }
}

function resolvePorts(
  config: BridgeConfig,
  relay: CrewRelay,
  pilot: PilotClient,
  overrides: HirePorts,
): Required<HirePorts> {
  const gatewayEnv = (): Record<string, string> => ({
    CREW_RELAY_URL: config.relayUrl,
    CREW_PRIVATE_KEY: config.gatewayPrivateKey,
  });
  return {
    mint: overrides.mint ?? mintKey,

    publishAsAgent:
      overrides.publishAsAgent ??
      (async (privateKeyHex, template) => {
        // Signed with the freshly minted agent key — its first and only
        // use outside Pilot custody.
        const signed = finalizeEvent(
          {
            kind: template.kind,
            created_at: template.created_at,
            tags: template.tags,
            content: template.content,
          },
          hexToBytes(privateKeyHex),
        );
        await relay.publish(signed);
        return signed.id;
      }),

    enrollRelayMember:
      overrides.enrollRelayMember ??
      (async (pubkey) => {
        if (!config.admin.crewAdminPath) {
          // Deployment without bridge-side DB/Redis access: the operator runs
          // `crew-admin add-member` out-of-band. Skipped loudly, not silently.
          console.warn(
            "CREW_ADMIN_PATH not set — skipping relay enrollment; run `crew-admin add-member` manually",
          );
          return;
        }
        await runAdmin(config.admin.crewAdminPath, [
          "add-member",
          "--pubkey",
          pubkey,
          "--role",
          "member",
        ]);
      }),

    joinChannel:
      overrides.joinChannel ??
      (async (channelId, pubkey) => {
        const adminPrivateKeyHex = readFileSync(
          config.admin.relayAdminKeyPath,
          "utf8",
        ).trim();
        const signed = finalizeEvent(
          {
            kind: 9000,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ["h", channelId],
              ["p", pubkey.toLowerCase()],
              ["role", "bot"],
            ],
            content: "",
          },
          hexToBytes(adminPrivateKeyHex),
        );
        await relay.publish(signed);
      }),

    postGatewayMessage:
      overrides.postGatewayMessage ??
      (async (channelUuid, text) => {
        const res = await runCrewCli(
          config.admin.crewCliPath,
          ["messages", "send", "--channel", channelUuid, "--content", text],
          gatewayEnv(),
        );
        if (!res.ok) throw new Error("gateway message failed: crew-cli exited non-zero");
        return parseEventId(res.stdout);
      }),

    storeSecret:
      overrides.storeSecret ??
      ((companyId, name, key, value, description) =>
        pilot.createSecret({ companyId, name, key, value, description })),

    bindAgentEnv:
      overrides.bindAgentEnv ?? ((agentId, entries) => pilot.updateAgentEnv(agentId, entries)),
  };
}

/**
 * §95 hire pipeline: identity → visibility → admission → membership →
 * custody → announcement. The private key exists in memory only between mint
 * and custody and is never logged or returned (§10.4). Relay enrollment and
 * channel joins degrade to warnings (reported in the result) so a partial
 * bring-up is visible and re-runnable; custody failure fails the hire.
 */
export async function hireEmployee(
  config: BridgeConfig,
  relay: CrewRelay,
  pilot: PilotClient,
  input: HireInput,
  portOverrides: HirePorts = {},
): Promise<HireResult> {
  const ports = resolvePorts(config, relay, pilot, portOverrides);

  // 1. Identity.
  const { pubkey, privateKeyHex } = ports.mint();

  // 2. Visibility: kind:0 profile signed by the agent's own key.
  const profileEventId = await ports.publishAsAgent(privateKeyHex, {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 0,
    tags: [],
    content: JSON.stringify({
      name: input.name,
      display_name: input.name,
      about: [input.role, input.reportsTo ? `Reports to ${input.reportsTo}.` : null]
        .filter((part): part is string => part !== null)
        .join(" "),
    }),
  });

  // 3. Relay admission (NIP-43 roster via crew-admin).
  let enrolledInRelay = true;
  try {
    await ports.enrollRelayMember(pubkey);
  } catch (err) {
    enrolledInRelay = false;
    console.warn("relay enrollment failed:", err);
  }

  // 4. Channel membership (kind 9000, role bot, signed by the relay-admin key).
  const joinedChannelIds: string[] = [];
  for (const channelId of input.channelIds) {
    try {
      await ports.joinChannel(channelId, pubkey);
      joinedChannelIds.push(channelId);
    } catch (err) {
      console.warn(`channel join failed for ${channelId}:`, err);
    }
  }

  // 5. Custody: private key into Pilot secret store, bound to the agent env.
  const secretName = `crew-private-key-${input.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
  const { id: secretId } = await ports.storeSecret(
    input.companyId,
    secretName,
    "CREW_PRIVATE_KEY",
    privateKeyHex,
    `Crew signing key for ${input.name} (minted by bridge hire)`,
  );
  await ports.bindAgentEnv(input.agentId, {
    CREW_PRIVATE_KEY: { type: "secret_ref", secretId },
    CREW_RELAY_URL: config.relayUrl,
  });

  // 6. Announcement as the gateway identity (optional).
  let welcomeEventId: string | undefined;
  if (input.welcomeChannelId) {
    welcomeEventId = await ports.postGatewayMessage(
      input.welcomeChannelId,
      `Please welcome ${input.name} — ${input.role}. They'll be working with us here.`,
    );
  }

  return {
    pubkey,
    profileEventId,
    enrolledInRelay,
    joinedChannelIds,
    secretId,
    ...(welcomeEventId ? { welcomeEventId } : {}),
  };
}
