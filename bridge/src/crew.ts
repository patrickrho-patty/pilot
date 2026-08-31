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
  channels: Record<string, { companyId: string; name: string }>;
  agents: Record<
    string,
    { pilotAgentId: string; pubkey: string; allowedSenders: string[] }
  >;
};

export function loadMapping(path: string): BridgeMapping {
  return JSON.parse(readFileSync(path, "utf8")) as BridgeMapping;
}
