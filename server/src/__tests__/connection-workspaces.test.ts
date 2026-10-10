import { secretService } from "../services/secrets.js";
import express from "express";
import request from "supertest";
import { connectionWorkspaceRoutes } from "../routes/connection-workspaces.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  companies,
  companySecrets,
  secretAccessEvents,
  connectionAgentAccess,
  connectionAvailability,
  connectionGrants,
  connectionOperations,
  connectionOrganizationBindings,
  connectionProviderRegistrations,
  connectionResources,
  connectionWorkspaceBindings,
  createDb,
  toolOauthStates,
  agents,
  issues,
  heartbeatRuns,
} from "@pilotai/db";
import { connectionWorkspaceService } from "../services/connection-workspaces.js";
import { toolAccessService } from "../services/tool-access.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// These cases exercise migrated PostgreSQL, real authority resolver, consent and vault.
// Only the external authority/provider peers are controlled.
describe("Crew workspace Connections", () => {
  let db: ReturnType<typeof createDb>, temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const contexts = new Map<string, unknown>();
  const authorityFetch: typeof fetch = async (_url, init) =>
    Response.json({
      schema: "crew.connection-authority/v1",
      valid: true,
      context: contexts.get(JSON.parse(String(init?.body)).token),
    });
  let providerFetch: typeof fetch = async () =>
    Response.json({
      access_token: "owner-access",
      refresh_token: "owner-refresh",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });
  const service = () =>
    connectionWorkspaceService(db, { authorityFetch, providerFetch: (...args) => providerFetch(...args) });
  beforeAll(async () => {
    vi.stubEnv("PILOT_SECRETS_MASTER_KEY", "22".repeat(32));
    temp = await startEmbeddedPostgresTestDatabase("pilot-workspace-connections-");
    db = createDb(temp.connectionString);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await temp?.cleanup();
  });
  async function fixture(ready = true) {
    const [company] = await db
      .insert(companies)
      .values({ name: "Crew resources", issuePrefix: randomUUID() })
      .returning();
    const org = randomUUID();
    await db.insert(connectionOrganizationBindings).values({ companyId: company.id, accountsOrganizationId: org });
    const [binding] = await db
      .insert(connectionWorkspaceBindings)
      .values({
        companyId: company.id,
        accountsOrganizationId: org,
        workspaceId: randomUUID(),
        communityId: randomUUID(),
        authorityUrl: "https://crew.example/api/connections/introspect",
        enabled: true,
      })
      .returning();
    if (ready) {
      const clientSecret = await secretService(db).create(company.id, {
        name: "Provider registration",
        key: randomUUID(),
        provider: "local_encrypted",
        value: "synthetic-provider-client",
      });
      await db.insert(connectionProviderRegistrations).values({
        bindingId: binding.id,
        appId: "gmail",
        clientId: "registered-client",
        clientSecretId: clientSecret.id,
        redirectUri: "https://crew.example/api/connections/oauth/callback",
        qualified: true,
      });
    }
    return binding;
  }
  function envelope(
    binding: Awaited<ReturnType<typeof fixture>>,
    operation: string,
    parameters: unknown,
    actor = "owner",
    role = "admin",
    requestId = randomUUID(),
  ) {
    const control = JSON.stringify({ schema: "crew.connections-control/v1", requestId, operation, parameters });
    const token = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    contexts.set(token, {
      schema: "crew.connection-management/v1",
      audience: "patty.connections",
      accountsOrganizationId: binding.accountsOrganizationId,
      workspaceId: binding.workspaceId,
      communityId: binding.communityId,
      requesterAccountId: actor,
      requesterPubkey: actor === "owner" ? "a".repeat(64) : "b".repeat(64),
      issuedAt: now - 1,
      expiresAt: now + 59,
      role,
      requestId: createHash("sha256").update(token).digest("hex"),
      action: operation,
      requestDigest: createHash("sha256").update(control).digest("hex"),
    });
    return { schema: "crew.connections-manage/v1" as const, token, control };
  }
  const manage = (b: Awaited<ReturnType<typeof fixture>>, op: string, p: unknown, actor = "owner", role = "admin") =>
    service().manage(b.id, envelope(b, op, p, actor, role));
  async function personal(b: Awaited<ReturnType<typeof fixture>>) {
    await manage(b, "availability.set", { appId: "gmail", enabled: true, actions: ["read", "search"] });
    const r = await manage(b, "connection.create-personal", { appId: "gmail", displayName: "My Gmail" });
    return r.connections![0].connectionId;
  }
  function completion(b: Awaited<ReturnType<typeof fixture>>, state: string, actor = "owner") {
    const callback = JSON.stringify({ schema: "crew.connection-oauth-callback/v1", state, code: "ephemeral-code" });
    const e = envelope(b, "connection.oauth-complete", {}, actor, "member");
    const c = contexts.get(e.token) as Record<string, unknown>;
    c.requestDigest = createHash("sha256").update(callback).digest("hex");
    return { schema: "crew.connections-oauth-complete/v1" as const, token: e.token, callback };
  }
  it("separates unavailable registration from admin approval and rejects workspace human credentials", async () => {
    const b = await fixture(false);
    const catalog = await manage(b, "catalog.get", {});
    expect(catalog.apps?.map((x) => [x.appId, x.outcome])).toEqual([
      ["gmail", "requires-setup"],
      ["patty-kb", "requires-setup"],
    ]);
    expect((await manage(b, "availability.set", { appId: "gmail", enabled: true, actions: ["read"] })).outcome).toBe(
      "requires-setup",
    );
    expect(
      (await manage(b, "connection.create-workspace", { appId: "gmail", displayName: "Shared admin" })).outcome,
    ).toBe("denied");
    expect(await db.select().from(connectionResources).where(eq(connectionResources.bindingId, b.id))).toHaveLength(0);
  });
  it("members cannot change availability, see another owner, or substitute ownership", async () => {
    const b = await fixture();
    const id = await personal(b);
    expect(
      (await manage(b, "availability.set", { appId: "gmail", enabled: false, actions: ["read"] }, "other", "member"))
        .outcome,
    ).toBe("denied");
    expect((await manage(b, "connections.list", { scope: "personal" }, "other", "admin")).connections).toEqual([]);
    expect((await manage(b, "connection.authorize", { connectionId: id }, "other", "admin")).outcome).toBe("denied");
    expect(
      (await manage(b, "access.grant", { connectionId: id, agentPubkey: "c".repeat(64), actions: ["read"] })).outcome,
    ).toBe("authorization-required");
  });
  it("atomic exact-intent journal gives one resource and refuses request UUID substitution", async () => {
    const b = await fixture();
    await manage(b, "availability.set", { appId: "gmail", enabled: true, actions: ["read"] });
    const e = envelope(b, "connection.create-personal", { appId: "gmail", displayName: "Only once" });
    const results = await Promise.all([service().manage(b.id, e), service().manage(b.id, e)]);
    expect(results[0]).toEqual(results[1]);
    expect(await db.select().from(connectionResources).where(eq(connectionResources.bindingId, b.id))).toHaveLength(1);
    const changed = envelope(
      b,
      "connection.create-personal",
      { appId: "gmail", displayName: "Different" },
      "owner",
      "admin",
      JSON.parse(e.control).requestId,
    );
    await expect(service().manage(b.id, changed)).rejects.toMatchObject({ status: 409 });
  });
  it("approval is binding scoped policy and creates no personal grant", async () => {
    const b = await fixture();
    await manage(
      b,
      "access.request",
      { appId: "gmail", agentPubkey: "c".repeat(64), actions: ["search"] },
      "other",
      "member",
    );
    const list = await manage(b, "access.list", {});
    expect(list.requests).toHaveLength(1);
    expect((await manage(b, "access.list", {}, "third", "member")).requests).toEqual([]);
    const approvalRequestId = list.requests![0].approvalRequestId;
    expect(
      (await manage(b, "access.request-resolve", { approvalRequestId, approved: true }, "other", "member")).outcome,
    ).toBe("denied");
    expect((await manage(b, "access.request-resolve", { approvalRequestId, approved: true })).outcome).toBe("complete");
    expect(await db.select().from(connectionAgentAccess).where(eq(connectionAgentAccess.bindingId, b.id))).toEqual([]);
    expect(await db.select().from(connectionResources).where(eq(connectionResources.bindingId, b.id))).toEqual([]);
  });
  it("owner completes once, user vault stays private and reconnect invalidates agent generation", async () => {
    const b = await fixture();
    const id = await personal(b);
    const auth = await manage(b, "connection.authorize", { connectionId: id });
    expect(auth.outcome).toBe("authorization-required");
    expect(new URL(auth.authorizationUrl!).searchParams.get("access_type")).toBe("offline");
    expect(new URL(auth.authorizationUrl!).searchParams.get("prompt")).toBe("consent");
    const state = new URL(auth.authorizationUrl!).searchParams.get("state")!;
    await expect(service().complete(b.id, completion(b, state, "other"))).rejects.toMatchObject({ status: 403 });
    expect((await service().complete(b.id, completion(b, state))).outcome).toBe("complete");
    await expect(service().complete(b.id, completion(b, state))).rejects.toBeDefined();
    const [resource] = await db.select().from(connectionResources).where(eq(connectionResources.connectionId, id));
    const [consent] = await db.select().from(connectionGrants).where(eq(connectionGrants.id, resource.consentId));
    for (const ref of consent.credentialSecretRefs) {
      const [secret] = await db.select().from(companySecrets).where(eq(companySecrets.id, ref.secretId));
      expect(secret).toMatchObject({ scope: "user", ownerUserId: "owner" });
    }
    expect(
      (await manage(b, "access.grant", { connectionId: id, agentPubkey: "c".repeat(64), actions: ["read"] })).outcome,
    ).toBe("complete");
    expect((await manage(b, "access.list", { connectionId: id })).access).toHaveLength(1);
    const reconnect = await manage(b, "connection.authorize", { connectionId: id });
    expect((await manage(b, "access.list", { connectionId: id })).access).toEqual([]);
    await service().complete(b.id, completion(b, new URL(reconnect.authorizationUrl!).searchParams.get("state")!));
    expect((await manage(b, "access.list", { connectionId: id })).access).toEqual([]);
    await manage(b, "access.grant", { connectionId: id, agentPubkey: "c".repeat(64), actions: ["read"] });
    expect((await manage(b, "access.list", { connectionId: id })).access).toHaveLength(1);
    await expect(toolAccessService(db).getConnection(id)).rejects.toMatchObject({ status: 404 });
    expect(await toolAccessService(db).listConnections(b.companyId)).toEqual([]);
    const journal = JSON.stringify(
      await db.select().from(connectionOperations).where(eq(connectionOperations.bindingId, b.id)),
    );
    expect(journal).not.toMatch(/ephemeral-code|owner-access|owner-refresh|authorizationUrl|code_challenge|opaque/);
    expect(journal).not.toContain(state);
    for (const table of [agents, issues, heartbeatRuns])
      expect(await db.select().from(table).where(eq(table.companyId, b.companyId))).toHaveLength(0);
  });
  it("revocation during token exchange fences all credential publication", async () => {
    const b = await fixture();
    const id = await personal(b);
    const auth = await manage(b, "connection.authorize", { connectionId: id });
    const state = new URL(auth.authorizationUrl!).searchParams.get("state")!;
    let started!: () => void, release!: () => void;
    const began = new Promise<void>((r) => (started = r)),
      blocked = new Promise<void>((r) => (release = r));
    providerFetch = async () => {
      started();
      await blocked;
      return Response.json({ access_token: "stale-access" });
    };
    const result = service().complete(b.id, completion(b, state));
    const rejected = expect(result).rejects.toBeDefined();
    await began;
    await manage(b, "connection.disconnect", { connectionId: id });
    release();
    await rejected;
    expect(
      await db
        .select()
        .from(companySecrets)
        .where(and(eq(companySecrets.companyId, b.companyId), eq(companySecrets.scope, "user"))),
    ).toHaveLength(0);
    expect((await manage(b, "connections.list", { scope: "personal" })).connections![0].outcome).toBe(
      "authorization-required",
    );
  });
  it("private HTTP routes enforce original digest, body bounds and no native login", async () => {
    const b = await fixture();
    const app = express();
    app.use("/api/connection-workspaces", connectionWorkspaceRoutes(db, { authorityFetch, providerFetch }));
    const envelopeBody = envelope(b, "catalog.get", {});
    const response = await request(app).post(`/api/connection-workspaces/${b.id}/manage`).send(envelopeBody);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.apps).toHaveLength(2);
    const changed = await request(app)
      .post(`/api/connection-workspaces/${b.id}/manage`)
      .send({ ...envelopeBody, control: envelopeBody.control + " " });
    expect(changed.status).toBe(403);
    const huge = await request(app)
      .post(`/api/connection-workspaces/${b.id}/manage`)
      .send({ token: "secret".repeat(9000) });
    expect(huge.status).toBe(413);
    expect(JSON.stringify(huge.body)).not.toContain("secret");
    const unknown = await request(app)
      .post(`/api/connection-workspaces/${b.id}/manage`)
      .send({ ...envelopeBody, owner: "other" });
    expect(unknown.status).toBe(400);
  });
  it("same organization different workspace cannot list, grant, approve or consume a callback", async () => {
    const b = await fixture();
    const id = await personal(b);
    const [other] = await db
      .insert(connectionWorkspaceBindings)
      .values({
        companyId: b.companyId,
        accountsOrganizationId: b.accountsOrganizationId,
        workspaceId: randomUUID(),
        communityId: randomUUID(),
        authorityUrl: b.authorityUrl,
        enabled: true,
      })
      .returning();
    expect((await manage(other, "connections.list", { scope: "personal" })).connections).toEqual([]);
    expect(
      (await manage(other, "access.grant", { connectionId: id, agentPubkey: "c".repeat(64), actions: ["read"] }))
        .outcome,
    ).toBe("denied");
    const auth = await manage(b, "connection.authorize", { connectionId: id });
    const state = new URL(auth.authorizationUrl!).searchParams.get("state")!;
    await expect(service().complete(other.id, completion(other, state))).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(toolOauthStates).where(eq(toolOauthStates.state, state))).toHaveLength(1);
    const e = envelope(b, "connection.authorize", { connectionId: id });
    const first = await service().manage(b.id, e);
    expect(await service().manage(b.id, e)).toEqual(first);
    await manage(
      b,
      "access.request",
      { appId: "gmail", agentPubkey: "c".repeat(64), actions: ["read"] },
      "other",
      "member",
    );
    const requests = (await manage(b, "access.list", {})).requests!;
    expect(
      (
        await manage(other, "access.request-resolve", {
          approvalRequestId: requests[0].approvalRequestId,
          approved: true,
        })
      ).outcome,
    ).toBe("denied");
  });

  it("database prevents a resource or grant from borrowing another binding or consent", async () => {
    const b = await fixture();
    const id = await personal(b);
    const second = await personal(b);
    const [other] = await db
      .insert(connectionWorkspaceBindings)
      .values({
        companyId: b.companyId,
        accountsOrganizationId: b.accountsOrganizationId,
        workspaceId: randomUUID(),
        communityId: randomUUID(),
        authorityUrl: b.authorityUrl,
      })
      .returning();
    await expect(
      db.update(connectionResources).set({ bindingId: other.id }).where(eq(connectionResources.connectionId, id)),
    ).rejects.toThrow();
    const [different] = await db.select().from(connectionResources).where(eq(connectionResources.connectionId, second));
    await expect(
      db.insert(connectionAgentAccess).values({
        bindingId: b.id,
        connectionId: id,
        consentId: different.consentId,
        consentGeneration: 0,
        agentPubkey: "d".repeat(64),
        actions: ["read"],
      }),
    ).rejects.toThrow();
  });

  it("native token broker cannot resolve an external owner connection even in a valid active run", async () => {
    const b = await fixture();
    const id = await personal(b);
    const [agent] = await db
      .insert(agents)
      .values({
        companyId: b.companyId,
        name: "Native test agent",
        role: "engineer",
        status: "active",
        adapterType: "process",
      })
      .returning();
    const [issue] = await db
      .insert(issues)
      .values({ companyId: b.companyId, title: "Native fixture", status: "in_progress", assigneeAgentId: agent.id })
      .returning();
    const [run] = await db
      .insert(heartbeatRuns)
      .values({
        companyId: b.companyId,
        agentId: agent.id,
        invocationSource: "assignment",
        status: "running",
        contextSnapshot: { issueId: issue.id, responsibleUserId: "owner" },
      })
      .returning();
    await expect(
      toolAccessService(db).mintConnectionTokenForAgent({
        companyId: b.companyId,
        connectionId: id,
        agentId: agent.id,
        runId: run.id,
        body: { scope: "read" },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(secretAccessEvents).where(eq(secretAccessEvents.consumerId, id))).toHaveLength(0);
  });
  it("registration rotation invalidates an outstanding consent URL and fresh consent uses the new client", async () => {
    const b = await fixture();
    const id = await personal(b);
    const intent = envelope(b, "connection.authorize", { connectionId: id });
    const original = await service().manage(b.id, intent);
    const state = new URL(original.authorizationUrl!).searchParams.get("state")!;
    await db
      .update(connectionProviderRegistrations)
      .set({ clientId: "replacement-client" })
      .where(eq(connectionProviderRegistrations.bindingId, b.id));
    expect((await service().manage(b.id, intent)).authorizationUrl).toBeUndefined();
    await expect(service().complete(b.id, completion(b, state))).rejects.toMatchObject({ status: 403 });
    const fresh = await manage(b, "connection.authorize", { connectionId: id });
    expect(new URL(fresh.authorizationUrl!).searchParams.get("client_id")).toBe("replacement-client");
    expect(await db.select().from(toolOauthStates).where(eq(toolOauthStates.state, state))).toHaveLength(0);
  });
  it("provider issuer is checked against state app before any claim or exchange", async () => {
    const b = await fixture();
    let exchanges = 0;
    providerFetch = async () => {
      exchanges++;
      return Response.json({ access_token: "should-not-be-requested" });
    };
    const signed = (state: string, fields: Record<string, string>) => {
      const e = completion(b, state);
      e.callback = JSON.stringify({ schema: "crew.connection-oauth-callback/v1", state, ...fields });
      (contexts.get(e.token) as Record<string, unknown>).requestDigest = createHash("sha256")
        .update(e.callback)
        .digest("hex");
      return e;
    };
    const gmail = await personal(b);
    const ga = await manage(b, "connection.authorize", { connectionId: gmail });
    const gs = new URL(ga.authorizationUrl!).searchParams.get("state")!;
    await expect(
      service().complete(b.id, signed(gs, { code: "code", iss: "https://login.patty.io/realms/internal" })),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(toolOauthStates).where(eq(toolOauthStates.state, gs))).toHaveLength(1);
    await db.insert(connectionProviderRegistrations).values({
      bindingId: b.id,
      appId: "patty-kb",
      clientId: "kb-registered",
      audience: "https://mcp.kb.patty.io",
      redirectUri: "https://crew.example/api/connections/oauth/callback",
      qualified: true,
    });
    await manage(b, "availability.set", { appId: "patty-kb", enabled: true, actions: ["read"] });
    const kb = (await manage(b, "connection.create-personal", { appId: "patty-kb", displayName: "KB" })).connections![0]
      .connectionId;
    const ka = await manage(b, "connection.authorize", { connectionId: kb });
    const ks = new URL(ka.authorizationUrl!).searchParams.get("state")!;
    for (const fields of [{ code: "code" }, { code: "code", iss: "https://accounts.google.com" }]) {
      await expect(service().complete(b.id, signed(ks, fields))).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(toolOauthStates).where(eq(toolOauthStates.state, ks))).toHaveLength(1);
    }
    for (const [state, iss] of [
      [gs, "https://accounts.google.com"],
      [ks, "https://login.patty.io/realms/internal"],
    ]) {
      await expect(service().complete(b.id, signed(state, { error: "access_denied", iss }))).rejects.toMatchObject({
        status: 400,
      });
      expect(await db.select().from(toolOauthStates).where(eq(toolOauthStates.state, state))).toHaveLength(0);
    }
    expect(exchanges).toBe(0);
  });
  async function activePersonal(b: Awaited<ReturnType<typeof fixture>>) {
    const id = await personal(b);
    const auth = await manage(b, "connection.authorize", { connectionId: id });
    await service().complete(b.id, completion(b, new URL(auth.authorizationUrl!).searchParams.get("state")!));
    const [resource] = await db.select().from(connectionResources).where(eq(connectionResources.connectionId, id));
    const [consent] = await db.select().from(connectionGrants).where(eq(connectionGrants.id, resource.consentId));
    expect(consent).toMatchObject({ status: "active", subjectUserId: "owner" });
    expect(consent.credentialSecretRefs.length).toBeGreaterThan(0);
    return { id, resource, consent };
  }

  it("admin app disable preserves stored consent but denies effective grants and pending callback publication", async () => {
    const b = await fixture();
    const active = await activePersonal(b);
    const target = "c".repeat(64);
    expect(
      (await manage(b, "access.grant", { connectionId: active.id, agentPubkey: target, actions: ["read"] })).outcome,
    ).toBe("complete");
    expect((await manage(b, "access.list", {})).access).toHaveLength(1);
    const pending = await personal(b);
    const auth = await manage(b, "connection.authorize", { connectionId: pending });
    const state = new URL(auth.authorizationUrl!).searchParams.get("state")!;
    const resources = await db
      .select()
      .from(connectionResources)
      .where(eq(connectionResources.bindingId, b.id))
      .orderBy(connectionResources.connectionId);
    const consents = await db
      .select()
      .from(connectionGrants)
      .where(eq(connectionGrants.companyId, b.companyId))
      .orderBy(connectionGrants.id);
    const grants = await db
      .select()
      .from(connectionAgentAccess)
      .where(eq(connectionAgentAccess.bindingId, b.id))
      .orderBy(connectionAgentAccess.id);
    const secrets = await db
      .select()
      .from(companySecrets)
      .where(and(eq(companySecrets.companyId, b.companyId), eq(companySecrets.scope, "user")))
      .orderBy(companySecrets.id);
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(db, { authorityFetch, providerFetch: (...args) => providerFetch(...args) }),
    );
    const disabled = await request(app)
      .post(`/api/connection-workspaces/${b.id}/manage`)
      .send(envelope(b, "availability.set", { appId: "gmail", enabled: false, actions: ["read", "search"] }));
    expect(disabled.status).toBe(200);
    expect(disabled.body.outcome).toBe("complete");
    const [availability] = await db
      .select()
      .from(connectionAvailability)
      .where(and(eq(connectionAvailability.bindingId, b.id), eq(connectionAvailability.appId, "gmail")));
    expect(availability.enabled).toBe(false);
    expect((await manage(b, "access.list", {})).access).toEqual([]);
    expect((await manage(b, "connections.list", { scope: "personal" })).connections?.map((r) => r.outcome)).toEqual([
      "denied",
      "denied",
    ]);
    expect(
      (await manage(b, "access.grant", { connectionId: active.id, agentPubkey: target, actions: ["read"] })).outcome,
    ).toBe("denied");
    expect((await manage(b, "connection.authorize", { connectionId: active.id })).outcome).toBe("denied");
    await expect(service().complete(b.id, completion(b, state))).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(toolOauthStates).where(eq(toolOauthStates.state, state))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(connectionResources)
        .where(eq(connectionResources.bindingId, b.id))
        .orderBy(connectionResources.connectionId),
    ).toEqual(resources);
    expect(
      await db
        .select()
        .from(connectionGrants)
        .where(eq(connectionGrants.companyId, b.companyId))
        .orderBy(connectionGrants.id),
    ).toEqual(consents);
    expect(
      await db
        .select()
        .from(connectionAgentAccess)
        .where(eq(connectionAgentAccess.bindingId, b.id))
        .orderBy(connectionAgentAccess.id),
    ).toEqual(grants);
    expect(
      await db
        .select()
        .from(companySecrets)
        .where(and(eq(companySecrets.companyId, b.companyId), eq(companySecrets.scope, "user")))
        .orderBy(companySecrets.id),
    ).toEqual(secrets);
  });

  it("owner explicitly revokes one active agent grant and another owner cannot revoke it", async () => {
    const b = await fixture();
    const first = await activePersonal(b),
      second = await activePersonal(b);
    const target = "c".repeat(64),
      otherTarget = "d".repeat(64);
    for (const [connectionId, agentPubkey] of [
      [first.id, target],
      [first.id, otherTarget],
      [second.id, target],
    ])
      expect((await manage(b, "access.grant", { connectionId, agentPubkey, actions: ["read"] })).outcome).toBe(
        "complete",
      );
    const before = await db
      .select()
      .from(connectionAgentAccess)
      .where(eq(connectionAgentAccess.bindingId, b.id))
      .orderBy(connectionAgentAccess.id);
    const resources = await db
      .select()
      .from(connectionResources)
      .where(eq(connectionResources.bindingId, b.id))
      .orderBy(connectionResources.connectionId);
    const consents = await db
      .select()
      .from(connectionGrants)
      .where(eq(connectionGrants.companyId, b.companyId))
      .orderBy(connectionGrants.id);
    expect(before).toHaveLength(3);
    expect(before.every((g) => !g.revoked)).toBe(true);
    expect(
      (await manage(b, "access.revoke", { connectionId: first.id, agentPubkey: target }, "other", "admin")).outcome,
    ).toBe("denied");
    expect(
      await db
        .select()
        .from(connectionAgentAccess)
        .where(eq(connectionAgentAccess.bindingId, b.id))
        .orderBy(connectionAgentAccess.id),
    ).toEqual(before);
    expect((await manage(b, "access.list", {})).access).toHaveLength(3);
    expect((await manage(b, "access.revoke", { connectionId: first.id, agentPubkey: target })).outcome).toBe(
      "complete",
    );
    const after = await db
      .select()
      .from(connectionAgentAccess)
      .where(eq(connectionAgentAccess.bindingId, b.id))
      .orderBy(connectionAgentAccess.id);
    expect(after).toEqual(
      before.map((g) => ({ ...g, revoked: g.connectionId === first.id && g.agentPubkey === target })),
    );
    expect((await manage(b, "access.list", { connectionId: first.id })).access).toEqual([
      { connectionId: first.id, agentPubkey: otherTarget, actions: ["read"] },
    ]);
    expect((await manage(b, "access.list", { connectionId: second.id })).access).toEqual([
      { connectionId: second.id, agentPubkey: target, actions: ["read"] },
    ]);
    expect(
      await db
        .select()
        .from(connectionResources)
        .where(eq(connectionResources.bindingId, b.id))
        .orderBy(connectionResources.connectionId),
    ).toEqual(resources);
    expect(
      await db
        .select()
        .from(connectionGrants)
        .where(eq(connectionGrants.companyId, b.companyId))
        .orderBy(connectionGrants.id),
    ).toEqual(consents);
    const [availability] = await db
      .select()
      .from(connectionAvailability)
      .where(and(eq(connectionAvailability.bindingId, b.id), eq(connectionAvailability.appId, "gmail")));
    expect(availability.enabled).toBe(true);
  });

  it("historical grants cannot fill the bounded deterministic effective access list", async () => {
    const b = await fixture();
    const active = await activePersonal(b);
    const inactive = await activePersonal(b);
    await manage(b, "connection.disconnect", { connectionId: inactive.id });
    await db.insert(connectionProviderRegistrations).values({
      bindingId: b.id,
      appId: "patty-kb",
      clientId: "kb-client",
      audience: "https://mcp.kb.patty.io",
      redirectUri: "https://crew.example/api/connections/oauth/callback",
      qualified: true,
    });
    await manage(b, "availability.set", { appId: "patty-kb", enabled: true, actions: ["read"] });
    const disabledId = (
      await manage(b, "connection.create-personal", { appId: "patty-kb", displayName: "Historical KB" })
    ).connections![0].connectionId;
    const [disabled] = await db
      .select()
      .from(connectionResources)
      .where(eq(connectionResources.connectionId, disabledId));
    // Seed historical consent metadata only: this case tests inventory, not KB OAuth.
    await db.update(connectionGrants).set({ status: "active" }).where(eq(connectionGrants.id, disabled.consentId));
    await manage(b, "availability.set", { appId: "patty-kb", enabled: false, actions: ["read"] });
    await manage(b, "availability.set", { appId: "gmail", enabled: true, actions: ["read"] });
    const hex = (n: number) => n.toString(16).padStart(64, "0");
    const history: Array<typeof connectionAgentAccess.$inferInsert> = [];
    for (let n = 0; n < 105; n++) {
      const common = {
        bindingId: b.id,
        connectionId: active.id,
        consentId: active.consent.id,
        consentGeneration: active.consent.consentGeneration,
        actions: ["read"] as Array<"read" | "search">,
      };
      history.push({ ...common, agentPubkey: hex(n + 1), revoked: true });
      history.push({ ...common, agentPubkey: hex(n + 1001), consentGeneration: active.consent.consentGeneration - 1 });
      history.push({ ...common, agentPubkey: hex(n + 2001), actions: ["search"] });
      history.push({
        ...common,
        connectionId: inactive.id,
        consentId: inactive.consent.id,
        consentGeneration: inactive.consent.consentGeneration + 1,
        agentPubkey: hex(n + 3001),
      });
      history.push({
        ...common,
        connectionId: disabledId,
        consentId: disabled.consentId,
        consentGeneration: 0,
        agentPubkey: hex(n + 4001),
      });
    }
    await db.insert(connectionAgentAccess).values(history);
    const visible = { connectionId: active.id, agentPubkey: hex(6000), actions: ["read"] };
    expect((await manage(b, "access.grant", visible)).outcome).toBe("complete");
    expect((await manage(b, "access.list", {})).access).toEqual([visible]);
    const current = Array.from({ length: 104 }, (_, n) => ({
      bindingId: b.id,
      connectionId: active.id,
      consentId: active.consent.id,
      consentGeneration: active.consent.consentGeneration,
      agentPubkey: hex(6001 + n),
      actions: ["read", "search"] as Array<"read" | "search">,
    }));
    await db.insert(connectionAgentAccess).values(current.reverse());
    const expected = Array.from({ length: 100 }, (_, n) => ({
      connectionId: active.id,
      agentPubkey: hex(6000 + n),
      actions: ["read"],
    }));
    expect((await manage(b, "access.list", {})).access).toEqual(expected);
    expect((await manage(b, "access.list", { connectionId: active.id })).access).toEqual(expected);
    expect(await db.select().from(connectionAgentAccess).where(eq(connectionAgentAccess.bindingId, b.id))).toHaveLength(
      630,
    );
  });
});
