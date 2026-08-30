import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listGeminiSkills,
  syncGeminiSkills,
} from "@pilotai/adapter-gemini-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("gemini local skill sync", () => {
  const pilotKey = "pilotai/pilot/pilot";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Pilot skills and installs them into the Gemini skills home", async () => {
    const home = await makeTempDir("pilot-gemini-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "gemini_local",
      config: {
        env: {
          HOME: home,
        },
        pilotSkillSync: {
          desiredSkills: [pilotKey],
        },
      },
    } as const;

    const before = await listGeminiSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(pilotKey);
    expect(before.entries.find((entry) => entry.key === pilotKey)?.state).toBe("missing");

    const after = await syncGeminiSkills(ctx, [pilotKey]);
    expect(after.entries.find((entry) => entry.key === pilotKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".gemini", "skills", "pilot"))).isSymbolicLink()).toBe(true);
  });
});
