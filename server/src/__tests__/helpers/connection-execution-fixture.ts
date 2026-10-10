import { connectionTlsPeer } from "./connection-tls-peer.js";
import { secretService } from "../../services/secrets.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, vi } from "vitest";
import {
  companies,
  connectionOrganizationBindings,
  connectionProviderRegistrations,
  connectionWorkspaceBindings,
  createDb,
} from "@pilotai/db";
import { connectionWorkspaceService } from "../../services/connection-workspaces.js";
import { startEmbeddedPostgresTestDatabase } from "./embedded-postgres.js";

/** One canonical migrated DB/TLS setup shared by execution regression suites. */
export function connectionExecutionFixture() {
  let db: ReturnType<typeof createDb>,
    temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const contexts = new Map<string, unknown>();
  const authorityHandler: typeof fetch = async (_url, init) =>
    Response.json({
      schema: "crew.connection-authority/v1",
      valid: true,
      context: contexts.get(JSON.parse(String(init?.body)).token),
    });
  let providerFetch: typeof fetch = async () =>
    Response.json({
      access_token: "owner-access",
      refresh_token: "owner-refresh",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });
  let tls: Awaited<ReturnType<typeof connectionTlsPeer>>;
  const authorityFetch: typeof fetch = (...args) => tls.fetch(...args);
  const resourceFetch: typeof fetch = (...args) => tls.fetch(...args);
  const service = () =>
    connectionWorkspaceService(db, {
      authorityFetch,
      providerFetch: resourceFetch,
    });
  beforeAll(async () => {
    tls = await connectionTlsPeer((url, init) =>
      String(url).startsWith("https://crew.example/")
        ? authorityHandler(url, init)
        : providerFetch(url, init),
    );
    vi.stubEnv("PILOT_SECRETS_MASTER_KEY", "22".repeat(32));
    temp = await startEmbeddedPostgresTestDatabase(
      "pilot-workspace-connections-",
    );
    db = createDb(temp.connectionString);
  });
  afterAll(async () => {
    try {
      expect(tls.calls()).toBeGreaterThan(20);
    } finally {
      await tls.close();
      vi.unstubAllEnvs();
      await temp?.cleanup();
    }
  });
  async function fixture(ready = true) {
    const [company] = await db
      .insert(companies)
      .values({ name: "Crew resources", issuePrefix: randomUUID() })
      .returning();
    const org = randomUUID();
    await db
      .insert(connectionOrganizationBindings)
      .values({ companyId: company.id, accountsOrganizationId: org });
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
    const control = JSON.stringify({
      schema: "crew.connections-control/v1",
      requestId,
      operation,
      parameters,
    });
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
  const manage = (
    b: Awaited<ReturnType<typeof fixture>>,
    op: string,
    p: unknown,
    actor = "owner",
    role = "admin",
  ) => service().manage(b.id, envelope(b, op, p, actor, role));
  async function personal(b: Awaited<ReturnType<typeof fixture>>) {
    await manage(b, "availability.set", {
      appId: "gmail",
      enabled: true,
      actions: ["read", "search"],
    });
    const r = await manage(b, "connection.create-personal", {
      appId: "gmail",
      displayName: "My Gmail",
    });
    return r.connections![0].connectionId;
  }
  function completion(
    b: Awaited<ReturnType<typeof fixture>>,
    state: string,
    actor = "owner",
  ) {
    const callback = JSON.stringify({
      schema: "crew.connection-oauth-callback/v1",
      state,
      code: "ephemeral-code",
    });
    const e = envelope(b, "connection.oauth-complete", {}, actor, "member");
    const c = contexts.get(e.token) as Record<string, unknown>;
    c.requestDigest = createHash("sha256").update(callback).digest("hex");
    return {
      schema: "crew.connections-oauth-complete/v1" as const,
      token: e.token,
      callback,
    };
  }
  async function connected(actions = ["read", "search"]) {
    providerFetch = async () =>
      Response.json({
        access_token: "owner-access",
        refresh_token: "owner-refresh",
        expires_in: 3600,
        scope:
          "https://www.googleapis.com/auth/gmail.readonly" +
          (actions.some((a) => a === "write" || a === "send")
            ? " https://www.googleapis.com/auth/gmail.compose"
            : ""),
      });
    const b = await fixture();
    const id = await personal(b);
    await manage(b, "availability.set", {
      appId: "gmail",
      enabled: true,
      actions,
    });
    const started = await manage(b, "connection.authorize", {
      connectionId: id,
    });
    const state = new URL(started.authorizationUrl!).searchParams.get("state")!;
    await service().complete(b.id, completion(b, state));
    await manage(b, "access.grant", {
      connectionId: id,
      agentPubkey: "c".repeat(64),
      actions,
    });
    return { b, id };
  }
  function execution(
    b: Awaited<ReturnType<typeof fixture>>,
    tool = "connections_gmail_search",
    args: unknown = { query: "subject:private" },
  ) {
    const token = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    contexts.set(token, {
      schema: "crew.connection-execution/v1",
      audience: "patty.connections",
      accountsOrganizationId: b.accountsOrganizationId,
      workspaceId: b.workspaceId,
      communityId: b.communityId,
      requesterAccountId: "owner",
      requesterPubkey: "a".repeat(64),
      issuedAt: now - 1,
      expiresAt: now + 59,
      action:
        tool === "connections_gmail_read"
          ? "gmail.read"
          : tool === "connections_gmail_send_draft"
            ? "gmail.send"
            : tool.endsWith("_draft") || tool.endsWith("_drafts")
              ? "gmail.write"
              : "gmail.search",
      agentPubkey: "c".repeat(64),
      enrollmentId: randomUUID(),
      generation: 1,
      channelId: randomUUID(),
      conversationId: randomUUID(),
      turnId: randomUUID(),
      sourceMemberAccountIds: ["owner"],
      audienceAccountIds: ["owner"],
    });
    return {
      schema: "crew.connections-execute/v1",
      token,
      tool,
      arguments: args,
    };
  }
  return {
    get db() {
      return db;
    },
    get providerFetch() {
      return providerFetch;
    },
    set providerFetch(value: typeof fetch) {
      providerFetch = value;
    },
    contexts,
    authorityFetch,
    resourceFetch,
    service,
    fixture,
    envelope,
    manage,
    personal,
    completion,
    connected,
    execution,
  };
}
