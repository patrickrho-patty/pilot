import type { BridgeMapping } from "./crew.js";
import type { PilotClient } from "./pilot.js";
import type { BridgeStore } from "./store.js";

/**
 * A decision a human made in Crew, to be projected onto a Pilot approval
 * (PAT-1987, `doc/CREW_INTEGRATION.md` §18.4).
 *
 * The bridge is a courier, never an authority: it applies a decision only when
 * a mapped human signed it, the approval is still open, and the decision id
 * has never been seen. It cannot approve anything on its own initiative.
 */
export type CrewDecision = {
  /** Crew event id. Single-use anti-replay key (§18.4 item 3). */
  decisionId: string;
  approvalId: string;
  decision: "approve" | "reject" | "request-revision";
  /** Required for `reject` and `request-revision` (§18.4 item 7). */
  reason?: string;
  /** Crew pubkey of the deciding human. */
  decidedByPubkey: string;
  /** When the human decided, ISO-8601. */
  decidedAt: string;
};

export type ProjectionOutcome =
  | { applied: true; approvalId: string; decidedByUserId: string }
  | { applied: false; reason: string };

/** A decision older than this is refused: the world may have moved on. */
export const DEFAULT_MAX_DECISION_AGE_SECONDS = 900;

export type ProjectionDeps = {
  maxDecisionAgeSeconds?: number;
  now?: () => number;
};

/**
 * §18.4 checklist, in order. Every refusal is named so the operator can tell
 * a forged decision from a stale one.
 */
export async function projectApprovalDecision(
  pilot: PilotClient,
  mapping: BridgeMapping,
  store: BridgeStore,
  decision: CrewDecision,
  deps: ProjectionDeps = {},
): Promise<ProjectionOutcome> {
  const now = deps.now ?? Date.now;
  const maxAgeMs =
    (deps.maxDecisionAgeSeconds ?? DEFAULT_MAX_DECISION_AGE_SECONDS) * 1000;

  // (1) Human Crew pubkey -> Pilot board user. Never inferred.
  const user = mapping.users?.[decision.decidedByPubkey.toLowerCase()];
  if (!user) {
    return { applied: false, reason: "unmapped-decider" };
  }

  // (2) Role evidence. Pilot re-checks authoritatively; a viewer can never be
  // projected into an approval decision.
  if (user.role === "viewer") {
    return { applied: false, reason: "decider-lacks-role" };
  }

  // (7) A rejection without a reason is not actionable for the agent.
  if (
    (decision.decision === "reject" || decision.decision === "request-revision") &&
    (!decision.reason || decision.reason.trim().length === 0)
  ) {
    return { applied: false, reason: "missing-reason" };
  }

  // Stale decision: refuse rather than apply an old intent.
  const decidedAtMs = Date.parse(decision.decidedAt);
  if (!Number.isFinite(decidedAtMs)) {
    return { applied: false, reason: "invalid-decided-at" };
  }
  if (now() - decidedAtMs > maxAgeMs) {
    return { applied: false, reason: "stale-decision" };
  }

  // (5) Stale card: the approval must still be open.
  const approval = await pilot.getApproval(decision.approvalId);
  if (approval.status && approval.status !== "pending") {
    return { applied: false, reason: `approval-${approval.status}` };
  }

  // (3) Anti-replay: claim the decision id exactly once, before applying.
  const claimed = store.claimDecision({
    decisionId: decision.decisionId,
    approvalId: decision.approvalId,
    decidedByPubkey: decision.decidedByPubkey,
    decidedByUserId: user.userId,
    decision: decision.decision,
  });
  if (!claimed) {
    return { applied: false, reason: "replayed-decision" };
  }

  // Apply. Pilot enforces the authoritative role/board check at the API.
  await pilot.decideApproval(decision.approvalId, decision.decision, decision.reason);

  // (4) Decision signing/audit: the human is recorded as the decider.
  store.recordAudit({
    action: `approval-${decision.decision}`,
    correlationId: null,
    crewEventId: decision.decisionId,
    crewChannelId: null,
    crewThreadRoot: null,
    senderPubkey: decision.decidedByPubkey,
    issueId: null,
    issueUrl: null,
    agentId: approval.requestedByAgentId ?? null,
    detail: `approval ${decision.approvalId} decided by Pilot user ${user.userId}${
      decision.reason ? `: ${decision.reason}` : ""
    }`,
  });

  return { applied: true, approvalId: decision.approvalId, decidedByUserId: user.userId };
}
