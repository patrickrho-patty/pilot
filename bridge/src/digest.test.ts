import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BridgeMapping } from "./crew.js";
import { buildDigest, runAwarenessDigest, withinQuietHours } from "./digest.js";
import { BridgeStore } from "./store.js";

const CH = "11111111-1111-1111-1111-111111111111";
const AGENT = "a".repeat(64);

function mapping(agentOverrides: Record<string, unknown> = {}): BridgeMapping {
  return {
    channels: { [CH]: { companyId: "co-1", name: "market-intel" } },
    agents: {
      christina: {
        pilotAgentId: "agent-1",
        pubkey: AGENT,
        allowedSenders: ["b".repeat(64)],
        ...agentOverrides,
      },
    },
  };
}

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-digest-"));
  return new BridgeStore(join(dir, "db.sqlite"));
}

function activity(created_at: number) {
  return [{ id: "e1", pubkey: AGENT, created_at, content: "ACME shipped a new tier" }];
}

describe("withinQuietHours", () => {
  const at = (hhmm: string) => new Date(`2026-10-02T${hhmm}:00.000Z`);

  it("handles a same-day window", () => {
    const q = { start: "09:00", end: "17:00" };
    expect(withinQuietHours(q, at("08:59"))).toBe(false);
    expect(withinQuietHours(q, at("09:00"))).toBe(true);
    expect(withinQuietHours(q, at("16:59"))).toBe(true);
    expect(withinQuietHours(q, at("17:00"))).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    const q = { start: "22:00", end: "07:00" };
    expect(withinQuietHours(q, at("23:30"))).toBe(true);
    expect(withinQuietHours(q, at("02:00"))).toBe(true);
    expect(withinQuietHours(q, at("12:00"))).toBe(false);
  });

  it("treats an equal start and end as no quiet window", () => {
    expect(withinQuietHours({ start: "09:00", end: "09:00" }, at("09:00"))).toBe(false);
  });

  it("is never quiet when unset", () => {
    expect(withinQuietHours(undefined, at("03:00"))).toBe(false);
  });
});

describe("buildDigest", () => {
  it("states the window, the count and what the employee may do", () => {
    const text = buildDigest({
      channelName: "market-intel",
      channelId: CH,
      since: "2026-10-01T00:00:00.000Z",
      messages: activity(1759363200),
    });
    expect(text).toContain("# Channel activity: #market-intel");
    expect(text).toContain(`crew://channel/${CH}`);
    expect(text).toContain("- Messages: 1");
    expect(text).toContain("ACME shipped a new tier");
    expect(text).toContain("ignore it");
    expect(text).toContain("propose if it is work worth doing");
  });
});

describe("runAwarenessDigest (§100)", () => {
  it("files activity and advances the cursor only after filing", async () => {
    const store = makeStore();
    const filed: Array<{ messageCount: number }> = [];
    const outcomes = await runAwarenessDigest({
      mapping: mapping(),
      store,
      readActivity: async () => activity(1759363200),
      file: async (input) => {
        filed.push({ messageCount: input.messageCount });
        return { issueId: "iss-1", issueUrl: "https://pilot.test/iss-1" };
      },
      uuid: () => "corr-1",
    });

    expect(outcomes[0]).toMatchObject({ outcome: "filed", messageCount: 1, agent: "christina" });
    expect(filed).toHaveLength(1);
    expect(store.digestCursor(CH)).toBe(new Date(1759363200 * 1000).toISOString());
    store.close();
  });

  it("does not advance the cursor when filing fails, so the window replays", async () => {
    const store = makeStore();
    await expect(
      runAwarenessDigest({
        mapping: mapping(),
        store,
        readActivity: async () => activity(1759363200),
        file: async () => {
          throw new Error("Pilot API 503");
        },
      }),
    ).rejects.toThrow("Pilot API 503");
    expect(store.digestCursor(CH)).toBeNull();
    store.close();
  });

  it("skips a channel with no new activity", async () => {
    const store = makeStore();
    const outcomes = await runAwarenessDigest({
      mapping: mapping(),
      store,
      readActivity: async () => [],
      file: async () => {
        throw new Error("must not file");
      },
    });
    expect(outcomes[0]).toMatchObject({ outcome: "skipped", reason: "no-activity" });
    store.close();
  });

  it("refuses during the agent's quiet hours", async () => {
    const store = makeStore();
    const outcomes = await runAwarenessDigest({
      mapping: mapping({ quietHours: { start: "00:00", end: "23:59" } }),
      store,
      now: () => new Date("2026-10-02T12:00:00.000Z"),
      readActivity: async () => {
        throw new Error("must not read while quiet");
      },
      file: async () => {
        throw new Error("must not file");
      },
    });
    expect(outcomes[0]).toMatchObject({ outcome: "refused", reason: "quiet-hours" });
    store.close();
  });

  it("enforces maxProactivePerDay and reports the refusal", async () => {
    const store = makeStore();
    const at = new Date("2026-10-02T12:00:00.000Z");
    const deps = {
      mapping: mapping({ maxProactivePerDay: 1 }),
      store,
      now: () => at,
      readActivity: async () => activity(1759363200),
      file: async () => ({ issueId: "iss-1", issueUrl: "https://pilot.test/iss-1" }),
      uuid: () => "corr-1",
    };

    const first = await runAwarenessDigest(deps);
    const second = await runAwarenessDigest(deps);

    expect(first[0]).toMatchObject({ outcome: "filed" });
    expect(second[0]).toMatchObject({ outcome: "refused", reason: "proactive-cap" });
    expect(store.proactiveToday("christina", "2026-10-02")).toBe(1);
    store.close();
  });
});
