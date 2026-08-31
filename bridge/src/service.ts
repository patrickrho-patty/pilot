import type { BridgeConfig } from "./config.js";
import {
  sendGatewayAck,
  type BridgeMapping,
} from "./crew.js";
import { parseMentionTargets, threadRootOf } from "./mentions.js";
import type { PilotClient } from "./pilot.js";
import type { NostrEvent } from "./relay.js";
import type { BridgeStore } from "./store.js";

export type HandleResult =
  | { action: "ignored"; reason: string }
  | { action: "issue-created"; issueId: string; issueUrl: string }
  | { action: "commented"; issueId: string };

export type AckSender = (
  channelUuid: string,
  replyToEventId: string,
  text: string,
) => Promise<void>;

export type BridgeServiceOptions = {
  /** Deterministic uuid for tests; defaults to crypto.randomUUID. */
  uuid?: () => string;
  /** Acknowledgment sender; defaults to the crew-cli gateway ack. */
  sendAck?: AckSender;
};

const MAX_TITLE = 80;

function hTagOf(event: NostrEvent): string | null {
  for (const [tag, value] of event.tags) {
    if (tag === "h" && typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function titleFrom(content: string): string {
  const firstLine = content.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine.length <= MAX_TITLE) return firstLine || "(empty message)";
  return `${firstLine.slice(0, MAX_TITLE - 1)}…`;
}

export function renderOriginFooter(
  channelId: string,
  event: NostrEvent,
  threadRoot: string,
  correlationId: string,
): string {
  return [
    "## Origin",
    "",
    "- Source: Crew",
    `- Crew channel: \`crew://channel/${channelId}\``,
    `- Crew thread: \`crew://message?channel=${channelId}&id=${event.id}&thread=${threadRoot}\``,
    `- Crew requester pubkey: \`${event.pubkey}\``,
    `- Gateway correlation id: \`${correlationId}\``,
  ].join("\n");
}

/**
 * Bridge service core (CREW_INTEGRATION.md §13.3 gateway algorithm,
 * §16.1 follow-up algorithm).
 *
 * Receipt semantics: `seen` is marked only AFTER successful handling, so a
 * failed Pilot write is retried on the next replay; duplicate suppression
 * during normal operation still holds because success marks the receipt.
 */
export class BridgeService {
  private readonly uuid: () => string;
  private readonly sendAck: AckSender;

  constructor(
    private readonly config: BridgeConfig,
    private readonly mapping: BridgeMapping,
    private readonly store: BridgeStore,
    private readonly pilot: PilotClient,
    options: BridgeServiceOptions = {},
  ) {
    this.uuid =
      options.uuid ??
      (() => globalThis.crypto.randomUUID());
    this.sendAck =
      options.sendAck ??
      ((channelUuid, replyToEventId, text) =>
        sendGatewayAck(
          this.config.admin.crewCliPath,
          {
            CREW_RELAY_URL: this.config.relayUrl,
            CREW_PRIVATE_KEY: this.config.gatewayPrivateKey,
          },
          channelUuid,
          replyToEventId,
          text,
        ));
  }

  /** Agent (name, mapping entry) mentioned by pubkey, or null. */
  private resolveAgent(mentioned: string[]): [string, BridgeMapping["agents"][string]] | null {
    for (const [name, agent] of Object.entries(this.mapping.agents)) {
      if (mentioned.includes(agent.pubkey.toLowerCase())) return [name, agent];
    }
    return null;
  }

  private senderAuthorized(
    agent: BridgeMapping["agents"][string],
    senderPubkey: string,
  ): boolean {
    return agent.allowedSenders.map((s) => s.toLowerCase()).includes(senderPubkey.toLowerCase());
  }

  private async ackSafely(
    channelId: string,
    replyToEventId: string,
    text: string,
  ): Promise<void> {
    // §1627: the service acknowledgment is optional — never fail the
    // handling path because the ack post failed.
    try {
      await this.sendAck(channelId, replyToEventId, text);
    } catch (err) {
      console.warn(`gateway ack failed for ${replyToEventId}:`, err);
    }
  }

  async handleEvent(event: NostrEvent): Promise<HandleResult> {
    if (event.kind !== 40002) {
      return { action: "ignored", reason: "unsupported-kind" };
    }

    // §13.3 step 2–3: receipt check (completion is marked at the end).
    if (this.store.seen(event.id)) {
      return { action: "ignored", reason: "duplicate" };
    }

    // §13.3 step 1: configured channel only.
    const channelId = hTagOf(event);
    if (!channelId) return { action: "ignored", reason: "missing-h-tag" };
    const channel = this.mapping.channels[channelId];
    if (!channel) return { action: "ignored", reason: "unmapped-channel" };

    const threadRoot = threadRootOf(event);
    const mentioned = parseMentionTargets(event);
    const resolved = this.resolveAgent(mentioned);
    if (!resolved) return { action: "ignored", reason: "no-agent-mention" };
    const [agentName, agent] = resolved;

    // §13.3 step 8: sender authorization gate.
    if (!this.senderAuthorized(agent, event.pubkey)) {
      return { action: "ignored", reason: "unauthorized-sender" };
    }

    // §16.1: linked thread → follow-up comment, never a duplicate issue.
    const existing = this.store.issueForThread(threadRoot);
    if (existing) {
      const comment = [
        `Crew follow-up from \`${event.pubkey.slice(0, 8)}\`:`,
        "",
        `> ${event.content}`,
        "",
        `Source: \`crew://message?channel=${channelId}&id=${event.id}&thread=${threadRoot}\``,
        "",
        `[@${agentName}](agent://${agent.pilotAgentId}) please incorporate this follow-up into the current work.`,
      ].join("\n");
      await this.pilot.addIssueComment(existing.issueId, comment);
      this.store.markSeen(event.id);
      await this.ackSafely(
        channelId,
        event.id,
        `Noted — added to ${existing.issueUrl}`,
      );
      return { action: "commented", issueId: existing.issueId };
    }

    // §13.3 steps 10–12: create the Pilot issue, then persist correlation.
    const correlationId = this.uuid();
    const description = `${event.content}\n\n${renderOriginFooter(channelId, event, threadRoot, correlationId)}`;
    const created = await this.pilot.createIssue({
      companyId: channel.companyId,
      title: titleFrom(event.content),
      description,
      assigneeAgentId: agent.pilotAgentId,
    });
    this.store.linkThread(threadRoot, channelId, created.id, created.url, channel.companyId);

    // §13.3 step 14: receipt completes only after success.
    this.store.markSeen(event.id);

    // §13.3 step 13: optional gateway acknowledgment with the issue id.
    await this.ackSafely(
      channelId,
      event.id,
      `Filed as a Pilot issue for ${agentName}: ${created.url}`,
    );
    return { action: "issue-created", issueId: created.id, issueUrl: created.url };
  }
}
