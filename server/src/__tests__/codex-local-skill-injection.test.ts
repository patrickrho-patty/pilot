import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCodexSkillsInjected } from "@pilotai/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createPilotRepoSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "server"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "adapter-utils"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"name":"pilot"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const pilotKey = "pilotai/pilot/pilot";
  const createAgentKey = "pilotai/pilot/pilot-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("repairs a Codex Pilot skill symlink that still points at another live checkout", async () => {
    const currentRepo = await makeTempDir("pilot-codex-current-");
    const oldRepo = await makeTempDir("pilot-codex-old-");
    const skillsHome = await makeTempDir("pilot-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createPilotRepoSkill(currentRepo, "pilot");
    await createPilotRepoSkill(currentRepo, "pilot-create-agent");
    await createPilotRepoSkill(oldRepo, "pilot");
    await fs.symlink(path.join(oldRepo, "skills", "pilot"), path.join(skillsHome, "pilot"));

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [
          {
            key: pilotKey,
            runtimeName: "pilot",
            source: path.join(currentRepo, "skills", "pilot"),
          },
          {
            key: createAgentKey,
            runtimeName: "pilot-create-agent",
            source: path.join(currentRepo, "skills", "pilot-create-agent"),
          },
        ],
      },
    );

    expect(await fs.realpath(path.join(skillsHome, "pilot"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "pilot")),
    );
    expect(await fs.realpath(path.join(skillsHome, "pilot-create-agent"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "pilot-create-agent")),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Repaired Codex skill "pilot"'),
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Injected Codex skill "pilot-create-agent"'),
      }),
    );
  });

  it("preserves a custom Codex skill symlink outside Pilot repo checkouts", async () => {
    const currentRepo = await makeTempDir("pilot-codex-current-");
    const customRoot = await makeTempDir("pilot-codex-custom-");
    const skillsHome = await makeTempDir("pilot-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(customRoot);
    cleanupDirs.add(skillsHome);

    await createPilotRepoSkill(currentRepo, "pilot");
    await createCustomSkill(customRoot, "pilot");
    await fs.symlink(path.join(customRoot, "custom", "pilot"), path.join(skillsHome, "pilot"));

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: pilotKey,
        runtimeName: "pilot",
        source: path.join(currentRepo, "skills", "pilot"),
      }],
    });

    expect(await fs.realpath(path.join(skillsHome, "pilot"))).toBe(
      await fs.realpath(path.join(customRoot, "custom", "pilot")),
    );
  });

  it("prunes broken symlinks for unavailable Pilot repo skills before Codex starts", async () => {
    const currentRepo = await makeTempDir("pilot-codex-current-");
    const oldRepo = await makeTempDir("pilot-codex-old-");
    const skillsHome = await makeTempDir("pilot-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createPilotRepoSkill(currentRepo, "pilot");
    await createPilotRepoSkill(oldRepo, "agent-browser");
    const staleTarget = path.join(oldRepo, "skills", "agent-browser");
    await fs.symlink(staleTarget, path.join(skillsHome, "agent-browser"));
    await fs.rm(staleTarget, { recursive: true, force: true });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{
          key: pilotKey,
          runtimeName: "pilot",
          source: path.join(currentRepo, "skills", "pilot"),
        }],
      },
    );

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Removed stale Codex skill "agent-browser"'),
      }),
    );
  });

  it("preserves other live Pilot skill symlinks in the shared workspace skill directory", async () => {
    const currentRepo = await makeTempDir("pilot-codex-current-");
    const skillsHome = await makeTempDir("pilot-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createPilotRepoSkill(currentRepo, "pilot");
    await createPilotRepoSkill(currentRepo, "agent-browser");
    await fs.symlink(
      path.join(currentRepo, "skills", "agent-browser"),
      path.join(skillsHome, "agent-browser"),
    );

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: pilotKey,
        runtimeName: "pilot",
        source: path.join(currentRepo, "skills", "pilot"),
      }],
    });

    expect((await fs.lstat(path.join(skillsHome, "pilot"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "agent-browser"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(skillsHome, "agent-browser"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "agent-browser")),
    );
  });
});
