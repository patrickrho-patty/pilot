import fs from "node:fs";
import {
  findPilotConfigKeyWarnings,
  pilotConfigSchema,
  type PilotConfig,
} from "@paperclipai/shared";
import { ZodError } from "zod";
import { resolvePilotConfigPath } from "./paths.js";

function formatConfigValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
}

export function readConfigFile(): PilotConfig | null {
  const configPath = resolvePilotConfigPath();

  if (!fs.existsSync(configPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Paperclip config at ${configPath}: failed to read or parse JSON: ${reason}`);
  }

  try {
    const config = pilotConfigSchema.parse(raw);
    for (const warning of findPilotConfigKeyWarnings(config)) {
      console.warn(
        `Unknown config key ${warning.path}; did you mean ${warning.suggestion}? It will be preserved.`,
      );
    }
    return config;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Invalid Paperclip config at ${configPath}: ${formatConfigValidationError(error)}`);
    }

    throw error;
  }
}
