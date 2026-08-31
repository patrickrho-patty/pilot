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
});
