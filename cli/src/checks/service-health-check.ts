import fs from "node:fs/promises";
import type { PilotConfig } from "../config/schema.js";
import { resolvePilotInstanceId } from "../config/home.js";
import { readInstallManifest } from "../install-store.js";
import {
  detectServiceManager,
  type ServiceManagerDetection,
} from "../services/service-manager.js";
import { buildLocalHealthUrl } from "../utils/health-url.js";
import type { CheckResult } from "./index.js";

type HealthResult = { ok: boolean; version: string | null; error?: string };
type ServiceCheckDependencies = {
  detect: (instanceId: string) => Promise<ServiceManagerDetection>;
  probe: (config: PilotConfig) => Promise<HealthResult>;
};

async function probeHealth(config: PilotConfig): Promise<HealthResult> {
  try {
    const response = await fetch(buildLocalHealthUrl(config.server.host, config.server.port), {
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.json()) as {
      status?: unknown;
      serverVersion?: unknown;
      version?: unknown;
    };
    const version = typeof body.serverVersion === "string"
      ? body.serverVersion
      : typeof body.version === "string"
        ? body.version
        : null;
    return { ok: response.ok && body.status === "ok", version };
  } catch (error) {
    return { ok: false, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function serviceHealthChecks(
  config: PilotConfig,
  dependencies: Partial<ServiceCheckDependencies> = {},
): Promise<CheckResult[]> {
  if (process.env.PILOT_SERVICE_MANAGED === "1") return [];

  const deps: ServiceCheckDependencies = {
    detect: (instanceId) => detectServiceManager({ instanceId }),
    probe: probeHealth,
    ...dependencies,
  };
  const instanceId = resolvePilotInstanceId();
  const detection = await deps.detect(instanceId);
  if (!detection.supported) {
    return [{ name: "Background service", status: "pass", message: detection.reason }];
  }

  const manager = detection.manager;
  const status = await manager.status();
  if (!status.installed) {
    return [
      {
        name: "Background service",
        status: "pass",
        message: `Not installed for instance ${instanceId} (optional)`,
      },
    ];
  }

  const results: CheckResult[] = [];
  let definitionCurrent = false;
  try {
    definitionCurrent = (await fs.readFile(manager.definitionPath, "utf8")) === manager.renderDefinition();
  } catch {
    definitionCurrent = false;
  }
  results.push(
    definitionCurrent
      ? { name: "Service definition", status: "pass", message: manager.definitionPath }
      : {
          name: "Service definition",
          status: "fail",
          message: `Missing or drifted definition at ${manager.definitionPath}`,
          repairHint: "Run `pilotai service install` to regenerate the service definition",
        },
  );

  const health = await deps.probe(config);
  results.push(
    status.active
      ? { name: "Service runtime", status: "pass", message: `${status.serviceName} is active` }
      : {
          name: "Service runtime",
          status: "fail",
          message: health.ok
            ? `${status.serviceName} is inactive but the configured port is serving another Pilot process`
            : `${status.serviceName} is ${status.detail ?? "inactive"}`,
          repairHint: "Run `pilotai service start`, or stop the conflicting foreground process first",
        },
  );

  let expectedVersion: string | null = null;
  try {
    expectedVersion = readInstallManifest()?.version ?? null;
  } catch {}
  results.push(
    !health.ok
      ? {
          name: "Service health",
          status: "fail",
          message: health.error ?? "Health endpoint did not report ok",
          repairHint: "Inspect `pilotai service status` and `pilotai service logs`",
        }
      : expectedVersion && health.version !== expectedVersion
        ? {
            name: "Service version",
            status: "fail",
            message: `Running ${health.version ?? "unknown"}; managed install is ${expectedVersion}`,
            repairHint: "Run `pilotai service restart --expected-version " + expectedVersion + "`",
          }
        : {
            name: "Service health",
            status: "pass",
            message: `Healthy${health.version ? ` at version ${health.version}` : ""}`,
          },
  );

  if (status.enabled && status.linger === false) {
    results.push({
      name: "Service linger",
      status: "warn",
      message: "Start-on-login is enabled but systemd user lingering is off",
      repairHint: "Re-run `pilotai service install --enable-linger` if the service must survive logout",
    });
  }

  return results;
}
