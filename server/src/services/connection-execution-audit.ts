import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { toolAccessAuditEvents, type Db } from "@pilotai/db";
import type {
  ConnectionExecutionContext,
  ConnectionWorkspaceBinding,
} from "@pilotai/shared";
import { HttpError } from "../errors.js";

/** Safe provider classification; never contains provider bodies, URLs or errors. */
export class ConnectionProviderFailure extends HttpError {
  constructor(readonly outcome: "provider_error" | "uncertain", status: 403 | 409 = 403) {
    super(status, "Connection execution denied");
  }
}
/** Persist before work; interrupted attempts remain uncertain, never guessed successful. */
export async function auditConnectionExecution<T>(
  db: Db,
  identity: { b: ConnectionWorkspaceBinding; c: ConnectionExecutionContext },
  action: string,
  operation: "prepare" | "execute",
  work: (
    phase: (value: "credentials" | "provider" | "result") => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const { b, c } = identity;
  const id = randomUUID();
  const details = {
    source: "crew_connections",
    operation,
    bindingId: b.id,
    workspaceId: c.workspaceId,
    communityId: c.communityId,
    requesterAccountId: c.requesterAccountId,
    requesterPubkey: c.requesterPubkey,
    agentPubkey: c.agentPubkey,
    enrollmentId: c.enrollmentId,
    generation: c.generation,
    channelId: c.channelId,
    conversationId: c.conversationId,
    turnId: c.turnId,
  };
  let phase = "authorization";
  await db.insert(toolAccessAuditEvents).values({
    id,
    companyId: b.companyId,
    correlationId: id,
    actorType: "user",
    actorId: c.requesterAccountId,
    action,
    outcome: "uncertain",
    reasonCode: "attempt_interrupted",
    details: { ...details, phase },
  });
  const update = async (outcome: string, reasonCode: string) => {
    await db
      .update(toolAccessAuditEvents)
      .set({ outcome, reasonCode, details: { ...details, phase } })
      .where(
        and(
          eq(toolAccessAuditEvents.id, id),
          eq(toolAccessAuditEvents.companyId, b.companyId),
        ),
      );
  };
  try {
    const result = await work(async (next) => {
      phase = next;
      await update("uncertain", "attempt_interrupted");
    });
    await update(operation === "prepare" ? "eligible" : "success", "completed");
    return result;
  } catch (error) {
    // Provider failures use only a closed safe classification. Other errors never
    // reflect their message; failure during result audit is itself uncertain.
    const outcome =
      error instanceof ConnectionProviderFailure
        ? error.outcome
        : error instanceof HttpError && error.status < 500
          ? "denied"
          : error instanceof ZodError
            ? phase === "authorization"
              ? "denied"
              : "provider_error"
            : "uncertain";
    await update(
      outcome,
      outcome === "denied"
        ? "authorization_or_credentials_denied"
        : "provider_or_completion_unavailable",
    );
    throw error;
  }
}
