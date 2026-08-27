import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listKimiSkills,
  syncKimiSkills,
} from "@paperclipai/adapter-kimi-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("kimi local skill sync", () => {
  const pilotKey = "paperclipai/paperclip/paperclip";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Paperclip skills and installs them into the Kimi skills home", async () => {
    const kimiCodeHome = await makeTempDir("paperclip-kimi-skill-sync-");
    cleanupDirs.add(kimiCodeHome);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "kimi_local",
      config: {
        env: {
          KIMI_CODE_HOME: kimiCodeHome,
        },
        paperclipSkillSync: {
          desiredSkills: [pilotKey],
        },
      },
    } as const;

    const before = await listKimiSkills(ctx);
    expect(before.adapterType).toBe("kimi_local");
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(pilotKey);
    expect(before.entries.find((entry) => entry.key === pilotKey)?.state).toBe("missing");

    const after = await syncKimiSkills(ctx, [pilotKey]);
    expect(after.entries.find((entry) => entry.key === pilotKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(kimiCodeHome, "skills", "paperclip"))).isSymbolicLink()).toBe(true);
  });
});
