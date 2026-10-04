import { describe, expect, it } from "vitest";
import { parseChannelList, validateMapping } from "./crew.js";

describe("parseChannelList", () => {
  it("finds a channel uuid by name from compact JSON", () => {
    const out = JSON.stringify([
      { id: "c-1", name: "market-intel" },
      { id: "c-2", name: "general" },
    ]);
    expect(parseChannelList(out, "market-intel")).toBe("c-1");
    expect(parseChannelList(out, "nope")).toBeNull();
    expect(parseChannelList("not json", "x")).toBeNull();
  });
});

const CH = "11111111-1111-1111-1111-111111111111";
const PK = "a".repeat(64);

function good() {
  return {
    channels: { [CH]: { companyId: "co-1", name: "market-intel" } },
    agents: {
      christina: { pilotAgentId: "agent-1", pubkey: PK, allowedSenders: ["b".repeat(64)] },
    },
  };
}

describe("validateMapping", () => {
  it("accepts a well-formed mapping and lowercases pubkeys", () => {
    const { errors, mapping } = validateMapping(good());
    expect(errors).toEqual([]);
    expect(mapping?.agents.christina.pubkey).toBe(PK);
    expect(Object.keys(mapping?.channels ?? {})).toEqual([CH]);
  });

  it("rejects a non-UUID channel key", () => {
    const { errors } = validateMapping({
      ...good(),
      channels: { "market-intel": { companyId: "co-1" } },
    });
    expect(errors.join("\n")).toContain("key must be a Crew channel UUID");
  });

  it("rejects a non-hex agent pubkey", () => {
    const bad = good();
    bad.agents.christina.pubkey = "not-hex";
    const { errors } = validateMapping(bad);
    expect(errors.join("\n")).toContain("pubkey: must be 64 hex chars");
  });

  it("flags an empty allowedSenders as unusable rather than valid", () => {
    const bad = good();
    bad.agents.christina.allowedSenders = [];
    const { errors } = validateMapping(bad);
    expect(errors.join("\n")).toContain("nobody can assign work to christina");
  });

  it("reports every problem at once", () => {
    const { errors } = validateMapping({ agents: { x: {} } });
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.join("\n")).toContain("channels: required");
  });
});
