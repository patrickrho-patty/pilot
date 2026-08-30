import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCodexSkills,
  syncCodexSkills,
} from "@pilotai/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("codex local skill sync", () => {
  const pilotKey = "pilotai/pilot/pilot";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Pilot skills for workspace injection on the next run", async () => {
    const codexHome = await makeTempDir("pilot-codex-skill-sync-");
    cleanupDirs.add(codexHome);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        pilotSkillSync: {
          desiredSkills: [pilotKey],
        },
      },
    } as const;

    const before = await listCodexSkills(ctx);
    expect(before.mode).toBe("ephemeral");
    expect(before.desiredSkills).toContain(pilotKey);
    expect(before.entries.find((entry) => entry.key === pilotKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === pilotKey)?.detail).toContain("CODEX_HOME/skills/");
  });

  it("does not persist Pilot skills into CODEX_HOME during sync", async () => {
    const codexHome = await makeTempDir("pilot-codex-skill-prune-");
    cleanupDirs.add(codexHome);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        pilotSkillSync: {
          desiredSkills: [pilotKey],
        },
      },
    } as const;

    const after = await syncCodexSkills(configuredCtx, [pilotKey]);
    expect(after.mode).toBe("ephemeral");
    expect(after.entries.find((entry) => entry.key === pilotKey)?.state).toBe("configured");
    await expect(fs.lstat(path.join(codexHome, "skills", "pilot"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("normalizes legacy flat Pilot skill refs before reporting configured state", async () => {
    const codexHome = await makeTempDir("pilot-codex-legacy-skill-sync-");
    cleanupDirs.add(codexHome);

    const snapshot = await listCodexSkills({
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        pilotSkillSync: {
          desiredSkills: ["pilot"],
        },
      },
    });

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.desiredSkills).toContain(pilotKey);
    expect(snapshot.desiredSkills).not.toContain("pilot");
    expect(snapshot.entries.find((entry) => entry.key === pilotKey)?.state).toBe("configured");
    expect(snapshot.entries.find((entry) => entry.key === "pilot")).toBeUndefined();
  });
});
