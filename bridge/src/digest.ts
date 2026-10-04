import type { BridgeMapping } from "./crew.js";
import type { BridgeStore } from "./store.js";

/**
 * The awareness loop (`doc/CREW_INTEGRATION.md` §100, PAT-1989).
 *
 * schedule -> digest of channel activity since the last run -> the employee
 * wakes and decides: ignore, reply in-thread, escalate, or propose.
 *
 * Initiative governance lives here, not in Pilot: quiet hours and a daily
 * proactive cap per agent. Money stays governed by Pilot budgets.
 */

export type ActivityMessage = {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
};

/** Read channel activity since an instant. Injectable for tests. */
export type ActivityReader = (input: {
  channelId: string;
  since: string | null;
  limit: number;
}) => Promise<ActivityMessage[]>;

/** File the digest where the employee will wake on it. Injectable. */
export type DigestFiler = (input: {
  agentName: string;
  agent: BridgeMapping["agents"][string];
  channelId: string;
  channelName: string;
  digest: string;
  messageCount: number;
  correlationId: string;
}) => Promise<{ issueId?: string; issueUrl?: string }>;

export type DigestOutcome = {
  channelId: string;
  channelName: string;
  agent: string | null;
  outcome: "filed" | "skipped" | "refused";
  reason?: string;
  messageCount?: number;
  issueUrl?: string;
};

export type DigestDeps = {
  mapping: BridgeMapping;
  store: BridgeStore;
  readActivity: ActivityReader;
  file: DigestFiler;
  /** Cap per channel per run. */
  limit?: number;
  now?: () => Date;
  uuid?: () => string;
};

/**
 * Quiet hours may wrap midnight (22:00 -> 07:00). A window whose start equals
 * its end is treated as "always quiet" only if it covers the whole day; here
 * an equal start/end is treated as no quiet window, which is the safer reading
 * for a human editing a config file.
 */
export function withinQuietHours(
  quietHours: { start: string; end: string } | undefined,
  at: Date,
): boolean {
  if (!quietHours) return false;
  const [sh, sm] = quietHours.start.split(":").map(Number);
  const [eh, em] = quietHours.end.split(":").map(Number);
  const nowMinutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  return start < end ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end;
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The digest the employee reads. Says what changed, and nothing it cannot know. */
export function buildDigest(input: {
  channelName: string;
  channelId: string;
  since: string | null;
  messages: ActivityMessage[];
}): string {
  const lines = [
    `# Channel activity: #${input.channelName}`,
    "",
    `- Channel: \`crew://channel/${input.channelId}\``,
    `- Window: since ${input.since ?? "the beginning"}`,
    `- Messages: ${input.messages.length}`,
    "",
    "## Activity",
    "",
  ];
  for (const message of input.messages) {
    const when = new Date(message.created_at * 1000).toISOString();
    const who = message.pubkey.slice(0, 8);
    const body = message.content.trim().replace(/\n+/g, " ").slice(0, 500);
    lines.push(`- \`${when}\` **${who}**: ${body}`);
  }
  lines.push(
    "",
    "## What to do",
    "",
    "Exercise judgment, exactly like a colleague keeping half an ear on the room:",
    "",
    "- ignore it — nothing here needs you;",
    "- reply in-thread as yourself if a question is yours to answer;",
    "- escalate if it needs attention now;",
    "- propose if it is work worth doing.",
  );
  return lines.join("\n");
}

/**
 * One awareness pass over every mapped channel.
 *
 * A channel whose agent is inside quiet hours or has spent its daily proactive
 * budget is refused, not silently dropped — the caller can see why nothing
 * woke.
 */
export async function runAwarenessDigest(deps: DigestDeps): Promise<DigestOutcome[]> {
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => globalThis.crypto.randomUUID());
  const limit = deps.limit ?? 100;
  const at = now();
  const outcomes: DigestOutcome[] = [];

  // One agent may own several channels; the daily cap is per agent, so count
  // the whole pass before spending it.
  const spentToday = new Map<string, number>();

  for (const [channelId, channel] of Object.entries(deps.mapping.channels)) {
    const entry = (outcome: Omit<DigestOutcome, "channelId" | "channelName">): DigestOutcome => ({
      channelId,
      channelName: channel.name,
      ...outcome,
    });

    const agentEntry = Object.entries(deps.mapping.agents).find(
      ([, agent]) => agent.pilotAgentId !== undefined,
    );
    const agentName = agentEntry?.[0] ?? null;
    const agent = agentEntry?.[1];

    if (!agent || !agentName) {
      outcomes.push(entry({ agent: null, outcome: "skipped", reason: "no-agent-mapped" }));
      continue;
    }

    if (withinQuietHours(agent.quietHours, at)) {
      outcomes.push(entry({ agent: agentName, outcome: "refused", reason: "quiet-hours" }));
      continue;
    }

    const cap = agent.maxProactivePerDay;
    if (cap !== undefined) {
      const already =
        spentToday.get(agentName) ?? deps.store.proactiveToday(agentName, utcDay(at));
      if (already >= cap) {
        outcomes.push(entry({ agent: agentName, outcome: "refused", reason: "proactive-cap" }));
        continue;
      }
    }

    const since = deps.store.digestCursor(channelId);
    const messages = await deps.readActivity({ channelId, since, limit });
    if (messages.length === 0) {
      outcomes.push(entry({ agent: agentName, outcome: "skipped", reason: "no-activity" }));
      continue;
    }

    const digest = buildDigest({
      channelName: channel.name,
      channelId,
      since,
      messages,
    });
    const filed = await deps.file({
      agentName,
      agent,
      channelId,
      channelName: channel.name,
      digest,
      messageCount: messages.length,
      correlationId: uuid(),
    });

    // Cursor advances only after a successful filing, so a failure replays.
    const newest = messages.reduce((max, m) => Math.max(max, m.created_at), 0);
    deps.store.setDigestCursor(channelId, new Date(newest * 1000).toISOString());

    if (cap !== undefined) {
      const used = deps.store.bumpProactive(agentName, utcDay(at));
      spentToday.set(agentName, used);
    }

    outcomes.push(
      entry({
        agent: agentName,
        outcome: "filed",
        messageCount: messages.length,
        ...(filed.issueUrl ? { issueUrl: filed.issueUrl } : {}),
      }),
    );
  }

  return outcomes;
}
