import { describe, expect, it } from "vitest";
import { parseChannelList } from "./crew.js";

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
