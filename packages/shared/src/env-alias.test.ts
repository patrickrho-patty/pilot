import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLegacyPilotEnvAliases } from "./env-alias.js";

// The fresh-start epoch has no legacy env contract: the alias helper is a
// no-op that never reads, writes, or reports legacy names.
describe("applyLegacyPilotEnvAliases", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves PILOT_X untouched and reports nothing mapped", () => {
    vi.stubEnv("PILOT_API_URL", "https://example.test");
    const mapped = applyLegacyPilotEnvAliases();
    expect(process.env.PILOT_API_URL).toBe("https://example.test");
    expect(mapped).toEqual([]);
  });

  it("never mutates nested PILOT_X shapes", () => {
    vi.stubEnv("PILOT_HOME", "/data");
    vi.stubEnv("PILOT_INSTANCE_ID", "inst-1");
    vi.stubEnv("PILOT_DB_BACKUP_MAX_AGE_HOURS", "24");
    const mapped = applyLegacyPilotEnvAliases();
    expect(process.env.PILOT_HOME).toBe("/data");
    expect(process.env.PILOT_INSTANCE_ID).toBe("inst-1");
    expect(process.env.PILOT_DB_BACKUP_MAX_AGE_HOURS).toBe("24");
    expect(mapped).toEqual([]);
  });

  it("does not consume unrelated names", () => {
    vi.stubEnv("PILOTAI_ORG", "x");
    const mapped = applyLegacyPilotEnvAliases();
    expect(process.env.PILOTAI_ORG).toBe("x");
    expect(mapped).toEqual([]);
  });

  it("returns [] when there is nothing to do", () => {
    const mapped = applyLegacyPilotEnvAliases();
    expect(mapped).toEqual([]);
  });
});
