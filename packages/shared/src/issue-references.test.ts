import { describe, expect, it } from "vitest";
import {
  buildIssueReferenceHref,
  extractIssueReferenceIdentifiers,
  findIssueReferenceMatches,
  normalizeIssueIdentifier,
  parseIssueReferenceHref,
} from "./issue-references.js";

describe("issue references", () => {
  it("normalizes identifiers to uppercase", () => {
    expect(normalizeIssueIdentifier("pil-123")).toBe("PIL-123");
    expect(normalizeIssueIdentifier("pc1a2-7")).toBe("PC1A2-7");
    expect(normalizeIssueIdentifier("not-an-issue")).toBeNull();
  });

  it("parses relative and absolute issue hrefs", () => {
    expect(parseIssueReferenceHref("/issues/PIL-123")).toEqual({ identifier: "PIL-123" });
    expect(parseIssueReferenceHref("/PIL/issues/pil-456")).toEqual({ identifier: "PIL-456" });
    expect(parseIssueReferenceHref("https://pilot.test/PIL/issues/pil-789#comment-1")).toEqual({
      identifier: "PIL-789",
    });
    expect(parseIssueReferenceHref("https://pilot.test/projects/PIL-789")).toBeNull();
  });

  it("builds canonical issue hrefs", () => {
    expect(buildIssueReferenceHref("pil-123")).toBe("/issues/PIL-123");
  });

  it("finds identifiers and issue paths in plain text", () => {
    expect(findIssueReferenceMatches("See PIL-1, /issues/PC1A2-2, and https://x.test/PIL/issues/pc1a2-3.")).toEqual([
      { index: 4, length: 5, identifier: "PIL-1", matchedText: "PIL-1" },
      { index: 11, length: 15, identifier: "PC1A2-2", matchedText: "/issues/PC1A2-2" },
      {
        index: 32,
        length: 33,
        identifier: "PC1A2-3",
        matchedText: "https://x.test/PIL/issues/pc1a2-3",
      },
    ]);
  });

  it("trims unmatched square brackets from issue path tokens", () => {
    expect(findIssueReferenceMatches("See /issues/PIL-123] for context.")).toEqual([
      { index: 4, length: 15, identifier: "PIL-123", matchedText: "/issues/PIL-123" },
    ]);
  });

  it("extracts and dedupes references from markdown", () => {
    expect(extractIssueReferenceIdentifiers("PIL-1 [again](/issues/pil-1) PIL-2")).toEqual(["PIL-1", "PIL-2"]);
  });

  it("ignores inline code and fenced code blocks", () => {
    const markdown = [
      "Use PIL-1 here.",
      "",
      "`PIL-2` should not count.",
      "",
      "```md",
      "PIL-3",
      "/issues/PIL-4",
      "```",
      "",
      "Final /issues/PIL-5 mention.",
    ].join("\n");

    expect(extractIssueReferenceIdentifiers(markdown)).toEqual(["PIL-1", "PIL-5"]);
  });
});
