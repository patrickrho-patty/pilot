import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@pilotai/adapter-utils";
import {
  buildRuntimeMountedSkillSnapshot,
  readPilotRuntimeSkillEntries,
  resolvePilotDesiredSkillNames,
} from "@pilotai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

async function buildCodexSkillSnapshot(
  config: Record<string, unknown>,
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPilotRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolvePilotDesiredSkillNames(config, availableEntries);
  return buildRuntimeMountedSkillSnapshot({
    adapterType: "codex_local",
    availableEntries,
    desiredSkills,
    configuredDetail: "Will be linked into the effective CODEX_HOME/skills/ directory on the next run.",
  });
}

export async function listCodexSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildCodexSkillSnapshot(ctx.config);
}

export async function syncCodexSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildCodexSkillSnapshot(ctx.config);
}

export function resolveCodexDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string; required?: boolean }>,
) {
  return resolvePilotDesiredSkillNames(config, availableEntries);
}
