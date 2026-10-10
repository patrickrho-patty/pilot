import { connectionNeedsReauthorization } from "./connection-readiness.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  companySecrets,
  connectionAgentAccess,
  connectionAvailability,
  connectionGrants,
  connectionProviderRegistrations,
  connectionWorkspaceBindings,
  toolConnections,
  type Db,
} from "@pilotai/db";
import type {
  ConnectionExecutionContext,
  ConnectionWorkspaceBinding,
} from "@pilotai/shared";
import { forbidden } from "../errors.js";
import { secretService } from "./secrets.js";
import { toolAccessService } from "./tool-access.js";
import {
  connectionRegistry,
  verifyConnectionKbIdentity,
} from "./connection-registry.js";

/** Exact canonical snapshot; no token values are part of the authority identity. */
export interface ConnectionCredentialContext {
  registrationSecretVersion: number | null;
  b: ConnectionWorkspaceBinding;
  c: ConnectionExecutionContext;
  r: {
    connection: typeof toolConnections.$inferSelect;
    consent: typeof connectionGrants.$inferSelect;
    grant: typeof connectionAgentAccess.$inferSelect;
    availability: typeof connectionAvailability.$inferSelect;
    registration: typeof connectionProviderRegistrations.$inferSelect;
  };
  app: (typeof connectionRegistry)[number];
}
const denied = () =>
  forbidden("Connection requires reconnection or current authorization");
const oauth = (connection: typeof toolConnections.$inferSelect) =>
  (connection.config.oauth ?? {}) as Record<string, unknown>;
const fingerprint = (value: unknown) => JSON.stringify(value);

async function userValue(db: Db, s: ConnectionCredentialContext, path: string) {
  const ref = s.r.consent.credentialSecretRefs.find(
    (r) => r.configPath === path,
  );
  if (!ref) throw denied();
  const [secret] = await db
    .select()
    .from(companySecrets)
    .where(
      and(
        eq(companySecrets.id, ref.secretId),
        eq(companySecrets.companyId, s.b.companyId),
        eq(companySecrets.scope, "user"),
        eq(companySecrets.ownerUserId, s.c.requesterAccountId),
      ),
    );
  if (!secret?.userSecretDefinitionId) throw denied();
  // Deliberate owner-scoped internal resolution, with no fabricated native consumer.
  const value = await secretService(db).resolveUserSecretValue(s.b.companyId, {
    definitionId: secret.userSecretDefinitionId,
    responsibleUserId: s.c.requesterAccountId,
    version: ref.versionSelector,
  });
  if (!value?.value) throw denied();
  return value.value;
}

async function locked(
  db: Pick<Db, "execute" | "select">,
  s: ConnectionCredentialContext,
) {
  await db.execute(sql`SET LOCAL lock_timeout = '5s'`);
  await db.execute(sql`SET LOCAL statement_timeout = '10s'`);
  const [b] = await db
    .select()
    .from(connectionWorkspaceBindings)
    .where(eq(connectionWorkspaceBindings.id, s.b.id))
    .for("update");
  const [registration] = await db
    .select()
    .from(connectionProviderRegistrations)
    .where(eq(connectionProviderRegistrations.id, s.r.registration.id))
    .for("share");
  if (registration?.clientSecretId) {
    const [secret] = await db
      .select()
      .from(companySecrets)
      .where(eq(companySecrets.id, registration.clientSecretId))
      .for("share");
    if (
      !secret ||
      secret.status !== "active" ||
      secret.latestVersion !== s.registrationSecretVersion
    )
      throw denied();
  }
  const [availability] = await db
    .select()
    .from(connectionAvailability)
    .where(eq(connectionAvailability.id, s.r.availability.id))
    .for("share");
  const [grant] = await db
    .select()
    .from(connectionAgentAccess)
    .where(eq(connectionAgentAccess.id, s.r.grant.id))
    .for("share");
  const [consent] = await db
    .select()
    .from(connectionGrants)
    .where(eq(connectionGrants.id, s.r.consent.id))
    .for("update");
  const [connection] = await db
    .select()
    .from(toolConnections)
    .where(eq(toolConnections.id, s.r.connection.id))
    .for("update");
  if (
    !b?.enabled ||
    fingerprint(b) !== fingerprint(s.b) ||
    fingerprint(registration) !== fingerprint(s.r.registration) ||
    fingerprint(availability) !== fingerprint(s.r.availability) ||
    fingerprint(grant) !== fingerprint(s.r.grant) ||
    !consent ||
    consent.status !== "active" ||
    consent.consentGeneration !== s.r.consent.consentGeneration ||
    consent.subjectUserId !== s.c.requesterAccountId ||
    consent.kind !== "user" ||
    !connection?.enabled ||
    connection.externalBindingId !== b.id ||
    s.c.expiresAt <= Math.floor(Date.now() / 1000)
  )
    throw denied();
  return { connection, consent };
}

