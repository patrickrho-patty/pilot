import { readFileSync } from "node:fs";
import { finalizeEvent } from "nostr-tools";
import type { BridgeConfig } from "./config.js";
import type { BridgeMapping } from "./crew.js";
import { hexToBytes, type CrewRelay } from "./relay.js";

/**
 * The community integration config (PAT-1998/PAT-2005), read from the relay.
 *
 * The relay owns this because an admin must be able to change the connection
 * setting and channel mapping without an operator editing a file and restarting
 * a pod. The bridge overlays it on its own mapping file, which stays
 * authoritative for everything the relay config does not carry (agents, users,
 * repos, retention, per-channel defaults).
 */
export type RelayIntegrationConfig = {
  integrated: boolean;
  boardUrl: string | null;
  channels: Record<string, { companyId: string; projectId: string | null }>;
  author: string | null;
  eventId: string | null;
};

export const EMPTY_INTEGRATION_CONFIG: RelayIntegrationConfig = {
  integrated: false,
  boardUrl: null,
  channels: {},
  author: null,
  eventId: null,
};

/** Crew community agent-creation policy head (PAT-1982). */
export const KIND_AGENT_CREATION_POLICY = 39090;
/** Community-wide scope tag; a stray `h` tag must not channel-scope this. */
export const COMMUNITY_D_TAG = "community";
/** The value that flips Crew desktops into pilot mode. */
export const PILOT_POLICY = "pilot";

export function relayHttpUrl(relayUrl: string): string {
  return relayUrl.replace(/^ws/, "http").replace(/\/$/, "");
}

/**
 * Read the effective integration config. A relay that has never been configured
 * answers with the not-integrated default.
 */
export async function readIntegrationConfig(
  relayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayIntegrationConfig> {
  const resp = await fetchImpl(`${relayHttpUrl(relayUrl)}/api/workspace/integration-config`, {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`integration config read failed: HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as Partial<RelayIntegrationConfig>;
  return {
    integrated: body.integrated === true,
    boardUrl: typeof body.boardUrl === "string" ? body.boardUrl : null,
    channels: body.channels && typeof body.channels === "object" ? body.channels : {},
    author: typeof body.author === "string" ? body.author : null,
    eventId: typeof body.eventId === "string" ? body.eventId : null,
  };
}

/**
 * Overlay the relay config's channel destinations onto the file mapping.
 *
 * The relay wins for `companyId`/`projectId` because it is the surface an admin
 * edits; the file keeps `name`, `retentionDays` and `defaultAgent`, which the
 * relay config does not carry. A relay entry for a channel the file does not
 * know is ignored: filing work into a company needs the agent and retention
 * settings the file holds, so a half-known channel must not be activated.
 */
export function applyIntegrationConfig(
  mapping: BridgeMapping,
  config: RelayIntegrationConfig,
): BridgeMapping {
  if (!config.integrated || Object.keys(config.channels).length === 0) {
    return mapping;
  }
  const channels: BridgeMapping["channels"] = { ...mapping.channels };
  for (const [channelId, destination] of Object.entries(config.channels)) {
    const existing = channels[channelId];
    if (!existing) continue;
    channels[channelId] = {
      ...existing,
      companyId: destination.companyId,
      ...(destination.projectId ? { projectId: destination.projectId } : {}),
    };
  }
  return { ...mapping, channels };
}

/**
 * Read the effective policy from the relay. The relay's head selection is the
 * same code the ingest gate enforces with, so we never disagree with it by
 * keeping our own notion of "current".
 */
export async function readCreationPolicy(
  relayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const resp = await fetchImpl(`${relayHttpUrl(relayUrl)}/api/agents/creation-policy`, {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`creation policy read failed: HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as { policy?: unknown };
  return typeof body.policy === "string" ? body.policy : "admin-only";
}

export type PublishResult = {
  /** False when the relay already reported PILOT_POLICY. */
  changed: boolean;
  previous: string;
  eventId?: string;
};

/**
 * Publish the pilot-mode gate: kind 39090, `d` = `community`,
 * `{"policy":"pilot"}`, signed by the relay-admin key.
 *
 * Idempotent by read: an already-`pilot` community is left alone, so a bridge
 * restart never rewrites the head and never moves `author` to the bridge.
 */
export async function publishPilotPolicy(
  config: BridgeConfig,
  relay: CrewRelay,
  deps: { readPolicy?: (relayUrl: string) => Promise<string> } = {},
): Promise<PublishResult> {
  const readPolicy = deps.readPolicy ?? readCreationPolicy;
  const previous = await readPolicy(config.relayUrl);
  if (previous === PILOT_POLICY) {
    return { changed: false, previous };
  }

  const adminPrivateKeyHex = readFileSync(config.admin.relayAdminKeyPath, "utf8").trim();
  const signed = finalizeEvent(
    {
      kind: KIND_AGENT_CREATION_POLICY,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", COMMUNITY_D_TAG]],
      content: JSON.stringify({ policy: PILOT_POLICY }),
    },
    hexToBytes(adminPrivateKeyHex),
  );
  await relay.publish(signed);
  return { changed: true, previous, eventId: signed.id };
}
