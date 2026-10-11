import { and, eq, inArray, sql } from "drizzle-orm";
import {
  connectionAgentAccess,
  connectionGrants,
  connectionResources,
  connectionWorkspaceBindings,
  toolConnections,
  toolOauthStates,
  type Db,
} from "@pilotai/db";
import { forbidden } from "../errors.js";
import { GMAIL_ACCOUNT_ISSUER } from "./connection-gmail-identity.js";
import { persistActivity } from "./activity-log.js";

/** Consolidate unused, verified duplicates in the consent-publication transaction.
 * Existing effective grants stay on their original consent; permissions are never combined.
 */
export async function consolidateConnectionGmailAccount(
  tx: Db,
  bindingId: string,
  owner: string,
  connectionId: string,
  identity: { issuer: string; subject: string },
) {
  if (identity.issuer !== GMAIL_ACCOUNT_ISSUER) return;
  const [binding] = await tx
    .select()
    .from(connectionWorkspaceBindings)
    .where(eq(connectionWorkspaceBindings.id, bindingId))
    .for("update");
  if (!binding?.enabled) throw forbidden("Connection binding unavailable");
  const rows = await tx
    .select({ resource: connectionResources, consent: connectionGrants })
    .from(connectionResources)
    .innerJoin(
      connectionGrants,
      eq(connectionGrants.id, connectionResources.consentId),
    )
    .where(
      and(
        eq(connectionResources.bindingId, bindingId),
        eq(connectionResources.ownerAccountId, owner),
        eq(connectionResources.appId, "gmail"),
        eq(connectionGrants.companyId, binding.companyId),
        eq(connectionGrants.subjectUserId, owner),
        eq(connectionGrants.kind, "user"),
        eq(connectionGrants.status, "active"),
        sql`${connectionGrants.providerTenant}->>'name' = ${identity.issuer}`,
        sql`${connectionGrants.providerTenant}->>'externalId' = ${identity.subject}`,
      ),
    );
  if (!rows.some((row) => row.resource.connectionId === connectionId))
    throw forbidden("Connection consent changed");
  const ids = rows.map((row) => row.resource.connectionId);
  const grants = await tx
    .select()
    .from(connectionAgentAccess)
    .where(
      and(
        eq(connectionAgentAccess.bindingId, bindingId),
        inArray(connectionAgentAccess.connectionId, ids),
        eq(connectionAgentAccess.revoked, false),
      ),
    );
  const protectedIds = new Set(
    rows
      .filter((row) =>
        grants.some(
          (grant) =>
            grant.connectionId === row.resource.connectionId &&
            grant.consentId === row.consent.id &&
            grant.consentGeneration === row.consent.consentGeneration,
        ),
      )
      .map((row) => row.resource.connectionId),
  );
  const keep = protectedIds.size ? protectedIds : new Set([connectionId]);
  const retired = rows.filter((row) => !keep.has(row.resource.connectionId));
  // v1 display labels are bounded to 128 bytes; the full verified identity stays private in the consent.
  const label =
    identity.subject.length <= 128
      ? identity.subject
      : `${identity.subject.slice(0, 125)}...`;
  await tx
    .update(toolConnections)
    .set({ name: label, updatedAt: new Date() })
    .where(
      and(
        eq(toolConnections.companyId, binding.companyId),
        inArray(toolConnections.id, ids),
      ),
    );
  for (const row of retired) {
    await tx
      .update(connectionGrants)
      .set({
        status: "revoked",
        credentialSecretRefs: [],
        consentGeneration: row.consent.consentGeneration + 1,
        revokedAt: new Date(),
        revokedByUserId: owner,
        updatedAt: new Date(),
      })
      .where(eq(connectionGrants.id, row.consent.id));
    await tx
      .update(connectionAgentAccess)
      .set({ revoked: true })
      .where(
        and(
          eq(connectionAgentAccess.bindingId, bindingId),
          eq(connectionAgentAccess.connectionId, row.resource.connectionId),
        ),
      );
    await tx
      .delete(toolOauthStates)
      .where(
        and(
          eq(toolOauthStates.externalBindingId, bindingId),
          eq(toolOauthStates.connectionId, row.resource.connectionId),
        ),
      );
    await tx
      .update(toolConnections)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(toolConnections.id, row.resource.connectionId));
  }
  if (retired.length)
    await persistActivity(tx, {
      companyId: binding.companyId,
      actorType: "user",
      actorId: owner,
      action: "connection.duplicates_consolidated",
      entityType: "tool_connection",
      entityId: connectionId,
      details: {
        retiredConnectionIds: retired.map((row) => row.resource.connectionId),
      },
    });
}
