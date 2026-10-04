import { describe, expect, it } from "vitest";
import type { BridgeConfig } from "./config.js";
import type { BridgeMapping } from "./crew.js";
import { offboardEmployee, type OffboardPorts } from "./offboard.js";
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
  rateLimit: { perWindow: 20, windowSeconds: 60 },
};

const mapping: BridgeMapping = {
  channels: { "ch-1": { companyId: "co-1", name: "market" }, "ch-2": { companyId: "co-1", name: "general" } },
  agents: {
    christina: {
      pilotAgentId: "agent-1",
      pubkey: "a".repeat(64),
      allowedSenders: ["b".repeat(64)],
    },
  },
};

function makeFakes() {
  const events: Array<{ kind: number; tags: string[][] }> = [];
  const revoked: string[] = [];
  const unbound: Array<{ agentId: string; keys: string[] }> = [];
  let tombstonePublished = false;

  const ports: OffboardPorts = {
    publishAsAgent: async () => {
      tombstonePublished = true;
      return "tombstone-evt";
    },
    leaveChannel: async (channelId, pubkey) => {
      events.push({ kind: 9001, tags: [["h", channelId], ["p", pubkey]] });
    },
    revokeRelayMember: async (pubkey) => {
      revoked.push(pubkey);
    },
    unbindAgentEnv: async (agentId, keys) => {
      unbound.push({ agentId, keys });
    },
  };
  return { ports, events, revoked, unbound, isTombstoned: () => tombstonePublished };
}

const relay = null as unknown as CrewRelay;
const pilot = null as unknown as PilotClient;

describe("offboardEmployee", () => {
  it("leaves all mapped channels, revokes enrollment, unbinds env, and audits", async () => {
    const { ports, events, revoked, unbound } = makeFakes();
    const result = await offboardEmployee(config, relay, pilot, mapping, {
      name: "christina",
      reason: "contract ended",
    }, ports);

    expect(result).toMatchObject({
      name: "christina",
      pubkey: "a".repeat(64),
      leftChannelIds: ["ch-1", "ch-2"],
      tombstoned: false, // no agent key provided → §95 degrade
      enrollmentRevoked: true,
      envUnbound: true,
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 9001, tags: [["h", "ch-1"], ["p", "a".repeat(64)]] });
    expect(revoked).toEqual(["a".repeat(64)]);
    expect(unbound).toEqual([
      { agentId: "agent-1", keys: ["CREW_PRIVATE_KEY", "CREW_RELAY_URL"] },
    ]);
    expect(result.auditedAt).toBeTruthy();
  });

  it("tombstones the kind:0 profile when the agent key file is provided", async () => {
    const { ports, isTombstoned } = makeFakes();
    // publishAsAgent is faked; agentKeyFile content is read via readFileSync,
    // so point it at a real temp file.
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const keyFile = join(mkdtempSync(join(tmpdir(), "offboard-")), "agent.key");
    writeFileSync(keyFile, "e".repeat(64));

    const result = await offboardEmployee(config, relay, pilot, mapping, {
      name: "christina",
      agentKeyFile: keyFile,
    }, ports);

    expect(isTombstoned()).toBe(true);
    expect(result.tombstoned).toBe(true);
  });

  it("degrades per-step: channel and revocation failures still produce an audit trail", async () => {
    const { ports } = makeFakes();
    ports.leaveChannel = async (channelId) => {
      if (channelId === "ch-1") throw new Error("relay rejected");
    };
    ports.revokeRelayMember = async () => {
      throw new Error("crew-admin exited 1");
    };
    const result = await offboardEmployee(config, relay, pilot, mapping, {
      name: "christina",
    }, ports);

    expect(result.leftChannelIds).toEqual(["ch-2"]);
    expect(result.enrollmentRevoked).toBe(false);
    expect(result.auditedAt).toBeTruthy();
  });

  it("fails fast for an unknown employee with no pubkey override", async () => {
    const { ports } = makeFakes();
    await expect(
      offboardEmployee(config, relay, pilot, mapping, { name: "ghost" }, ports),
    ).rejects.toThrow("unknown employee ghost");
  });
});
