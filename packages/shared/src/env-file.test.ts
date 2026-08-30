import { describe, expect, it } from "vitest";
import { encodeEnvValue, updateEnvFileContents } from "./env-file.js";

describe("env file editor", () => {
  it("pins minimal and JSON value encoding", () => {
    expect(encodeEnvValue("plain-value", "minimal")).toBe("plain-value");
    expect(encodeEnvValue("#439edb", "minimal")).toBe('"#439edb"');
    expect(encodeEnvValue("plain-value", "json")).toBe('"plain-value"');
  });

  it("preserves unrelated content and CRLF while updating every stale duplicate", () => {
    const original = [
      "# operator comment",
      "UNKNOWN='keep this encoding'",
      "",
      "export PILOT_HOME = '/old path'  # managed path",
      "PILOT_DUPLICATE=stale",
      'PILOT_DUPLICATE="current"',
      "TRAILING=untouched",
      "",
    ].join("\r\n");

    const updated = updateEnvFileContents(
      original,
      {
        PILOT_HOME: "/new path",
        PILOT_DUPLICATE: "current",
        PILOT_WORKTREE_COLOR: "#439edb",
      },
      { valueEncoding: "minimal" },
    );

    expect(updated).toBe([
      "# operator comment",
      "UNKNOWN='keep this encoding'",
      "",
      'export PILOT_HOME = "/new path"  # managed path',
      "PILOT_DUPLICATE=current",
      'PILOT_DUPLICATE="current"',
      "TRAILING=untouched",
      'PILOT_WORKTREE_COLOR="#439edb"',
      "",
    ].join("\r\n"));
    expect(updated.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("uses JSON encoding for changed values without re-encoding current assignments", () => {
    const original = [
      "PILOT_CURRENT=plain-value",
      "PILOT_CHANGED=old",
      "UNKNOWN=\"operator value\"",
      "",
    ].join("\n");

    expect(
      updateEnvFileContents(
        original,
        {
          PILOT_CURRENT: "plain-value",
          PILOT_CHANGED: "new",
          PILOT_ADDED: "added",
        },
        { valueEncoding: "json" },
      ),
    ).toBe([
      "PILOT_CURRENT=plain-value",
      'PILOT_CHANGED="new"',
      'UNKNOWN="operator value"',
      'PILOT_ADDED="added"',
      "",
    ].join("\n"));
  });

  it("does not treat an unquoted dotenv comment as the managed value", () => {
    expect(
      updateEnvFileContents(
        ["PILOT_COLOR=#439edb", "PILOT_HOME=old# keep this comment"].join("\n"),
        {
          PILOT_COLOR: "#439edb",
          PILOT_HOME: "new",
        },
        { valueEncoding: "minimal" },
      ),
    ).toBe(
      ['PILOT_COLOR="#439edb"#439edb', "PILOT_HOME=new# keep this comment"].join("\n"),
    );
  });

  it("is a no-op when every managed duplicate is already current", () => {
    const original = [
      "export PILOT_HOME = '/same path' # first",
      'PILOT_HOME="/same path"',
      "UNKNOWN=value",
    ].join("\n");

    expect(updateEnvFileContents(original, { PILOT_HOME: "/same path" })).toBe(original);
  });
});
