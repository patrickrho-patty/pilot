import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLegacyPaperclipEnvAliases } from "./env-alias.js";

describe("applyLegacyPaperclipEnvAliases", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps set PAPERCLIP_X to unset PILOT_X", () => {
    vi.stubEnv("PILOT_API_URL", "https://example.test");
    const mapped = applyLegacyPaperclipEnvAliases();
    expect(process.env.PILOT_API_URL).toBe("https://example.test");
    expect(mapped).toContain("PILOT_API_URL");
  });

  it("never overwrites an explicitly set PILOT_X", () => {
    vi.stubEnv("PILOT_API_URL", "https://legacy.test");
    vi.stubEnv("PILOT_API_URL", "https://new.test");
    applyLegacyPaperclipEnvAliases();
    expect(process.env.PILOT_API_URL).toBe("https://new.test");
  });

  it("maps every PAPERCLIP_X shape used by the codebase (HOME, INSTANCE_ID, nested subkeys)", () => {
    vi.stubEnv("PILOT_HOME", "/data");
    vi.stubEnv("PILOT_INSTANCE_ID", "inst-1");
    vi.stubEnv("PILOT_DB_BACKUP_MAX_AGE_HOURS", "24");
    const mapped = applyLegacyPaperclipEnvAliases();
    expect(process.env.PILOT_HOME).toBe("/data");
    expect(process.env.PILOT_INSTANCE_ID).toBe("inst-1");
    expect(process.env.PILOT_DB_BACKUP_MAX_AGE_HOURS).toBe("24");
    expect(mapped).toHaveLength(3);
  });

  it("ignores names that merely start with the legacy word (PAPERCLIPAI_ORG)", () => {
    vi.stubEnv("PAPERCLIPAI_ORG", "x");
    const mapped = applyLegacyPaperclipEnvAliases();
    expect(process.env.PILOTAI_ORG).toBeUndefined();
    expect(mapped).toEqual([]);
  });

  it("returns [] when nothing legacy is set", () => {
    const mapped = applyLegacyPaperclipEnvAliases();
    expect(mapped).toEqual([]);
  });
});
