import { existsSync, lstatSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasVerifiedWorktreeSeedManifest } from "./worktree-seed-manifest.js";

function parseEnvFile(contents: string): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (!value) {
      entries[key] = "";
      continue;
    }
    if (value.startsWith("#")) {
      entries[key] = "";
      continue;
    }

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      entries[key] = value.slice(1, -1);
      continue;
    }

    entries[key] = value.replace(/\s+#.*$/, "").trim();
  }

  return entries;
}

type WorktreeEnvBootstrapResult =
  | { envPath: null; missingEnv: false }
  | { envPath: string; missingEnv: true }
  | { envPath: string; missingEnv: false };

export function isLinkedGitWorktreeCheckout(rootDir: string): boolean {
  const gitMetadataPath = path.join(rootDir, ".git");
  if (!existsSync(gitMetadataPath)) return false;

  const stat = lstatSync(gitMetadataPath);
  if (!stat.isFile()) return false;

  return readFileSync(gitMetadataPath, "utf8").trimStart().startsWith("gitdir:");
}

export function resolveWorktreeEnvFilePath(rootDir: string): string {
  return path.resolve(rootDir, ".pilot", ".env");
}

export function isWorktreeSeedPending(rootDir: string): boolean {
  const markerDir = path.resolve(rootDir, ".pilot");
  const manifestPath = path.resolve(markerDir, "seed-manifest.json");
  if (existsSync(manifestPath)) {
    return !hasVerifiedWorktreeSeedManifest(manifestPath);
  }
  return existsSync(path.resolve(markerDir, "seed-pending"))
    && !existsSync(path.resolve(markerDir, "seed-complete"));
}

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}

function resolveDefaultWorktreeHome(env: NodeJS.ProcessEnv): string {
  return path.resolve(expandHomePrefix(env.PILOT_WORKTREES_DIR?.trim() || "~/.pilot-worktrees"));
}

function repairStaleMigratedWorktreeEnvEntries(
  rootDir: string,
  entries: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const localConfigPath = path.resolve(rootDir, ".pilot", "config.json");
  const configuredPath = entries.PILOT_CONFIG?.trim();
  if (!configuredPath) return entries;

  const resolvedConfiguredPath = resolveHomeAwarePath(configuredPath);
  const staleConfigPath =
    resolvedConfiguredPath !== localConfigPath &&
    !existsSync(resolvedConfiguredPath) &&
    existsSync(localConfigPath);
  if (!staleConfigPath) return entries;

  const homeDir = resolveDefaultWorktreeHome(env);
  return {
    ...entries,
    PILOT_HOME: homeDir,
    PILOT_CONFIG: localConfigPath,
    PILOT_CONTEXT: path.resolve(homeDir, "context.json"),
  };
}

export function bootstrapDevRunnerWorktreeEnv(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
): WorktreeEnvBootstrapResult {
  if (!isLinkedGitWorktreeCheckout(rootDir)) {
    return {
      envPath: null,
      missingEnv: false,
    };
  }

  const envPath = resolveWorktreeEnvFilePath(rootDir);
  if (!existsSync(envPath)) {
    return {
      envPath,
      missingEnv: true,
    };
  }

/**
 * Env files written before the brand rename carry PILOT_* keys; map them
 * onto unset PILOT_* equivalents at load (same policy as the boot shim).
 */
function normalizeLegacyEnvEntries(entries: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...entries };
  for (const key of Object.keys(out)) {
    if (key.startsWith("PILOT_") && key !== "PILOT_") {
      const target = "PILOT_" + key.slice("PILOT_".length);
      if (out[target] === undefined) out[target] = out[key];
    }
  }
  return out;
}

  const entries = repairStaleMigratedWorktreeEnvEntries(
    rootDir,
    normalizeLegacyEnvEntries(parseEnvFile(readFileSync(envPath, "utf8"))),
    env,
  );
  for (const [key, value] of Object.entries(entries)) {
    if (typeof env[key] === "string" && env[key]!.trim().length > 0) continue;
    env[key] = value;
  }

  return {
    envPath,
    missingEnv: false,
  };
}
