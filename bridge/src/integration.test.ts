import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BridgeConfig } from "./config.js";
import {
  applyIntegrationConfig,
  EMPTY_INTEGRATION_CONFIG,
  KIND_AGENT_CREATION_POLICY,
  publishPilotPolicy,
  readCreationPolicy,
  readIntegrationConfig,
  relayHttpUrl,
} from "./integration.js";
import type { CrewRelay } from "./relay.js";

const adminKeyPath = join(tmpdir(), "bridge-integration-test-admin-key.txt");
writeFileSync(adminKeyPath, "a".repeat(64));

const config: BridgeConfig = {
  relayUrl: "wss://crew.test",
  pilotBaseUrl: "https://pilot.test",
  pilotApiKey: "test-key",
  gatewayPrivateKey: "d".repeat(64),
  dbPath: ":memory:",
  port: 0,
  admin: { crewCliPath: "crew", relayAdminKeyPath: adminKeyPath },
  rateLimit: { perWindow: 20, windowSeconds: 60 },
};

function fakeRelay() {
  const published: Array<{ kind: number; tags: string[][]; content: string }> = [];
  const relay = {
    publish: async (event: { kind: number; tags: string[][]; content: string }) => {
      published.push({ kind: event.kind, tags: event.tags, content: event.content });
    },
  } as unknown as CrewRelay;
  return { relay, published };
}

describe("relayHttpUrl", () => {
  it("maps relay websocket schemes to http", () => {
    expect(relayHttpUrl("wss://crew.patty.io")).toBe("https://crew.patty.io");
    expect(relayHttpUrl("ws://localhost:8080/")).toBe("http://localhost:8080");
  });
});

describe("readCreationPolicy", () => {
  it("reads the relay's effective policy head", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ policy: "pilot", author: "abc" }), {
        status: 200,
      })) as unknown as typeof fetch;
    await expect(readCreationPolicy("wss://crew.test", fetchImpl)).resolves.toBe("pilot");
  });

  it("defaults to admin-only when the relay omits the field", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(readCreationPolicy("wss://crew.test", fetchImpl)).resolves.toBe("admin-only");
  });

  it("throws on a non-200 read", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(readCreationPolicy("wss://crew.test", fetchImpl)).rejects.toThrow(
      "creation policy read failed: HTTP 503",
    );
  });
});

describe("readIntegrationConfig (PAT-1998/PAT-2005)", () => {
  it("reads the relay's effective config", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          integrated: true,
          boardUrl: "https://pilot.example",
          channels: {
            "11111111-1111-1111-1111-111111111111": {
              companyId: "co-1",
              projectId: "22222222-2222-2222-2222-222222222222",
            },
          },
          author: "abc",
          eventId: "def",
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const config = await readIntegrationConfig("wss://crew.test", fetchImpl);
    expect(config.integrated).toBe(true);
    expect(config.boardUrl).toBe("https://pilot.example");
    expect(config.channels["11111111-1111-1111-1111-111111111111"].companyId).toBe("co-1");
  });

  it("treats a never-configured relay as not integrated", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ integrated: false }), { status: 200 })) as unknown as typeof fetch;
    const config = await readIntegrationConfig("wss://crew.test", fetchImpl);
    expect(config).toEqual(EMPTY_INTEGRATION_CONFIG);
  });

  it("throws on a failed read rather than pretending the community is unconfigured", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(readIntegrationConfig("wss://crew.test", fetchImpl)).rejects.toThrow(
      "integration config read failed: HTTP 503",
    );
  });
});

describe("applyIntegrationConfig", () => {
  const CH = "11111111-1111-1111-1111-111111111111";
  const fileMapping = {
    channels: { [CH]: { companyId: "co-old", name: "market-intel", retentionDays: 30, defaultAgent: "christina" } },
    agents: { christina: { pilotAgentId: "agent-1", pubkey: "a".repeat(64), allowedSenders: [] } },
  };

  it("lets the relay win for the destination and keeps the file's other fields", () => {
    const merged = applyIntegrationConfig(fileMapping, {
      integrated: true,
      boardUrl: "https://pilot.example",
      channels: { [CH]: { companyId: "co-new", projectId: "22222222-2222-2222-2222-222222222222" } },
      author: null,
      eventId: null,
    });
    expect(merged.channels[CH].companyId).toBe("co-new");
    expect(merged.channels[CH].projectId).toBe("22222222-2222-2222-2222-222222222222");
    // The relay config does not carry these, so the file must survive.
    expect(merged.channels[CH].retentionDays).toBe(30);
    expect(merged.channels[CH].defaultAgent).toBe("christina");
    expect(merged.agents.christina.pilotAgentId).toBe("agent-1");
  });

  it("ignores a relay channel the file does not know", () => {
    const merged = applyIntegrationConfig(fileMapping, {
      integrated: true,
      boardUrl: "https://pilot.example",
      channels: { "99999999-9999-9999-9999-999999999999": { companyId: "co-x", projectId: null } },
      author: null,
      eventId: null,
    });
    // Activating a channel with no agent or retention settings would file work
    // into a company the bridge cannot route.
    expect(Object.keys(merged.channels)).toEqual([CH]);
    expect(merged.channels[CH].companyId).toBe("co-old");
  });

  it("leaves the file mapping untouched when the community is not integrated", () => {
    expect(applyIntegrationConfig(fileMapping, EMPTY_INTEGRATION_CONFIG)).toEqual(fileMapping);
  });
});

describe("publishPilotPolicy", () => {
  it("publishes the kind-39090 pilot gate when the community is not already pilot", async () => {
    const { relay, published } = fakeRelay();
    const result = await publishPilotPolicy(config, relay, {
      readPolicy: async () => "admin-only",
    });

    expect(result.changed).toBe(true);
    expect(result.previous).toBe("admin-only");
    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe(KIND_AGENT_CREATION_POLICY);
    expect(published[0].tags).toEqual([["d", "community"]]);
    expect(JSON.parse(published[0].content)).toEqual({ policy: "pilot" });
  });

  it("leaves an already-pilot community untouched", async () => {
    const { relay, published } = fakeRelay();
    const result = await publishPilotPolicy(config, relay, {
      readPolicy: async () => "pilot",
    });

    expect(result).toEqual({ changed: false, previous: "pilot" });
    expect(published).toHaveLength(0);
  });

  it("replaces a members policy so the community lands in pilot mode", async () => {
    const { relay, published } = fakeRelay();
    const result = await publishPilotPolicy(config, relay, {
      readPolicy: async () => "members",
    });

    expect(result.changed).toBe(true);
    expect(result.previous).toBe("members");
    expect(published).toHaveLength(1);
  });

  it("propagates a read failure instead of publishing blind", async () => {
    const { relay, published } = fakeRelay();
    await expect(
      publishPilotPolicy(config, relay, {
        readPolicy: async () => {
          throw new Error("creation policy read failed: HTTP 500");
        },
      }),
    ).rejects.toThrow("creation policy read failed: HTTP 500");
    expect(published).toHaveLength(0);
  });
});
