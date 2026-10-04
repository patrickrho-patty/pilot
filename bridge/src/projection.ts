import type { BridgeMapping } from "./crew.js";
import type { PilotClient } from "./pilot.js";
import type { BridgeStore } from "./store.js";

/**
 * Delegation and review visibility (PAT-2002, `doc/CREW_INTEGRATION.md` §17.2,
 * §19).
 *
 * A Pilot work tree is invisible to the people watching a Crew thread. This
 * projects it: when a linked issue's state changes — status, owner, or the
 * child work under it — the bridge posts one status message into the thread
 * that raised it.
 *
 * Design constraints:
 * - One message per change, not per poll. The snapshot is stored, so a
 *   projection loop that runs every minute is silent when nothing moved.
 * - The message is a projection, not an authority. It never claims an
 *   approval happened; it says what the board says.
 */

export type IssueChild = {
  id: string;
  status?: string;
  assigneeAgentId?: string | null;
};

export type IssueSnapshot = {
  status: string;
  assigneeAgentId: string | null;
  children: IssueChild[];
  /** Pending approval ids (PAT-1999). A new one is worth telling the thread. */
  pendingApprovalIds: string[];
};

/** A single-value projection: what changed, and the text to post. */
export type ProjectionChange = {
  threadRoot: string;
  channelId: string;
  issueId: string;
  issueUrl: string;
  text: string;
  snapshot: IssueSnapshot;
};

export type ProjectionDeps = {
  mapping: BridgeMapping;
  store: BridgeStore;
  pilot: PilotClient;
  /** Post the projection into the Crew thread. */
  post: (channelId: string, threadRoot: string, text: string) => Promise<void>;
  /** Resolve an agent id to the display name the thread knows. */
  agentName?: (agentId: string | null) => string | null;
  limit?: number;
};

export function issueSnapshot(issue: {
  status?: string;
  assigneeAgentId?: string | null;
  children?: IssueChild[];
  pendingApprovalIds?: string[];
}): IssueSnapshot {
  return {
    status: issue.status ?? "unknown",
    assigneeAgentId: issue.assigneeAgentId ?? null,
    children: (issue.children ?? []).map((child) => ({
      id: child.id,
      ...(child.status ? { status: child.status } : {}),
      assigneeAgentId: child.assigneeAgentId ?? null,
    })),
    pendingApprovalIds: [...(issue.pendingApprovalIds ?? [])].sort(),
  };
}

export function sameSnapshot(a: IssueSnapshot | null, b: IssueSnapshot): boolean {
  if (!a) return false;
  if (a.status !== b.status) return false;
  if (a.assigneeAgentId !== b.assigneeAgentId) return false;
  if ((a.pendingApprovalIds ?? []).join(",") !== (b.pendingApprovalIds ?? []).join(",")) {
    return false;
  }
  if (a.children.length !== b.children.length) return false;
  return a.children.every((child, index) => {
    const other = b.children[index];
    return (
      child.id === other.id &&
      child.status === other.status &&
      child.assigneeAgentId === other.assigneeAgentId
    );
  });
}

/**
 * The projection text. Says who owns the work now, what the board says, and
 * what is happening underneath — never that a review passed.
 */
export function renderProjection(
  snapshot: IssueSnapshot,
  issueUrl: string,
  nameOf: (agentId: string | null) => string | null,
): string {
  const owner = nameOf(snapshot.assigneeAgentId);
  const lines = [
    `Pilot update: **${snapshot.status}**${owner ? ` — assigned to ${owner}` : ""}.`,
  ];

  if (snapshot.children.length > 0) {
    const done = snapshot.children.filter((c) =>
      /^(done|closed|deployed)$/i.test(c.status ?? ""),
    ).length;
    lines.push("", `Child work: ${done}/${snapshot.children.length} complete.`);
    for (const child of snapshot.children.slice(0, 10)) {
      const childOwner = nameOf(child.assigneeAgentId ?? null);
      lines.push(
        `- \`${child.id.slice(0, 8)}\` ${child.status ?? "unknown"}${childOwner ? ` — ${childOwner}` : ""}`,
      );
    }
    if (snapshot.children.length > 10) {
      lines.push(`- … ${snapshot.children.length - 10} more`);
    }
  }

  // PAT-1999: a pending decision is the one thing in the tree that needs a
  // human, so it is named rather than left to be discovered on the board.
  if ((snapshot.pendingApprovalIds ?? []).length > 0) {
    lines.push(
      "",
      `Waiting on a decision: ${snapshot.pendingApprovalIds.length} pending approval(s).`,
    );
  }

  lines.push("", `Board: ${issueUrl}`);
  return lines.join("\n");
}

/**
 * One projection pass over every linked thread.
 *
 * Returns the changes it posted. A thread whose snapshot is unchanged is
 * skipped, so running this on a schedule is quiet until something moves.
 */
export async function runProjection(deps: ProjectionDeps): Promise<ProjectionChange[]> {
  const nameOf =
    deps.agentName ?? ((agentId: string | null) => (agentId ? agentId.slice(0, 8) : null));
  const changes: ProjectionChange[] = [];

  for (const link of deps.store.linkedThreads(deps.limit ?? 200)) {
    const issue = await deps.pilot.getIssue(link.issueId);
    // Read approvals too: a pending decision is part of the work tree's state.
    const approvals = deps.pilot.listIssueApprovals
      ? await deps.pilot.listIssueApprovals(link.issueId)
      : [];
    const snapshot = issueSnapshot({
      ...issue,
      pendingApprovalIds: approvals
        .filter((a) => !a.status || a.status === "pending")
        .map((a) => a.id)
        .filter((id) => id.length > 0),
    });
    const previous = deps.store.projectionSnapshot(link.threadRoot);
    if (sameSnapshot(previous, snapshot)) continue;

    const text = renderProjection(snapshot, link.issueUrl, nameOf);
    await deps.post(link.channelId, link.threadRoot, text);
    deps.store.saveProjection(link.threadRoot, link.issueId, snapshot);
    changes.push({
      threadRoot: link.threadRoot,
      channelId: link.channelId,
      issueId: link.issueId,
      issueUrl: link.issueUrl,
      text,
      snapshot,
    });
  }

  return changes;
}
