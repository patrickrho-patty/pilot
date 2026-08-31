import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { verifyCrewEvent } from "./relay.js";

describe("verifyCrewEvent", () => {
  it("accepts a valid signed event", () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      { kind: 40002, created_at: Math.floor(Date.now() / 1000), tags: [], content: "hi" },
      sk,
    );
    expect(verifyCrewEvent(event)).toBe(true);
  });

  it("rejects a tampered event", () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      { kind: 40002, created_at: Math.floor(Date.now() / 1000), tags: [], content: "hi" },
      sk,
    );
    expect(verifyCrewEvent({ ...event, content: "tampered" })).toBe(false);
  });
});
