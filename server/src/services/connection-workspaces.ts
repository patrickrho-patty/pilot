import {
  connectionNeedsReauthorization,
  connectionCredentialsUsable,
} from "./connection-readiness.js";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import {
  companySecrets,
  connectionAgentAccess,
  connectionApprovalRequests,
  connectionAvailability,
  connectionGrants,
  connectionOperations,
  connectionProviderRegistrations,
  connectionResources,
  connectionWorkspaceBindings,
  toolApplications,
  toolConnections,
  toolOauthStates,
  type Db,
} from "@pilotai/db";
import {
  connectionControlSchema,
  connectionManageEnvelopeSchema,
  connectionCompleteEnvelopeSchema,
  connectionOAuthCallbackSchema,
  type ConnectionControl,
  type ConnectionResult,
  type ConnectionOutcome,
  type ConnectionManagementContext,
  type ConnectionWorkspaceBinding,
} from "@pilotai/shared";
import { badRequest, conflict, forbidden } from "../errors.js";
import { connectionAuthorityService } from "./connection-authority.js";
import { connectionDirectFetch } from "./connection-direct-tls.js";
import {
  registeredConnectionConfiguration,
  connectionRegistry,
  connectionRegistrationReady,
  verifyConnectionKbIdentity,
  connectionScopes,
} from "./connection-registry.js";
import {
  buildToolOAuthAuthorizationUrl,
  toolAccessService,
} from "./tool-access.js";

