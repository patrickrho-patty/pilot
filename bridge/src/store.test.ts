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

  it("prunes only rows older than the cutoff, per channel", () => {
    const dir = mkdtempSync("/tmp/bridge-test-");
    const store = new BridgeStore(`${dir}/db.sqlite`);
    store.markSeen("old-event");
    store.markSeen("new-event");
    store.linkThread("root-old", "ch1", "iss1", "u1", "co1");
    store.linkThread("root-new", "ch1", "iss2", "u2", "co1");
    store.linkThread("root-other", "ch2", "iss3", "u3", "co1");
    store.linkMessage("msg-old", "iss1", "u1", "co1", "root-old");

    const old = "2020-01-01T00:00:00.000Z";
    store.transaction(() => {
      // Backdate two rows to simulate age.
      (store as unknown as { db: { prepare: (s: string) => { run: (...a: string[]) => void } } }).db
        .prepare("UPDATE seen_events SET created_at = ? WHERE id = ?")
        .run(old, "old-event");
      (store as unknown as { db: { prepare: (s: string) => { run: (...a: string[]) => void } } }).db
        .prepare("UPDATE thread_issue SET created_at = ? WHERE thread_root = ?")
        .run(old, "root-old");
      (store as unknown as { db: { prepare: (s: string) => { run: (...a: string[]) => void } } }).db
        .prepare("UPDATE message_issue SET created_at = ? WHERE event_id = ?")
        .run(old, "msg-old");
    });

    const cutoff = "2021-01-01T00:00:00.000Z";
    expect(store.pruneChannelRetention("ch1", cutoff).thread_issue).toBe(1);
    expect(store.issueForThread("root-old")).toBeNull();
    expect(store.issueForThread("root-new")?.issueId).toBe("iss2");
    // ch2 is a different channel and keeps its own retention window
    expect(store.issueForThread("root-other")?.issueId).toBe("iss3");

    const global = store.pruneRetention(cutoff);
    expect(global.seen_events).toBe(1);
    expect(store.seen("new-event")).toBe(true);
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
