import os from "node:os";
import path from "node:path";

export const DEFAULT_PILOT_INSTANCE_ID = "default";
export const PILOT_CONFIG_BASENAME = "config.json";
export const PILOT_ENV_FILENAME = ".env";

const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

export function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolvePilotHomeDir(homeOverride?: string): string {
  const raw = homeOverride?.trim() || process.env.PILOT_HOME?.trim();
  if (raw) return path.resolve(expandHomePrefix(raw));
  return path.resolve(os.homedir(), ".pilot");
}

export function resolvePilotInstanceId(instanceIdOverride?: string): string {
  const raw = instanceIdOverride?.trim() || process.env.PILOT_INSTANCE_ID?.trim() || DEFAULT_PILOT_INSTANCE_ID;
  if (!PATH_SEGMENT_RE.test(raw)) {
    throw new Error(`Invalid PILOT_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolvePilotInstanceRoot(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilotHomeDir(input.homeDir), "instances", resolvePilotInstanceId(input.instanceId));
}

export function resolvePilotInstanceConfigPath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilotInstanceRoot(input), PILOT_CONFIG_BASENAME);
}

export function resolvePilotConfigPathForInstance(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return resolvePilotInstanceConfigPath(input);
}

export function resolvePilotEnvPathForConfig(configPath: string): string {
  return path.resolve(path.dirname(configPath), PILOT_ENV_FILENAME);
}

export function resolveDefaultEmbeddedPostgresDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilotInstanceRoot(input), "db");
}

export function resolveDefaultLogsDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilotInstanceRoot(input), "logs");
}

export function resolveDefaultSecretsKeyFilePath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilotInstanceRoot(input), "secrets", "master.key");
}

export function resolveDefaultStorageDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilotInstanceRoot(input), "data", "storage");
}

export function resolveDefaultBackupDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilotInstanceRoot(input), "data", "backups");
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}
