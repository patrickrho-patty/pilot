import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listPiSkills,
  syncPiSkills,
} from "@pilotai/adapter-pi-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("pi local skill sync", () => {
  const pilotKey = "pilotai/pilot/pilot";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Pilot skills and installs them into the Pi skills home", async () => {
    const home = await makeTempDir("pilot-pi-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "pi_local",
      config: {
        env: {
          HOME: home,
        },
        pilotSkillSync: {
          desiredSkills: [pilotKey],
        },
      },
    } as const;

    const before = await listPiSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(pilotKey);
    expect(before.entries.find((entry) => entry.key === pilotKey)?.state).toBe("missing");

    const after = await syncPiSkills(ctx, [pilotKey]);
    expect(after.entries.find((entry) => entry.key === pilotKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".pi", "agent", "skills", "pilot"))).isSymbolicLink()).toBe(true);
  });
});
