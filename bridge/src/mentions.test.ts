import { describe, expect, it } from "vitest";
import { parseMentionTargets, threadRootOf } from "./mentions.js";

const ev = (tags: string[][]) => ({ tags }) as never;

describe("mentions", () => {
  it("extracts p-tag pubkeys", () => {
    expect(parseMentionTargets(ev([["p", "a".repeat(64)], ["p", "b".repeat(64)], ["t", "x"]]))).toEqual(["a".repeat(64), "b".repeat(64)]);
  });
  it("uses root marker when present", () => {
    expect(threadRootOf(ev([["e", "aaa", "", "root"], ["e", "bbb"]]))).toBe("aaa");
  });
  it("falls back to event id", () => {
    expect(threadRootOf({ tags: [], id: "xyz" } as never)).toBe("xyz");
  });
});