/** Durable singleflight renewal in the canonical connection; HTTP never holds SQL locks. */
export async function connectionAccessToken(
  db: Db,
  initial: ConnectionCredentialContext,
  provider: typeof fetch,
  revalidate: () => Promise<ConnectionCredentialContext>,
): Promise<string> {
  let current = initial;
  const deadline = Date.now() + 10000;
  for (;;) {
    const claimed = await db.transaction(async (tx) => {
      const live = await locked(tx, current);
      const config = oauth(live.connection);
      if (connectionNeedsReauthorization(live.connection, live.consent))
        throw denied();
      const expiry =
        typeof config.expiresAt === "string"
          ? Date.parse(config.expiresAt)
          : NaN;
      if (expiry > Date.now() + 30000)
        return { kind: "ready" as const, ...live };
      const lease = config.externalRefresh as
        | {
            id?: string;
            expiresAt?: number;
            consentId?: string;
            generation?: number;
          }
        | undefined;
      if (
        lease?.id &&
        lease.consentId === live.consent.id &&
        lease.generation === live.consent.consentGeneration
      ) {
        // An abandoned rotating refresh has an unknown outcome: never replay it.
        if ((lease.expiresAt ?? 0) <= Date.now()) throw denied();
        return { kind: "waiting" as const, ...live };
      }
      const id = randomUUID();
      const next = {
        ...live.connection.config,
        oauth: {
          ...config,
          externalRefresh: {
            id,
            expiresAt: Date.now() + 15000,
            consentId: live.consent.id,
            generation: live.consent.consentGeneration,
          },
        },
      };
      await tx
        .update(toolConnections)
        .set({ config: next })
        .where(eq(toolConnections.id, live.connection.id));
      return { kind: "refresh" as const, id, ...live };
    });
    current = {
      ...current,
      r: {
        ...current.r,
        connection: claimed.connection,
        consent: claimed.consent,
      },
    };
    if (claimed.kind === "ready")
      return userValue(db, current, "oauth.access_token");
    if (claimed.kind === "waiting") {
      if (Date.now() >= deadline) throw denied();
      await new Promise((resolve) => setTimeout(resolve, 25));
      current = await revalidate();
      continue;
    }
    try {
      const refreshToken = await userValue(db, current, "oauth.refresh_token");
      let clientSecret: string | undefined;
      if (current.r.registration.clientSecretId) {
        const [definition] = await db
          .select()
          .from(companySecrets)
          .where(
            and(
              eq(companySecrets.id, current.r.registration.clientSecretId),
              eq(companySecrets.companyId, current.b.companyId),
              eq(companySecrets.scope, "company"),
              eq(companySecrets.provider, "local_encrypted"),
            ),
          );
        if (!definition) throw denied();
        clientSecret = await secretService(db).resolveSecretValue(
          current.b.companyId,
          definition.id,
          "latest",
        );
      }
      const canonical = toolAccessService(db, {
        externalWorkspaceBindingId: current.b.id,
        externalFetch: provider,
      }).externalOAuthInternals;
      if (!canonical) throw denied();
      const token = await canonical.exchange({
        tokenUrl: current.app.tokenUrl,
        clientId: current.r.registration.clientId,
        clientSecret,
        grantType: "refresh_token",
        refreshToken,
      });
      if (
        token.tokenType.toLowerCase() !== "bearer" ||
        !token.expiresIn ||
        token.expiresIn <= 0 ||
        token.expiresIn > 86400 ||
        (token.scope !== null &&
          fingerprint(token.scope.split(" ").filter(Boolean).sort()) !==
            fingerprint([...(oauth(current.r.connection).scopes as string[])].sort()))
      )
        throw denied();
      if (current.app.appId === "patty-kb") {
        const identity = await verifyConnectionKbIdentity(
          token.accessToken,
          current.r.registration,
          provider,
        );
        if (
          identity.issuer !== current.r.consent.providerTenant?.name ||
          identity.subject !== current.r.consent.providerTenant?.externalId
        )
          throw denied();
      }
      const renewed = await revalidate();
      if (
        renewed.r.consent.id !== current.r.consent.id ||
        renewed.r.consent.consentGeneration !==
          current.r.consent.consentGeneration ||
        fingerprint(renewed.r.registration) !==
          fingerprint(current.r.registration) ||
        renewed.registrationSecretVersion !== current.registrationSecretVersion
      )
        throw denied();
      await db.transaction(async (tx) => {
        const live = await locked(tx, renewed);
        const config = oauth(live.connection);
        if (
          (config.externalRefresh as { id?: string } | undefined)?.id !==
          claimed.id
        )
          throw denied();
        const actor = {
          actorType: "user" as const,
          actorId: current.c.requesterAccountId,
        };
        const access = await canonical.store({
          companyId: current.b.companyId,
          connection: live.connection,
          configPath: "oauth.access_token",
          label: "OAuth access token",
          value: token.accessToken,
          actor,
          existingRefs: live.consent.credentialSecretRefs,
          subjectUserId: current.c.requesterAccountId,
          vaultDb: tx as unknown as Db,
        });
        let refs = live.consent.credentialSecretRefs.filter(
          (r) => r.configPath !== "oauth.access_token",
        );
        refs.push(access);
        if (token.refreshToken) {
          const refresh = await canonical.store({
            companyId: current.b.companyId,
            connection: live.connection,
            configPath: "oauth.refresh_token",
            label: "OAuth refresh token",
            value: token.refreshToken,
            actor,
            existingRefs: refs,
            subjectUserId: current.c.requesterAccountId,
            vaultDb: tx as unknown as Db,
          });
          refs = refs.filter((r) => r.configPath !== "oauth.refresh_token");
          refs.push(refresh);
        }
        await tx
          .update(connectionGrants)
          .set({ credentialSecretRefs: refs, updatedAt: new Date() })
          .where(eq(connectionGrants.id, live.consent.id));
        const { externalRefresh: _lease, ...rest } = config;
        await tx
          .update(toolConnections)
          .set({
            config: {
              ...live.connection.config,
              oauth: {
                ...rest,
                expiresAt: new Date(
                  Date.now() + token.expiresIn! * 1000,
                ).toISOString(),
              },
            },
            updatedAt: new Date(),
          })
          .where(eq(toolConnections.id, live.connection.id));
      });
      await revalidate();
      return token.accessToken;
    } catch {
      // Preserve the claim, and make terminal failure visible immediately. A late
      // failure may annotate only this exact claim and consent generation.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
        await tx
          .select()
          .from(connectionWorkspaceBindings)
          .where(eq(connectionWorkspaceBindings.id, current.b.id))
          .for("update");
        const [consent] = await tx
          .select()
          .from(connectionGrants)
          .where(eq(connectionGrants.id, current.r.consent.id))
          .for("update");
        const [connection] = await tx
          .select()
          .from(toolConnections)
          .where(eq(toolConnections.id, current.r.connection.id))
          .for("update");
        if (
          !connection ||
          !consent ||
          consent.status !== "active" ||
          consent.consentGeneration !== current.r.consent.consentGeneration
        )
          return;
        const config = oauth(connection);
        const lease = config.externalRefresh as
          | Record<string, unknown>
          | undefined;
        if (
          lease?.id !== claimed.id ||
          lease.consentId !== consent.id ||
          lease.generation !== consent.consentGeneration
        )
          return;
        await tx
          .update(toolConnections)
          .set({
            config: {
              ...connection.config,
              oauth: {
                ...config,
                externalRefresh: { ...lease, outcome: "reconnect-required" },
              },
            },
          })
          .where(eq(toolConnections.id, connection.id));
      });
      throw denied();
    }
  }
}