const result = (
  outcome: ConnectionOutcome,
  extra: Partial<ConnectionResult> = {},
): ConnectionResult => ({
  schema: "crew.connections-result/v1",
  outcome,
  retryable: outcome === "unavailable",
  ...extra,
});
/** Reject duplicate object keys as well as unknown typed fields, preserving original digest bytes. */
function parseExact(body: string): unknown {
  if (Buffer.byteLength(body) > 16384)
    throw badRequest("Connection body too large");
  try {
    const parsed: unknown = JSON.parse(body);
    const stack: Array<Set<string> | null> = [];
    const tokens =
      body.match(
        /"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      ) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === "{") stack.push(new Set());
      else if (t === "[") stack.push(null);
      else if (t === "}" || t === "]") stack.pop();
      else if (t.startsWith('"') && tokens[i + 1] === ":") {
        const keys = stack.at(-1);
        const k = JSON.parse(t) as string;
        if (keys?.has(k)) throw new Error();
        keys?.add(k);
      }
    }
    return parsed;
  } catch {
    throw badRequest("Invalid connection body");
  }
}
export interface ConnectionWorkspaceOptions {
  authorityFetch?: typeof fetch;
  providerFetch?: typeof fetch;
}
/** Private bridge actions. All identity comes from fresh issuer introspection and stored resources. */
export function connectionWorkspaceService(
  db: Db,
  options: ConnectionWorkspaceOptions = {},
) {
  const authority = connectionAuthorityService(db, {
    fetch: options.authorityFetch,
  });
  const providerFetch = options.providerFetch ?? connectionDirectFetch;
  const admin = (c: ConnectionManagementContext) =>
    c.role === "owner" || c.role === "admin";
  async function registered(
    tx: Db,
    b: ConnectionWorkspaceBinding,
    appId: string,
  ) {
    const app = connectionRegistry.find((a) => a.appId === appId);
    const [registration] = await tx
      .select()
      .from(connectionProviderRegistrations)
      .where(
        and(
          eq(connectionProviderRegistrations.bindingId, b.id),
          eq(connectionProviderRegistrations.appId, appId),
        ),
      );
    let ready = !!app && connectionRegistrationReady(b, registration);
    if (registration?.clientSecretId) {
      const [secret] = await tx
        .select()
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.id, registration.clientSecretId),
            eq(companySecrets.companyId, b.companyId),
            eq(companySecrets.scope, "company"),
            eq(companySecrets.status, "active"),
            eq(companySecrets.provider, "local_encrypted"),
          ),
        );
      ready = ready && !!secret;
    }
    return { app, registration, ready };
  }
  async function policy(tx: Db, bindingId: string, appId: string) {
    const [p] = await tx
      .select()
      .from(connectionAvailability)
      .where(
        and(
          eq(connectionAvailability.bindingId, bindingId),
          eq(connectionAvailability.appId, appId),
        ),
      );
    return p;
  }
  async function owned(
    tx: Db,
    b: ConnectionWorkspaceBinding,
    c: ConnectionManagementContext,
    id: string,
  ) {
    const [r] = await tx
      .select({
        resource: connectionResources,
        connection: toolConnections,
        consent: connectionGrants,
      })
      .from(connectionResources)
      .innerJoin(
        toolConnections,
        eq(toolConnections.id, connectionResources.connectionId),
      )
      .innerJoin(
        connectionGrants,
        eq(connectionGrants.id, connectionResources.consentId),
      )
      .where(
        and(
          eq(connectionResources.bindingId, b.id),
          eq(connectionResources.connectionId, id),
          eq(connectionResources.ownerAccountId, c.requesterAccountId),
          eq(toolConnections.companyId, b.companyId),
          eq(connectionGrants.subjectUserId, c.requesterAccountId),
          eq(connectionGrants.kind, "user"),
        ),
      );
    return r;
  }
  async function inventory(
    tx: Db,
    b: ConnectionWorkspaceBinding,
    c: ConnectionManagementContext,
    id?: string,
  ) {
    const rows = await tx
      .select({
        resource: connectionResources,
        connection: toolConnections,
        consent: connectionGrants,
      })
      .from(connectionResources)
      .innerJoin(
        toolConnections,
        eq(toolConnections.id, connectionResources.connectionId),
      )
      .innerJoin(
        connectionGrants,
        eq(connectionGrants.id, connectionResources.consentId),
      )
      .where(
        and(
          eq(connectionResources.bindingId, b.id),
          eq(connectionResources.ownerAccountId, c.requesterAccountId),
          id ? eq(connectionResources.connectionId, id) : undefined,
        ),
      )
      .limit(100);
    const connections: NonNullable<ConnectionResult["connections"]> = [];
    for (const r of rows) {
      const p = await policy(tx, b.id, r.resource.appId);
      const { ready } = await registered(tx, b, r.resource.appId);
      connections.push({
        connectionId: r.connection.id,
        appId: r.resource.appId,
        displayName: r.connection.name,
        scope: "personal",
        outcome: !p?.enabled
          ? "denied"
          : !ready
            ? "requires-setup"
            : r.consent.status !== "active" ||
                connectionNeedsReauthorization(r.connection, r.consent)
              ? "authorization-required"
              : "ready",
      });
    }
    return connections;
  }
  async function authorize(
    tx: Db,
    b: ConnectionWorkspaceBinding,
    c: ConnectionManagementContext,
    id: string,
    resumeOnly = false,
  ) {
    const r = await owned(tx, b, c, id);
    if (!r) return result("denied");
    const p = await policy(tx, b.id, r.resource.appId);
    if (!p?.enabled) return result("denied");
    const { app, registration, ready } = await registered(
      tx,
      b,
      r.resource.appId,
    );
    if (!ready || !app || !registration) return result("requires-setup");
    if (resumeOnly) {
      const current = r.connection.config.oauth as
        | Record<string, unknown>
        | undefined;
      if (
        current?.clientId !== registration.clientId ||
        current?.clientRedirectUri !== registration.redirectUri ||
        (r.connection.credentialSecretRefs.find(
          (ref) => ref.configPath === "oauth.client_secret",
        )?.secretId ?? null) !== registration.clientSecretId
      )
        return result("authorization-required");
      const [state] = await tx
        .select()
        .from(toolOauthStates)
        .where(
          and(
            eq(toolOauthStates.externalBindingId, b.id),
            eq(toolOauthStates.externalOperationId, c.requestId),
            eq(toolOauthStates.subjectUserId, c.requesterAccountId),
          ),
        );
      if (
        !state ||
        state.expiresAt.getTime() <= Date.now() ||
        state.consentGeneration !== r.consent.consentGeneration ||
        r.consent.status !== "needs_reauthorization"
      )
        return result("authorization-required");
      // Canonical PKCE state is the only source for reconstructing an owner-private retry URL.
      const url = buildToolOAuthAuthorizationUrl({
        authorizationUrl: app.authorizationUrl,
        clientId: registration.clientId,
        redirectUri: state.redirectUri!,
        state: state.state,
        codeVerifier: state.codeVerifier,
        scopes: state.requestedScopes ?? app.scopes,
        googleOffline: app.appId === "gmail",
      });
      return result("authorization-required", {
        authorizationUrl: url.toString(),
      });
    }
    await tx
      .update(toolConnections)
      .set(
        registeredConnectionConfiguration(
          app,
          registration,
          connectionScopes(app, p.actions),
        ),
      )
      .where(eq(toolConnections.id, id));
    const generation = r.consent.consentGeneration + 1;
    await tx
      .update(connectionGrants)
      .set({
        consentGeneration: generation,
        status: "needs_reauthorization",
        credentialSecretRefs: [],
        providerTenant: null,
        updatedAt: new Date(),
      })
      .where(eq(connectionGrants.id, r.consent.id));
    await tx
      .delete(toolOauthStates)
      .where(eq(toolOauthStates.connectionId, id));
    const started = await toolAccessService(tx, {
      externalWorkspaceBindingId: b.id,
      externalFetch: providerFetch,
    }).startOAuth(b.companyId, id, {
      redirectUri: registration.redirectUri,
      actor: { actorType: "user", actorId: c.requesterAccountId },
      subjectUserId: c.requesterAccountId,
      scopes: connectionScopes(app, p.actions),
      externalOperationId: c.requestId,
      consentGeneration: generation,
    });
    return result("authorization-required", {
      authorizationUrl: started.authorizationUrl,
    });
  }
  async function apply(
    tx: Db,
    b: ConnectionWorkspaceBinding,
    c: ConnectionManagementContext,
    control: ConnectionControl,
  ): Promise<ConnectionResult> {
    const p = control.parameters;
    switch (control.operation) {
      case "catalog.get": {
        const apps: NonNullable<ConnectionResult["apps"]> = [];
        for (const app of connectionRegistry) {
          const availability = await policy(tx, b.id, app.appId);
          const { ready } = await registered(tx, b, app.appId);
          apps.push({
            appId: app.appId,
            displayName: app.displayName,
            enabled: availability?.enabled ?? false,
            actions: availability?.actions ?? [],
            outcome: ready ? "ready" : "requires-setup",
          });
        }
        return result("ready", { apps });
      }
      case "availability.set": {
        if (!admin(c)) return result("denied");
        const p = control.parameters;
        const { app, ready } = await registered(tx, b, p.appId);
        if (
          !app ||
          p.actions.some((a) => !(app.actions as readonly string[]).includes(a))
        )
          return result("denied");
        if (p.enabled && !ready) return result("requires-setup");
        await tx
          .insert(connectionAvailability)
          .values({ bindingId: b.id, ...p })
          .onConflictDoUpdate({
            target: [
              connectionAvailability.bindingId,
              connectionAvailability.appId,
            ],
            set: { enabled: p.enabled, actions: p.actions },
          });
        return result("complete");
      }
      case "connections.list":
        return result("ready", {
          connections:
            control.parameters.scope === "personal"
              ? await inventory(tx, b, c)
              : [],
        });
      case "connection.create-workspace":
        return result("denied"); // Gmail and KB credentials are individual resources.
      case "connection.create-personal": {
        const p = control.parameters;
        const { app, registration, ready } = await registered(tx, b, p.appId);
        if (!app) return result("denied");
        if (!ready || !registration) return result("requires-setup");
        if (!(await policy(tx, b.id, p.appId))?.enabled)
          return result("denied");
        const uid = randomUUID();
        const [application] = await tx
          .insert(toolApplications)
          .values({
            companyId: b.companyId,
            applicationKey: `crew.${uid}`,
            name: `Crew resource ${uid}`,
            type: "mcp_http",
            ownerUserId: c.requesterAccountId,
          })
          .returning();
        const [connection] = await tx
          .insert(toolConnections)
          .values({
            companyId: b.companyId,
            applicationId: application.id,
            externalBindingId: b.id,
            uid,
            name: p.displayName,
            transport: app.transport,
            authKind: "oauth",
            enabled: false,
            ...registeredConnectionConfiguration(app, registration),
            createdByUserId: c.requesterAccountId,
          })
          .returning();
        const [consent] = await tx
          .insert(connectionGrants)
          .values({
            companyId: b.companyId,
            connectionId: connection.id,
            kind: "user",
            subjectUserId: c.requesterAccountId,
            status: "needs_reauthorization",
            createdByUserId: c.requesterAccountId,
          })
          .returning();
        await tx.insert(connectionResources).values({
          bindingId: b.id,
          connectionId: connection.id,
          appId: p.appId,
          ownerAccountId: c.requesterAccountId,
          consentId: consent.id,
        });
        return result("complete", {
          connections: await inventory(tx, b, c, connection.id),
        });
      }
      case "connection.authorize":
        return authorize(tx, b, c, control.parameters.connectionId);
      case "connection.disconnect": {
        const r = await owned(tx, b, c, control.parameters.connectionId);
        if (!r) return result("denied");
        await tx
          .update(connectionGrants)
          .set({
            status: "revoked",
            consentGeneration: r.consent.consentGeneration + 1,
            credentialSecretRefs: [],
            revokedAt: new Date(),
            revokedByUserId: c.requesterAccountId,
            updatedAt: new Date(),
          })
          .where(eq(connectionGrants.id, r.consent.id));
        await tx
          .delete(toolOauthStates)
          .where(eq(toolOauthStates.connectionId, r.connection.id));
        await tx
          .update(connectionAgentAccess)
          .set({ revoked: true })
          .where(
            and(
              eq(connectionAgentAccess.bindingId, b.id),
              eq(connectionAgentAccess.connectionId, r.connection.id),
            ),
          );
        return result("complete");
      }
      case "access.list": {
        const requested = control.parameters.connectionId;
        if (requested && !(await owned(tx, b, c, requested)))
          return result("denied");
        // Bound effective access, not the historical storage rows preceding it.
        const rows = await tx
          .select({
            a: connectionAgentAccess,
            allowedActions: connectionAvailability.actions,
          })
          .from(connectionAgentAccess)
          .innerJoin(
            connectionResources,
            eq(
              connectionResources.connectionId,
              connectionAgentAccess.connectionId,
            ),
          )
          .innerJoin(
            connectionGrants,
            eq(connectionGrants.id, connectionAgentAccess.consentId),
          )
          .innerJoin(
            toolConnections,
            eq(toolConnections.id, connectionAgentAccess.connectionId),
          )
          .innerJoin(
            connectionAvailability,
            and(
              eq(
                connectionAvailability.bindingId,
                connectionAgentAccess.bindingId,
              ),
              eq(connectionAvailability.appId, connectionResources.appId),
            ),
          )
          .where(
            and(
              eq(connectionAgentAccess.bindingId, b.id),
              eq(connectionResources.ownerAccountId, c.requesterAccountId),
              requested
                ? eq(connectionAgentAccess.connectionId, requested)
                : undefined,
              eq(connectionAgentAccess.revoked, false),
              eq(connectionGrants.status, "active"),
              connectionCredentialsUsable(),
              eq(
                connectionAgentAccess.consentGeneration,
                connectionGrants.consentGeneration,
              ),
              eq(connectionAvailability.enabled, true),
              sql`EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(${connectionAgentAccess.actions}) AS granted(action)
                WHERE ${connectionAvailability.actions} ? granted.action
              )`,
            ),
          )
          .orderBy(
            connectionAgentAccess.connectionId,
            connectionAgentAccess.agentPubkey,
          )
          .limit(100);
        const access: NonNullable<ConnectionResult["access"]> = rows.map(
          ({ a, allowedActions }) => ({
            connectionId: a.connectionId,
            agentPubkey: a.agentPubkey,
            actions: a.actions.filter((action) =>
              allowedActions.includes(action),
            ),
          }),
        );
        const requests = (
          await tx
            .select()
            .from(connectionApprovalRequests)
            .where(
              and(
                eq(connectionApprovalRequests.bindingId, b.id),
                admin(c)
                  ? undefined
                  : eq(
                      connectionApprovalRequests.requesterAccountId,
                      c.requesterAccountId,
                    ),
              ),
            )
            .orderBy(
              sql`CASE WHEN ${connectionApprovalRequests.status} = 'pending' THEN 0 ELSE 1 END`,
              connectionApprovalRequests.createdAt,
              connectionApprovalRequests.id,
            )
            .limit(100)
        ).map((r) => ({
          approvalRequestId: r.id,
          appId: r.appId,
          requesterPubkey: r.requesterPubkey,
          agentPubkey: r.agentPubkey,
          actions: r.actions,
          status: r.status,
        }));
        return result("ready", { access, requests });
      }
      case "access.grant": {
        const p = control.parameters;
        const r = await owned(tx, b, c, p.connectionId);
        if (!r) return result("denied");
        const policyRow = await policy(tx, b.id, r.resource.appId);
        if (
          !policyRow?.enabled ||
          p.actions.some((x) => !policyRow.actions.includes(x))
        )
          return result("denied");
        if (
          r.consent.status !== "active" ||
          connectionNeedsReauthorization(r.connection, r.consent)
        )
          return result("authorization-required");
        if (p.actions.some((a) => a === "write" || a === "send")) {
          const oauth = r.connection.config.oauth as
            | Record<string, unknown>
            | undefined;
          if (r.resource.appId !== "gmail") return result("denied");
          if (
            typeof oauth?.scope !== "string" ||
            !oauth.scope
              .split(" ")
              .includes("https://www.googleapis.com/auth/gmail.compose")
          )
            return result("authorization-required");
        }
        const values = {
          consentId: r.consent.id,
          consentGeneration: r.consent.consentGeneration,
          actions: p.actions,
          revoked: false,
        };
        await tx
          .insert(connectionAgentAccess)
          .values({
            bindingId: b.id,
            connectionId: r.connection.id,
            agentPubkey: p.agentPubkey,
            ...values,
          })
          .onConflictDoUpdate({
            target: [
              connectionAgentAccess.bindingId,
              connectionAgentAccess.connectionId,
              connectionAgentAccess.agentPubkey,
            ],
            set: values,
          });
        return result("complete");
      }
      case "access.revoke": {
        const p = control.parameters;
        if (!(await owned(tx, b, c, p.connectionId))) return result("denied");
        await tx
          .update(connectionAgentAccess)
          .set({ revoked: true })
          .where(
            and(
              eq(connectionAgentAccess.bindingId, b.id),
              eq(connectionAgentAccess.connectionId, p.connectionId),
              eq(connectionAgentAccess.agentPubkey, p.agentPubkey),
            ),
          );
        return result("complete");
      }
      case "access.request": {
        const p = control.parameters;
        if (
          !connectionRegistry.some(
            (a) =>
              a.appId === p.appId &&
              p.actions.every((action) =>
                (a.actions as readonly string[]).includes(action),
              ),
          )
        )
          return result("denied");
        const policyRow = await policy(tx, b.id, p.appId);
        const status =
          policyRow?.enabled &&
          p.actions.every((a) => policyRow.actions.includes(a))
            ? "approved"
            : "pending";
        await tx.insert(connectionApprovalRequests).values({
          bindingId: b.id,
          requesterAccountId: c.requesterAccountId,
          requesterPubkey: c.requesterPubkey,
          ...p,
          status,
        });
        return result("complete");
      }
      case "access.request-resolve": {
        if (!admin(c)) return result("denied");
        const p = control.parameters;
        const [request] = await tx
          .select()
          .from(connectionApprovalRequests)
          .where(
            and(
              eq(connectionApprovalRequests.bindingId, b.id),
              eq(connectionApprovalRequests.id, p.approvalRequestId),
            ),
          );
        if (!request || request.status !== "pending") return result("denied");
        if (p.approved) {
          const { ready } = await registered(tx, b, request.appId);
          if (!ready) return result("requires-setup");
          const current = await policy(tx, b.id, request.appId);
          const actions = [
            ...new Set([...(current?.actions ?? []), ...request.actions]),
          ];
          await tx
            .insert(connectionAvailability)
            .values({
              bindingId: b.id,
              appId: request.appId,
              enabled: true,
              actions,
            })
            .onConflictDoUpdate({
              target: [
                connectionAvailability.bindingId,
                connectionAvailability.appId,
              ],
              set: { enabled: true, actions },
            });
        }
        await tx
          .update(connectionApprovalRequests)
          .set({ status: p.approved ? "approved" : "denied" })
          .where(eq(connectionApprovalRequests.id, request.id));
        return result("complete");
      }
    }
  }
  async function manage(
    bindingId: string,
    body: unknown,
  ): Promise<ConnectionResult> {
    const envelope = connectionManageEnvelopeSchema.parse(body);
    const control = connectionControlSchema.parse(parseExact(envelope.control));
    const digest = createHash("sha256")
      .update(envelope.control, "utf8")
      .digest("hex");
    const verified = await authority.resolveConnectionAuthority({
      bindingId,
      token: envelope.token,
      purpose: "management",
      action: control.operation,
      requestDigest: digest,
    });
    if (verified.context.schema !== "crew.connection-management/v1")
      throw forbidden();
    const c = verified.context;
    return db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      const [b] = await tx
        .select()
        .from(connectionWorkspaceBindings)
        .where(eq(connectionWorkspaceBindings.id, bindingId))
        .for("update");
      if (
        !b?.enabled ||
        b.updatedAt.getTime() !== verified.binding.updatedAt.getTime() ||
        c.expiresAt <= Math.floor(Date.now() / 1000)
      )
        throw forbidden();
      const [existing] = await tx
        .select()
        .from(connectionOperations)
        .where(
          and(
            eq(connectionOperations.bindingId, b.id),
            or(
              eq(connectionOperations.eventId, c.requestId),
              and(
                eq(
                  connectionOperations.requesterAccountId,
                  c.requesterAccountId,
                ),
                eq(connectionOperations.requestId, control.requestId),
              ),
            ),
          ),
        );
      if (existing) {
        if (
          existing.digest !== digest ||
          existing.requesterAccountId !== c.requesterAccountId ||
          existing.operation !== control.operation
        )
          throw conflict("Connection request intent changed");
        if (
          [
            "availability.set",
            "access.request-resolve",
            "connection.create-workspace",
          ].includes(control.operation) &&
          !admin(c)
        )
          return result("denied");
        if (control.operation === "connection.authorize")
          return authorize(
            tx,
            b,
            { ...c, requestId: existing.eventId },
            control.parameters.connectionId,
            true,
          );
        if (control.operation === "connection.create-personal") {
          const id = existing.result.connections?.[0]?.connectionId;
          return id
            ? result(existing.result.outcome, {
                connections: await inventory(tx, b, c, id),
              })
            : existing.result;
        }
        if (
          !["catalog.get", "connections.list", "access.list"].includes(
            control.operation,
          )
        )
          return existing.result;
      }
      const answer = await apply(tx, b, c, control);
      if (!existing) {
        const { authorizationUrl: _private, ...safe } = answer;
        await tx.insert(connectionOperations).values({
          bindingId: b.id,
          eventId: c.requestId,
          requestId: control.requestId,
          requesterAccountId: c.requesterAccountId,
          digest,
          operation: control.operation,
          result: {
            ...safe,
            apps: undefined,
            access: undefined,
            requests: undefined,
            connections: safe.connections?.map((r) => ({
              ...r,
              displayName: "Connection",
            })),
          },
        });
      }
      return answer;
    });
  }
  async function complete(
    bindingId: string,
    body: unknown,
  ): Promise<ConnectionResult> {
    const envelope = connectionCompleteEnvelopeSchema.parse(body);
    const callback = connectionOAuthCallbackSchema.parse(
      parseExact(envelope.callback),
    );
    const digest = createHash("sha256")
      .update(envelope.callback, "utf8")
      .digest("hex");
    const resolve = () =>
      authority.resolveConnectionAuthority({
        bindingId,
        token: envelope.token,
        purpose: "management",
        action: "connection.oauth-complete",
        requestDigest: digest,
      });
    const verified = await resolve();
    if (verified.context.schema !== "crew.connection-management/v1")
      throw forbidden();
    const c = verified.context;
    const [state] = await db
      .select()
      .from(toolOauthStates)
      .where(
        and(
          eq(toolOauthStates.state, callback.state),
          eq(toolOauthStates.externalBindingId, bindingId),
          eq(toolOauthStates.subjectUserId, c.requesterAccountId),
        ),
      );
    if (!state) throw forbidden("Connection callback denied");
    const r = await owned(db, verified.binding, c, state.connectionId);
    if (!r) throw forbidden();
    const issuer =
      r.resource.appId === "patty-kb"
        ? "https://login.patty.io/realms/internal"
        : "https://accounts.google.com";
    if (
      (r.resource.appId === "patty-kb" && !callback.iss) ||
      (callback.iss !== undefined && callback.iss !== issuer)
    )
      throw forbidden("Connection callback issuer denied");
    const { registration, ready } = await registered(
      db,
      verified.binding,
      r.resource.appId,
    );
    if (!ready || !registration)
      throw forbidden("Connection registration unavailable");
    const current = r.connection.config.oauth as
      | Record<string, unknown>
      | undefined;
    if (
      current?.clientId !== registration.clientId ||
      current?.clientRedirectUri !== registration.redirectUri ||
      (r.connection.credentialSecretRefs.find(
        (ref) => ref.configPath === "oauth.client_secret",
      )?.secretId ?? null) !== registration.clientSecretId
    )
      throw forbidden("Connection registration changed");

    await toolAccessService(db, {
      externalWorkspaceBindingId: bindingId,
      externalFetch: providerFetch,
      externalRevalidate: async () => {
        const latest = await resolve();
        const current = await registered(db, latest.binding, r.resource.appId);
        if (
          !current.ready ||
          JSON.stringify(current.registration) !== JSON.stringify(registration)
        )
          throw forbidden("Connection registration changed");
        return latest.context.expiresAt;
      },
      externalTokenIdentity:
        r.resource.appId === "patty-kb"
          ? (token) =>
              verifyConnectionKbIdentity(token, registration, providerFetch)
          : undefined,
    }).completeOAuthCallback({
      state: callback.state,
      ...("code" in callback
        ? { code: callback.code }
        : { error: callback.error }),
      redirectUri: registration.redirectUri,
      actor: { actorType: "user", actorId: c.requesterAccountId },
    });
    return result("complete");
  }
  return { manage, complete };
}
