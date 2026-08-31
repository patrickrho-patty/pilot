import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { finalizeEvent, type Event as NostrEvent } from "nostr-tools";
import type { BridgeConfig } from "./config.js";
import { hexToBytes, type CrewRelay } from "./relay.js";
import type { BridgeMapping } from "./crew.js";
import type { PilotClient } from "./pilot.js";

export type OffboardInput = {
  /** Mapping key of the agent (or explicit pubkey via `pubkey`). */
  name: string;
  pubkey?: string;
  reason?: string;
  /** Channels to leave; defaults to all mapped channels. */
  channelIds?: string[];
  /**
   * Agent private key file, when the operator can retrieve it from custody —
   * enables the kind:0 tombstone. Absent → tombstone is skipped (§95 degrade).
   */
  agentKeyFile?: string;
};

export type OffboardResult = {
  name: string;
  pubkey: string;
  leftChannelIds: string[];
  tombstoned: boolean;
  enrollmentRevoked: boolean;
  envUnbound: boolean;
  auditedAt: string;
};

export type OffboardPorts = {
  publishAsAgent?: (privateKeyHex: string, template: OutboxTemplate) => Promise<string>;
  leaveChannel?: (channelId: string, pubkey: string) => Promise<void>;
  revokeRelayMember?: (pubkey: string) => Promise<void>;
  unbindAgentEnv?: (agentId: string, keys: string[]) => Promise<void>;
};

type OutboxTemplate = {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
};

function runAdmin(crewAdminPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(crewAdminPath, args, { timeout: 30_000 });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`crew-admin exited ${code}: ${stderr.slice(0, 200)}`)),
    );
    child.on("error", (err) => reject(new Error(`crew-admin spawn failed: ${err.message}`)));
  });
}

function resolvePorts(
  config: BridgeConfig,
  relay: CrewRelay,
  pilot: PilotClient,
  overrides: OffboardPorts,
): Required<OffboardPorts> {
  return {
    publishAsAgent:
      overrides.publishAsAgent ??
      (async (privateKeyHex, template) => {
        const signed = finalizeEvent(
          {
            kind: template.kind,
            created_at: template.created_at,
            tags: template.tags,
            content: template.content,
          },
          hexToBytes(privateKeyHex),
        );
        await relay.publish(signed);
        return signed.id;
      }),

    leaveChannel:
      overrides.leaveChannel ??
      (async (channelId, pubkey) => {
        // kind 9001 remove-member, signed by the relay-admin key.
        const adminPrivateKeyHex = readFileSync(
          config.admin.relayAdminKeyPath,
          "utf8",
        ).trim();
        const signed = finalizeEvent(
          {
            kind: 9001,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ["h", channelId],
              ["p", pubkey.toLowerCase()],
            ],
            content: "",
          },
          hexToBytes(adminPrivateKeyHex),
        );
        await relay.publish(signed);
      }),

    revokeRelayMember:
      overrides.revokeRelayMember ??
      (async (pubkey) => {
        if (!config.admin.crewAdminPath) {
          console.warn(
            "CREW_ADMIN_PATH not set — skipping enrollment revocation; run `crew-admin remove-member` manually",
          );
          return;
        }
        await runAdmin(config.admin.crewAdminPath, [
          "remove-member",
          "--pubkey",
          pubkey,
        ]);
      }),

    unbindAgentEnv:
      overrides.unbindAgentEnv ??
      (async (agentId, keys) => {
        // Read → drop keys → PATCH full env (server shallow-merges top level).
        await pilot.removeAgentEnvKeys(agentId, keys);
      }),
  };
}

/**
 * §95 offboard pipeline (mirror of hire): leave channels → tombstone (when
 * the agent key is available) → revoke enrollment → unbind env → audit line.
 * Every step except the audit line degrades to a warning; the audit record
 * always reflects exactly what happened.
 */
export async function offboardEmployee(
  config: BridgeConfig,
  relay: CrewRelay,
  pilot: PilotClient,
  mapping: BridgeMapping,
  input: OffboardInput,
  portOverrides: OffboardPorts = {},
): Promise<OffboardResult> {
  const ports = resolvePorts(config, relay, pilot, portOverrides);

  const agentEntry = mapping.agents[input.name];
  const pubkey = (input.pubkey ?? agentEntry?.pubkey)?.toLowerCase();
  if (!pubkey) {
    throw new Error(
      `unknown employee ${input.name}: not in mapping and no --pubkey given`,
    );
  }
  const agentId = agentEntry?.pilotAgentId ?? input.name;
  const channelIds = input.channelIds ?? Object.keys(mapping.channels);

  // 1. Leave mapped channels (kind 9001, relay-admin signed).
  const leftChannelIds: string[] = [];
  for (const channelId of channelIds) {
    try {
      await ports.leaveChannel(channelId, pubkey);
      leftChannelIds.push(channelId);
    } catch (err) {
      console.warn(`channel leave failed for ${channelId}:`, err);
    }
  }

  // 2. Tombstone kind:0 — only when the agent key is retrievable (§95 degrade).
  let tombstoned = false;
  if (input.agentKeyFile) {
    try {
      const privateKeyHex = readFileSync(input.agentKeyFile, "utf8").trim();
      await ports.publishAsAgent(privateKeyHex, {
        pubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 0,
        tags: [],
        content: JSON.stringify({
          name: input.name,
          display_name: input.name,
          about: `Offboarded${input.reason ? ` — ${input.reason}` : ""}. This account is retired; the history is preserved.`,
        }),
      });
      tombstoned = true;
    } catch (err) {
      console.warn("tombstone failed:", err);
    }
  } else {
    console.warn(
      "agent key not provided — skipping kind:0 tombstone (enrollment revocation + audit only)",
    );
  }

  // 3. Revoke relay enrollment.
  let enrollmentRevoked = true;
  try {
    await ports.revokeRelayMember(pubkey);
  } catch (err) {
    enrollmentRevoked = false;
    console.warn("enrollment revocation failed:", err);
  }

  // 4. Best-effort env unbind so the runtime can no longer auth as the agent.
  let envUnbound = true;
  try {
    await ports.unbindAgentEnv(agentId, ["CREW_PRIVATE_KEY", "CREW_RELAY_URL"]);
  } catch (err) {
    envUnbound = false;
    console.warn("env unbind failed:", err);
  }

  // 5. Structured audit line — the one step that never degrades.
  const auditedAt = new Date().toISOString();
  const audit = {
    action: "offboard",
    name: input.name,
    pubkey,
    agentId,
    leftChannelIds,
    tombstoned,
    enrollmentRevoked,
    envUnbound,
    reason: input.reason ?? null,
    auditedAt,
  };
  console.log(JSON.stringify(audit));

  return {
    name: input.name,
    pubkey,
    leftChannelIds,
    tombstoned,
    enrollmentRevoked,
    envUnbound,
    auditedAt,
  };
}
