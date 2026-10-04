import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

export function runCrewCli(
  cliPath: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cliPath, args, {
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.on("close", (code) => resolve({ ok: code === 0, stdout }));
    child.on("error", () => resolve({ ok: false, stdout: "" }));
  });
}

export async function sendGatewayAck(
  cliPath: string,
  env: Record<string, string>,
  channelUuid: string,
  replyToEventId: string,
  text: string,
): Promise<void> {
  await sendGatewayMessage(cliPath, env, channelUuid, text, replyToEventId);
}

export async function sendGatewayMessage(
  cliPath: string,
  env: Record<string, string>,
  channelUuid: string,
  text: string,
  replyToEventId?: string,
): Promise<void> {
  const args = [
    "messages",
    "send",
    "--channel",
    channelUuid,
    ...(replyToEventId ? ["--reply-to", replyToEventId] : []),
    "--content",
    text,
  ];
  const res = await runCrewCli(cliPath, args, env);
  if (!res.ok) throw new Error("gateway message failed: crew-cli exited non-zero");
}

export function parseChannelList(stdout: string, channelName: string): string | null {
  try {
    const rows = JSON.parse(stdout) as Array<{ id: string; name: string }>;
    return rows.find((r) => r.name === channelName)?.id ?? null;
  } catch {
    return null;
  }
}

export type BridgeMapping = {
  channels: Record<string, { companyId: string; name: string; projectId?: string }>;
  agents: Record<
    string,
    { pilotAgentId: string; pubkey: string; allowedSenders: string[] }
  >;
};

const HEX64 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a mapping document (PAT-1986). Returns every problem at once — an
 * operator fixing one error at a time through a restart loop is how a
 * mis-mapped channel silently drops customer messages.
 */
export function validateMapping(raw: unknown): { errors: string[]; mapping?: BridgeMapping } {
  const errors: string[] = [];
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  if (!isRecord(raw)) return { errors: ["mapping must be a JSON object"] };

  const channels: BridgeMapping["channels"] = {};
  const agents: BridgeMapping["agents"] = {};

  if (raw.channels === undefined) {
    errors.push("channels: required");
  } else if (!isRecord(raw.channels)) {
    errors.push("channels: must be an object keyed by Crew channel UUID");
  } else {
    for (const [channelId, value] of Object.entries(raw.channels)) {
      if (!UUID.test(channelId)) {
        errors.push(`channels.${channelId}: key must be a Crew channel UUID (the h tag)`);
        continue;
      }
      if (!isRecord(value)) {
        errors.push(`channels.${channelId}: must be an object`);
        continue;
      }
      const { companyId, name, projectId } = value;
      if (typeof companyId !== "string" || companyId.length === 0) {
        errors.push(`channels.${channelId}.companyId: required`);
      }
      if (projectId !== undefined && (typeof projectId !== "string" || !UUID.test(projectId))) {
        errors.push(
          `channels.${channelId}.projectId: must be a Pilot project GUID (needed for a task_bridge-scoped key)`,
        );
      }
      if (name !== undefined && typeof name !== "string") {
        errors.push(`channels.${channelId}.name: must be a string`);
      }
      if (typeof companyId === "string" && companyId.length > 0) {
        channels[channelId] = {
          companyId,
          name: typeof name === "string" ? name : channelId.slice(0, 8),
          ...(typeof projectId === "string" ? { projectId } : {}),
        };
      }
    }
  }

  if (raw.agents === undefined) {
    errors.push("agents: required");
  } else if (!isRecord(raw.agents)) {
    errors.push("agents: must be an object keyed by employee display name");
  } else {
    for (const [name, value] of Object.entries(raw.agents)) {
      if (!isRecord(value)) {
        errors.push(`agents.${name}: must be an object`);
        continue;
      }
      const { pilotAgentId, pubkey, allowedSenders } = value;
      if (typeof pilotAgentId !== "string" || pilotAgentId.length === 0) {
        errors.push(`agents.${name}.pilotAgentId: required`);
      }
      if (typeof pubkey !== "string" || !HEX64.test(pubkey)) {
        errors.push(`agents.${name}.pubkey: must be 64 hex chars (the agent's Crew npub)`);
      }
      if (!Array.isArray(allowedSenders)) {
        errors.push(`agents.${name}.allowedSenders: must be an array of pubkeys`);
      } else {
        allowedSenders.forEach((sender, index) => {
          if (typeof sender !== "string" || !HEX64.test(sender)) {
            errors.push(`agents.${name}.allowedSenders[${index}]: must be 64 hex chars`);
          }
        });
        if (allowedSenders.length === 0) {
          // Empty is legal but means the employee can never be mentioned.
          errors.push(
            `agents.${name}.allowedSenders: empty — nobody can assign work to ${name}`,
          );
        }
      }
      if (
        typeof pilotAgentId === "string" &&
        typeof pubkey === "string" &&
        HEX64.test(pubkey) &&
        Array.isArray(allowedSenders)
      ) {
        agents[name] = {
          pilotAgentId,
          pubkey: pubkey.toLowerCase(),
          allowedSenders: allowedSenders.map((s) => String(s).toLowerCase()),
        };
      }
    }
  }

  // Cross-check: every agent's channel set is reachable (at least one channel).
  if (Object.keys(channels).length === 0 && errors.length === 0) {
    errors.push("channels: at least one channel mapping is required");
  }

  return errors.length > 0 ? { errors } : { errors, mapping: { channels, agents } };
}

/**
 * Load and validate the mapping. A malformed mapping stops the bridge at
 * startup: running with a partially-loaded map silently drops mentions.
 */
export function loadMapping(path: string): BridgeMapping {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`mapping ${path} is not valid JSON: ${String(err)}`);
  }
  const { errors, mapping } = validateMapping(raw);
  if (!mapping) {
    throw new Error(`mapping ${path} is invalid:\n  - ${errors.join("\n  - ")}`);
  }
  return mapping;
}
