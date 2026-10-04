import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BridgeConfig } from "./config.js";
import {
  KIND_AGENT_CREATION_POLICY,
  publishPilotPolicy,
  readCreationPolicy,
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
