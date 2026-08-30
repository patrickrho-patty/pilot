import { describe, expect, it } from "vitest";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  isBoardPathWithoutPrefix,
  toCompanyRelativePath,
} from "./company-routes";

describe("company routes", () => {
  it("treats execution workspace paths as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123")).toBe(true);
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123/routines")).toBe(true);
    expect(extractCompanyPrefixFromPath("/execution-workspaces/workspace-123")).toBeNull();
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123", "PIL")).toBe(
      "/PIL/execution-workspaces/workspace-123",
    );
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123/routines", "PIL")).toBe(
      "/PIL/execution-workspaces/workspace-123/routines",
    );
  });

  it("normalizes prefixed execution workspace paths back to company-relative paths", () => {
    expect(toCompanyRelativePath("/PIL/execution-workspaces/workspace-123")).toBe(
      "/execution-workspaces/workspace-123",
    );
    expect(toCompanyRelativePath("/PIL/execution-workspaces/workspace-123/routines")).toBe(
      "/execution-workspaces/workspace-123/routines",
    );
  });

  it("treats /search as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/search")).toBe(true);
    expect(extractCompanyPrefixFromPath("/search")).toBeNull();
    expect(applyCompanyPrefix("/search", "PIL")).toBe("/PIL/search");
    expect(applyCompanyPrefix("/search?q=hello%20world", "PIL")).toBe("/PIL/search?q=hello%20world");
    expect(toCompanyRelativePath("/PIL/search?q=foo")).toBe("/search?q=foo");
  });

  it("rewrites company package paths with the active prefix", () => {
    expect(applyCompanyPrefix("/company/export", "NEU")).toBe("/NEU/company/export");
    expect(applyCompanyPrefix("/company/import", "NEU")).toBe("/NEU/company/import");
    expect(applyCompanyPrefix("/org", "NEU")).toBe("/NEU/org");
  });

  it("does not double-apply the company prefix", () => {
    expect(applyCompanyPrefix("/NEU/company/export", "NEU")).toBe("/NEU/company/export");
  });

  it("normalizes prefixed company export file URLs for parsing", () => {
    expect(toCompanyRelativePath("/NEU/company/export/files/agents/ceo/AGENTS.md")).toBe(
      "/company/export/files/agents/ceo/AGENTS.md",
    );
  });

  // Regression for PIL-10257: Team Catalog navigation (auto-select + row/file
  // clicks) produces company-relative `/teams-catalog/<key>` paths. Without
  // `teams-catalog` in the board-route allowlist, `extractCompanyPrefixFromPath`
  // misread the first segment as a company prefix and `useNavigate` skipped the
  // rewrite, dropping the `/PIL/` prefix and crashing into "Company not found".
  it("re-prefixes team catalog routes so navigate preserves the company prefix", () => {
    expect(isBoardPathWithoutPrefix("/teams")).toBe(false);
    expect(isBoardPathWithoutPrefix("/teams-catalog")).toBe(true);
    expect(isBoardPathWithoutPrefix("/teams-catalog/core-exec-team")).toBe(true);
    expect(extractCompanyPrefixFromPath("/teams-catalog/core-exec-team")).toBeNull();

    // Auto-select effect: `/teams-catalog/<first-key>` must gain the `/PIL/` prefix.
    expect(applyCompanyPrefix("/teams-catalog/core-exec-team", "PIL")).toBe(
      "/PIL/teams-catalog/core-exec-team",
    );
    // File-tree click: nested `/files/<encoded>` path is preserved under the prefix.
    expect(applyCompanyPrefix("/teams-catalog/core-exec-team/files/TEAM.md", "PIL")).toBe(
      "/PIL/teams-catalog/core-exec-team/files/TEAM.md",
    );
    // Already-prefixed paths are left untouched (idempotent — no double prefix).
    expect(applyCompanyPrefix("/PIL/teams-catalog/core-exec-team", "PIL")).toBe(
      "/PIL/teams-catalog/core-exec-team",
    );
    // Round-trips back to a company-relative path.
    expect(toCompanyRelativePath("/PIL/teams-catalog/core-exec-team")).toBe(
      "/teams-catalog/core-exec-team",
    );
  });

  it("treats /artifacts as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/artifacts")).toBe(true);
    expect(extractCompanyPrefixFromPath("/artifacts")).toBeNull();
    expect(applyCompanyPrefix("/artifacts", "PIL")).toBe("/PIL/artifacts");
    expect(toCompanyRelativePath("/PIL/artifacts")).toBe("/artifacts");
  });

  it("treats /audit as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/audit")).toBe(true);
    expect(extractCompanyPrefixFromPath("/audit")).toBeNull();
    expect(applyCompanyPrefix("/audit", "PIL")).toBe("/PIL/audit");
    expect(toCompanyRelativePath("/PIL/audit")).toBe("/audit");
  });

  it("treats /tools routes as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/tools")).toBe(true);
    expect(isBoardPathWithoutPrefix("/tools/runtime")).toBe(true);
    expect(extractCompanyPrefixFromPath("/tools")).toBeNull();
    expect(applyCompanyPrefix("/tools", "PIL")).toBe("/PIL/tools");
    expect(applyCompanyPrefix("/tools/runtime", "PIL")).toBe("/PIL/tools/runtime");
    expect(applyCompanyPrefix("/PIL/tools/runtime", "PIL")).toBe("/PIL/tools/runtime");
    expect(toCompanyRelativePath("/PIL/tools/runtime")).toBe("/tools/runtime");
  });

  it("recognizes Decisions without retaining the legacy attention route", () => {
    expect(isBoardPathWithoutPrefix("/decisions")).toBe(true);
    expect(extractCompanyPrefixFromPath("/decisions")).toBeNull();
    expect(applyCompanyPrefix("/decisions", "PIL")).toBe("/PIL/decisions");

    expect(isBoardPathWithoutPrefix("/attention")).toBe(false);
    expect(extractCompanyPrefixFromPath("/attention")).toBe("ATTENTION");
  });

  it("treats /timeline as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/timeline")).toBe(true);
    expect(extractCompanyPrefixFromPath("/timeline")).toBeNull();
    expect(applyCompanyPrefix("/timeline", "PIL")).toBe("/PIL/timeline");
    expect(toCompanyRelativePath("/PIL/timeline")).toBe("/timeline");
  });

  it("treats Skill Studio create mode as an unprefixed board route", () => {
    expect(isBoardPathWithoutPrefix("/skills/studio/new")).toBe(true);
    expect(extractCompanyPrefixFromPath("/skills/studio/new")).toBeNull();
    expect(applyCompanyPrefix("/skills/studio/new?forkFrom=skill-1", "PIL")).toBe(
      "/PIL/skills/studio/new?forkFrom=skill-1",
    );
    expect(toCompanyRelativePath("/PIL/skills/studio/new?forkFrom=skill-1")).toBe(
      "/skills/studio/new?forkFrom=skill-1",
    );
  });

  it("preserves artifact deep-link anchors when applying the company prefix", () => {
    expect(applyCompanyPrefix("/issues/PIL-10205#work-product-wp-1", "PIL")).toBe(
      "/PIL/issues/PIL-10205#work-product-wp-1",
    );
    expect(applyCompanyPrefix("/issues/PIL-10306#attachment-att-1", "PIL")).toBe(
      "/PIL/issues/PIL-10306#attachment-att-1",
    );
    // Already-prefixed paths are returned untouched.
    expect(applyCompanyPrefix("/PIL/artifacts", "PIL")).toBe("/PIL/artifacts");
  });
});
