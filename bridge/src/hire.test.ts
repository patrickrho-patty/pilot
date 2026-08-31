import { describe, expect, it } from "vitest";
import type { BridgeConfig } from "./config.js";
import type { OutboxTemplate } from "./hire.js";
import { hireEmployee, type HirePorts } from "./hire.js";
import type { PilotClient } from "./pilot.js";
import type { CrewRelay } from "./relay.js";

const config: BridgeConfig = {
  relayUrl: "wss://relay.test",
  pilotBaseUrl: "https://pilot.test",
  pilotApiKey: "test-key",
  gatewayPrivateKey: "d".repeat(64),
  dbPath: ":memory:",
  port: 0,
  admin: { crewCliPath: "crew", relayAdminKeyPath: "/tmp/admin-key" },
};

function makeFakes() {
  const published: Array<{ kind: number; signer: string; tags: string[][]; content: string }> = [];
  const secrets: Array<{ companyId: string; name: string; key: string; value: string }> = [];
  const envBindings: Array<Record<string, unknown>> = [];
  const welcomeMessages: string[] = [];
  let mintCount = 0;

  const ports: HirePorts = {
    mint: () => ({
      pubkey: `pk${++mintCount}`.padEnd(64, "0"),
      privateKeyHex: `sk${mintCount}`.padEnd(64, "0"),
    }),
    publishAsAgent: async (_key, template: OutboxTemplate) => {
      published.push({
        kind: template.kind,
        signer: "agent",
        tags: template.tags,
        content: template.content,
      });
      return `evt-${published.length}`;
    },
    enrollRelayMember: async () => {},
    joinChannel: async (channelId, pubkey) => {
      published.push({
        kind: 9000,
        signer: "relay-admin",
        tags: [["h", channelId], ["p", pubkey.toLowerCase()], ["role", "bot"]],
        content: "",
      });
    },
    postGatewayMessage: async (_channel, text) => {
      welcomeMessages.push(text);
      return `welcome-${welcomeMessages.length}`;
    },
    storeSecret: async (companyId, name, key, value) => {
      secrets.push({ companyId, name, key, value });
      return { id: `secret-${secrets.length}` };
    },
    bindAgentEnv: async (_agentId, entries) => {
      envBindings.push(entries);
    },
  };
  return { ports, published, secrets, envBindings, welcomeMessages };
}

const relay = null as unknown as CrewRelay;
const pilot = null as unknown as PilotClient;

const input = {
  name: "Christina",
  role: "Market Intelligence",
  reportsTo: "Patrick",
  agentId: "agent-1",
  companyId: "co-1",
  channelIds: ["ch-1", "ch-2"],
  welcomeChannelId: "welcome-ch",
};

describe("hireEmployee", () => {
  it("runs the full §95 pipeline in order and never leaks the private key", async () => {
    const { ports, published, secrets, envBindings, welcomeMessages } = makeFakes();
    const result = await hireEmployee(config, relay, pilot, input, ports);

    // profile: kind 0, signed by agent key, with name + role + reports-to
    expect(published[0]).toMatchObject({ kind: 0, signer: "agent" });
    const profile = JSON.parse(published[0].content);
    expect(profile.name).toBe("Christina");
    expect(profile.about).toBe("Market Intelligence Reports to Patrick.");

    // enrollment + both channel joins as bot
    expect(published.slice(1)).toHaveLength(2);
    expect(published[1].tags).toEqual([["h", "ch-1"], ["p", result.pubkey], ["role", "bot"]]);

    // custody: secret stored, env bound via secret_ref, key never in env value
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({ companyId: "co-1", key: "CREW_PRIVATE_KEY" });
    expect(secrets[0].name).toBe("crew-private-key-christina");
    expect(envBindings[0]).toEqual({
      CREW_PRIVATE_KEY: { type: "secret_ref", secretId: "secret-1" },
      CREW_RELAY_URL: "wss://relay.test",
    });

    // welcome posted as gateway identity
    expect(welcomeMessages[0]).toContain("Christina");

    // result is secret-free
    expect(result).toEqual({
      pubkey: result.pubkey,
      profileEventId: "evt-1",
      enrolledInRelay: true,
      joinedChannelIds: ["ch-1", "ch-2"],
      secretId: "secret-1",
      welcomeEventId: "welcome-1",
    });
    expect(JSON.stringify(result)).not.toContain("sk1");
  });

  it("degrades on enrollment failure but still completes custody", async () => {
    const { ports, secrets } = makeFakes();
    ports.enrollRelayMember = async () => {
      throw new Error("crew-admin exited 1");
    };
    const result = await hireEmployee(config, relay, pilot, input, ports);
    expect(result.enrolledInRelay).toBe(false);
    expect(result.joinedChannelIds).toEqual(["ch-1", "ch-2"]);
    expect(secrets).toHaveLength(1);
  });

  it("reports per-channel join failures instead of aborting the hire", async () => {
    const { ports } = makeFakes();
    ports.joinChannel = async (channelId) => {
      if (channelId === "ch-1") throw new Error("relay rejected");
    };
    const result = await hireEmployee(config, relay, pilot, input, ports);
    expect(result.joinedChannelIds).toEqual(["ch-2"]);
  });

  it("fails the hire when custody (secret store) fails", async () => {
    const { ports } = makeFakes();
    ports.storeSecret = async () => {
      throw new Error("Pilot API 403");
    };
    await expect(hireEmployee(config, relay, pilot, input, ports)).rejects.toThrow(
      "Pilot API 403",
    );
  });

  it("skips the welcome post when no welcome channel is configured", async () => {
    const { ports, welcomeMessages } = makeFakes();
    const result = await hireEmployee(
      config,
      relay,
      pilot,
      { ...input, welcomeChannelId: undefined },
      ports,
    );
    expect(welcomeMessages).toHaveLength(0);
    expect(result.welcomeEventId).toBeUndefined();
  });
});
