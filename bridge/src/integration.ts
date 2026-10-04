import { readFileSync } from "node:fs";
import { finalizeEvent } from "nostr-tools";
import type { BridgeConfig } from "./config.js";
import { hexToBytes, type CrewRelay } from "./relay.js";

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
