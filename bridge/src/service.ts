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
  | { action: "commented"; issueId: string }
  | { action: "edited"; issueId: string; mode: "description" | "revision-comment" }
  | { action: "git-issue-created"; issueId: string; issueUrl: string };

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

/** PAT-2004: the tag a "Create Pilot work" message carries. */
export const WORK_MARKER = "pilot-work";

/** Crew Git pull request (crates/crew-core/src/kind.rs: KIND_GIT_PULL_REQUEST). */
export const GIT_PULL_REQUEST_KIND = 1618;

/** The repo coordinate an event refers to, from its `a` tag. */
function aTagOf(event: NostrEvent): string | null {
  for (const [tag, value] of event.tags) {
    if (tag === "a" && typeof value === "string" && value.startsWith("30617:")) return value;
  }
  return null;
}

/** First value of a single-value tag. */
function tagValue(event: NostrEvent, name: string): string | null {
  for (const [tag, value] of event.tags) {
    if (tag === name && typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** §36: origin footer for work filed from a Git/PR event. */
export function renderGitOriginFooter(
  repoRef: string,
  event: NostrEvent,
  correlationId: string,
): string {
  const lines = [
    "## Origin",
    "",
    "- Source: Crew (Git)",
    `- Crew repo: \`crew://repo/${repoRef}\``,
    `- Crew event: \`crew://git/${event.kind}/${event.id}\``,
    `- Author pubkey: \`${event.pubkey}\``,
    `- Gateway correlation id: \`${correlationId}\``,
  ];
  const commit = tagValue(event, "c");
  if (commit) lines.push(`- Commit: \`${commit}\``);
  const branch = tagValue(event, "branch-name");
  if (branch) lines.push(`- Branch: \`${branch}\``);
  return lines.join("\n");
}

function hTagOf(event: NostrEvent): string | null {
  for (const [tag, value] of event.tags) {
    if (tag === "h" && typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** The event an edit (kind 40003) targets, from its `e` tag. */
function editedTargetOf(event: NostrEvent): string | null {
  for (const [tag, value] of event.tags) {
    if (tag === "e" && typeof value === "string" && value.length === 64) return value;
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

  /** PAT-2004: a "Create Pilot work" message from the message menu. */
  private hasWorkMarker(event: NostrEvent): boolean {
    return event.tags.some(([tag, value]) => tag === "t" && value === WORK_MARKER);
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

  /**
   * §29 per-sender/per-channel budget. Returns true when the message may be
   * processed. Counted in fixed windows persisted in the store, so a restart
   * cannot reset the budget.
   */
  private withinRateLimit(senderPubkey: string, channelId: string): boolean {
    const { perWindow, windowSeconds } = this.config.rateLimit;
    const windowStart = new Date(
      Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000,
    ).toISOString();
    this.store.pruneRateWindows(
      new Date(Date.now() - 2 * windowSeconds * 1000).toISOString(),
    );
    const key = `${senderPubkey.toLowerCase()}:${channelId}`;
    return this.store.bumpRateWindow(key, windowStart) <= perWindow;
  }

  /**
   * §29 edit race. A Crew edit never silently rewrites an in-flight request:
   * before checkout the description is updated, after checkout the change is
   * appended as a revision comment so the agent sees it.
   */
  private async handleEdit(event: NostrEvent): Promise<HandleResult> {
    const target = editedTargetOf(event);
    if (!target) return { action: "ignored", reason: "missing-e-tag" };

    const linked = this.store.issueForMessage(target);
    if (!linked) return { action: "ignored", reason: "unlinked-message" };

    const issue = await this.pilot.getIssue(linked.issueId);
    // An assigned issue may already be in the agent's hands; an unassigned one
    // has not been picked up yet.
    const checkedOut = Boolean(issue.assigneeAgentId);

    if (!checkedOut) {
      await this.pilot.updateIssueDescription(linked.issueId, event.content);
      this.store.markSeen(event.id);
      this.store.recordAudit({
        action: "issue-edited",
        correlationId: null,
        crewEventId: event.id,
        crewChannelId: hTagOf(event),
        crewThreadRoot: target,
        senderPubkey: event.pubkey,
        issueId: linked.issueId,
        issueUrl: linked.issueUrl,
        agentId: null,
        detail: "description rewritten before checkout",
      });
      return { action: "edited", issueId: linked.issueId, mode: "description" };
    }

    const revision = [
      "**Source request was edited in Crew.**",
      "",
      `> ${event.content}`,
      "",
      `Source: \`crew://message?channel=${hTagOf(event) ?? "unknown"}&id=${event.id}\``,
    ].join("\n");
    await this.pilot.addIssueComment(linked.issueId, revision);
    this.store.markSeen(event.id);
    this.store.recordAudit({
      action: "issue-revision-commented",
      correlationId: null,
      crewEventId: event.id,
      crewChannelId: hTagOf(event),
      crewThreadRoot: target,
      senderPubkey: event.pubkey,
      issueId: linked.issueId,
      issueUrl: linked.issueUrl,
      agentId: null,
      detail: "source edited after checkout",
    });
    return { action: "edited", issueId: linked.issueId, mode: "revision-comment" };
  }

  /**
   * §36/PAT-2008: route a Git pull request (kind 1618) to the employee that
   * owns the repo. Uses the create idempotency key, so a replay cannot file
   * the same PR twice.
   */
  private async handleGitEvent(event: NostrEvent): Promise<HandleResult> {
    const repoRef = aTagOf(event);
    if (!repoRef) return { action: "ignored", reason: "missing-a-tag" };
    const route = this.mapping.repos?.[repoRef];
    if (!route) return { action: "ignored", reason: "unmapped-repo" };
    const agent = this.mapping.agents[route.agent];
    if (!agent) return { action: "ignored", reason: "unmapped-agent" };

    const correlationId = this.uuid();
    const subject = tagValue(event, "subject") ?? "Pull request";
    const labels = event.tags
      .filter(([t, v]) => t === "t" && typeof v === "string")
      .map(([, v]) => v as string);
    const description = [
      event.content,
      labels.length > 0 ? `Labels: ${labels.join(", ")}` : "",
      "",
      renderGitOriginFooter(repoRef, event, correlationId),
    ]
      .filter((part) => part.length > 0)
      .join("\n");

    const created = await this.pilot.createIssue({
      companyId: route.companyId,
      title: subject.slice(0, MAX_TITLE),
      description,
      assigneeAgentId: agent.pilotAgentId,
      ...(route.projectId ? { projectId: route.projectId } : {}),
      // Deterministic: a replayed PR event replays the original issue.
      idempotencyKey: `crew-git:${event.id}`,
    });
    this.store.markSeen(event.id);
    this.store.linkMessage(event.id, created.id, created.url, route.companyId, repoRef);
    this.store.recordAudit({
      action: "git-issue-created",
      correlationId,
      crewEventId: event.id,
      crewChannelId: tagValue(event, "h"),
      crewThreadRoot: repoRef,
      senderPubkey: event.pubkey,
      issueId: created.id,
      issueUrl: created.url,
      agentId: agent.pilotAgentId,
      detail: `repo ${repoRef}`,
    });
    return { action: "git-issue-created", issueId: created.id, issueUrl: created.url };
  }

  async handleEvent(event: NostrEvent): Promise<HandleResult> {
    if (event.kind === GIT_PULL_REQUEST_KIND) {
      if (this.store.seen(event.id)) return { action: "ignored", reason: "duplicate" };
      return this.handleGitEvent(event);
    }

    if (event.kind === 40003) {
      if (this.store.seen(event.id)) return { action: "ignored", reason: "duplicate" };
      return this.handleEdit(event);
    }

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

    if (!this.withinRateLimit(event.pubkey, channelId)) {
      return { action: "ignored", reason: "rate-limited" };
    }

    const threadRoot = threadRootOf(event);

    // PAT-2004: work requested from the message menu names no agent, so the
    // channel decides who owns it. A mention still wins if both are present.
    const mentioned = parseMentionTargets(event);
    let resolved = this.resolveAgent(mentioned);
    if (!resolved && this.hasWorkMarker(event)) {
      const defaultAgent = channel.defaultAgent;
      if (!defaultAgent) {
        return { action: "ignored", reason: "no-default-agent" };
      }
      const entry = this.mapping.agents[defaultAgent];
      if (!entry) return { action: "ignored", reason: "unmapped-agent" };
      resolved = [defaultAgent, entry];
    }
    if (!resolved) return { action: "ignored", reason: "no-agent-mention" };
    const [agentName, agent] = resolved;

    // §13.3 step 8: sender authorization gate.
    if (!this.senderAuthorized(agent, event.pubkey)) {
      // Security-relevant: a bypass attempt is a P1 alert source (§59).
      this.store.recordAudit({
        action: "unauthorized-sender",
        correlationId: null,
        crewEventId: event.id,
        crewChannelId: channelId,
        crewThreadRoot: threadRoot,
        senderPubkey: event.pubkey,
        issueId: null,
        issueUrl: null,
        agentId: agent.pilotAgentId,
        detail: `sender not in allowedSenders for ${agentName}`,
      });
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
      this.store.linkMessage(
        event.id,
        existing.issueId,
        existing.issueUrl,
        existing.companyId,
        threadRoot,
      );
      this.store.markSeen(event.id);
      this.store.recordAudit({
        action: "issue-commented",
        correlationId: null,
        crewEventId: event.id,
        crewChannelId: channelId,
        crewThreadRoot: threadRoot,
        senderPubkey: event.pubkey,
        issueId: existing.issueId,
        issueUrl: existing.issueUrl,
        agentId: agent.pilotAgentId,
        detail: "follow-up in linked thread",
      });
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
      // Land the issue in the channel's project: the mapping carries the
      // boundary, and a task_bridge-scoped key rejects writes outside it.
      ...(channel.projectId ? { projectId: channel.projectId } : {}),
      // The receipt store already dedupes replays; the key makes a retried
      // create replay the original issue instead of filing a second one.
      idempotencyKey: `crew-mention:${event.id}`,
    });
    this.store.linkThread(threadRoot, channelId, created.id, created.url, channel.companyId);
    this.store.linkMessage(event.id, created.id, created.url, channel.companyId, threadRoot);

    // §13.3 step 14: receipt completes only after success.
    this.store.markSeen(event.id);
    this.store.recordAudit({
      action: "issue-created",
      correlationId,
      crewEventId: event.id,
      crewChannelId: channelId,
      crewThreadRoot: threadRoot,
      senderPubkey: event.pubkey,
      issueId: created.id,
      issueUrl: created.url,
      agentId: agent.pilotAgentId,
      detail: `assigned to ${agentName}`,
    });

    // §13.3 step 13: optional gateway acknowledgment with the issue id.
    await this.ackSafely(
      channelId,
      event.id,
      `Filed as a Pilot issue for ${agentName}: ${created.url}`,
    );
    return { action: "issue-created", issueId: created.id, issueUrl: created.url };
  }
}
