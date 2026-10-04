import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BridgeStore } from "./store.js";

describe("BridgeStore", () => {
  it("dedupes event ids and correlates threads", () => {
    const dir = mkdtempSync("/tmp/bridge-test-");
    const store = new BridgeStore(`${dir}/db.sqlite`);
    expect(store.seen("e1")).toBe(false);
    store.markSeen("e1");
    expect(store.seen("e1")).toBe(true);
    store.linkThread("root1", "ch1", "iss1", "https://pilot.patty.io/co/issues/iss1", "co");
    expect(store.issueForThread("root1")?.issueId).toBe("iss1");
    expect(store.issueForThread("missing")).toBeNull();
    store.close();
  });

  it("bumps attempt count across repeated failures and preserves first attempt time", () => {
    const dir = mkdtempSync("/tmp/bridge-test-");
    const store = new BridgeStore(`${dir}/db.sqlite`);
    const base = {
      eventId: "e1",
      channelId: "ch1",
      threadRoot: "root1",
      senderPubkey: "pk1",
      targetMapping: "co1",
      diagnostic: "Pilot API 503",
      replayStatus: "pending" as const,
    };
    store.recordFailure({ ...base, failureClass: "retryable-server" });
    store.recordFailure({ ...base, failureClass: "auth", diagnostic: "Pilot API 401" });

    const rows = store.listFailures();
    expect(rows).toHaveLength(1);
    expect(rows[0].attemptCount).toBe(2);
    expect(rows[0].failureClass).toBe("auth");
    expect(rows[0].diagnostic).toBe("Pilot API 401");
    expect(rows[0].firstAttemptAt).toBeTruthy();
    store.close();
  });

  it("records and exports §58 audit rows oldest first", () => {
    const dir = mkdtempSync("/tmp/bridge-test-");
    const store = new BridgeStore(`${dir}/db.sqlite`);
    const base = {
      correlationId: "corr-1",
      crewEventId: "e1",
      crewChannelId: "ch1",
      crewThreadRoot: "root1",
      senderPubkey: "pk1",
      issueId: "iss1",
      issueUrl: "https://pilot.test/co/issues/iss1",
      agentId: "agent-1",
      detail: null,
    };
    store.recordAudit({ ...base, action: "issue-created", at: "2026-10-02T00:00:00.000Z" });
    store.recordAudit({ ...base, action: "issue-commented", at: "2026-10-02T00:01:00.000Z" });

    const all = store.listAudit();
    expect(all.map((r) => r.action)).toEqual(["issue-created", "issue-commented"]);
    expect(all[0].correlationId).toBe("corr-1");
    expect(all[0].issueId).toBe("iss1");

    const since = store.listAudit("2026-10-02T00:00:30.000Z");
    expect(since.map((r) => r.action)).toEqual(["issue-commented"]);
    store.close();
  });

  it("replay clears the receipt so the relay can replay the event", () => {
    const dir = mkdtempSync("/tmp/bridge-test-");
    const store = new BridgeStore(`${dir}/db.sqlite`);
    store.markSeen("e1");
    store.recordFailure({
      eventId: "e1",
      channelId: "ch1",
      threadRoot: "root1",
      senderPubkey: "pk1",
      targetMapping: "co1",
      failureClass: "client-error",
      diagnostic: "mapping missing",
      replayStatus: "abandoned",
    });
    expect(store.seen("e1")).toBe(true);

    store.markForReplay("e1");

    expect(store.seen("e1")).toBe(false);
    expect(store.listFailures("pending")).toHaveLength(1);
    store.markReplayed("e1");
    expect(store.listFailures("pending")).toHaveLength(0);
    expect(store.listFailures("replayed")).toHaveLength(1);
    store.close();
  });
});
