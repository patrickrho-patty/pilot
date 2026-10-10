import { secretService } from "../services/secrets.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  companies,
  companySecrets,
  connectionGrants,
  connectionOrganizationBindings,
  connectionWorkspaceBindings,
  createDb,
  toolApplications,
  toolConnections,
  toolOauthStates,
} from "@pilotai/db";
import { toolAccessService } from "../services/tool-access.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// Real migrated storage and canonical OAuth/vault. Only the remote provider is controlled.
describe("owner consent boundary", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    vi.stubEnv("PILOT_SECRETS_MASTER_KEY", "11".repeat(32));
    temp = await startEmbeddedPostgresTestDatabase("pilot-consent-");
    db = createDb(temp.connectionString);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await temp?.cleanup();
  });
  async function fixture() {
    const [company] = await db.insert(companies).values({ name: "Consent", issuePrefix: randomUUID() }).returning();
    const [app] = await db
      .insert(toolApplications)
      .values({ companyId: company.id, name: randomUUID(), type: "mcp_http" })
      .returning();
    const [connection] = await db
      .insert(toolConnections)
      .values({
        companyId: company.id,
        applicationId: app.id,
        name: "Private resource",
        uid: randomUUID(),
        transport: "rest_api",
        authKind: "oauth",
        config: {
          oauth: {
            provider: "fixture",
            authorizationUrl: "https://provider.example/authorize",
            tokenUrl: "https://provider.example/token",
            clientId: "registered-client",
            clientRedirectUri: "https://crew.example/api/connections/oauth/callback",
            scopes: ["read"],
          },
        },
      })
      .returning();
    const svc = toolAccessService(db);
    const started = await svc.startOAuth(company.id, connection.id, {
      redirectUri: "https://crew.example/api/connections/oauth/callback",
      actor: { actorType: "user", actorId: "owner" },
      subjectUserId: "owner",
    });
    return { company, connection, svc, state: new URL(started.authorizationUrl).searchParams.get("state")! };
  }
  const callback = (state: string) => ({
    state,
    code: "ephemeral-code",
    redirectUri: "https://crew.example/api/connections/oauth/callback",
    actor: { actorType: "user" as const, actorId: "owner" },
  });
  it("wrong redirect cannot consume owner state", async () => {
    const f = await fixture();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ access_token: "private-token" }));
    await expect(
      f.svc.completeOAuthCallback({ ...callback(f.state), redirectUri: "https://evil.example/callback" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(toolOauthStates).where(eq(toolOauthStates.state, f.state))).toHaveLength(1);
  });
  it("publishes personal tokens only in the canonical user vault", async () => {
    const f = await fixture();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ access_token: "private-token", refresh_token: "private-refresh" }),
    );
    await f.svc.completeOAuthCallback(callback(f.state));
    const [grant] = await db.select().from(connectionGrants).where(eq(connectionGrants.connectionId, f.connection.id));
    expect(grant.subjectUserId).toBe("owner");
    for (const ref of grant.credentialSecretRefs) {
      const [secret] = await db.select().from(companySecrets).where(eq(companySecrets.id, ref.secretId));
      expect(secret).toMatchObject({ scope: "user", ownerUserId: "owner" });
    }
  });
  it("claims owner state once before two concurrent provider exchanges", async () => {
    const f = await fixture();
    let exchanges = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      exchanges++;
      return Response.json({ access_token: "private-token" });
    });
    const results = await Promise.allSettled([
      f.svc.completeOAuthCallback(callback(f.state)),
      f.svc.completeOAuthCallback(callback(f.state)),
    ]);
    expect(exchanges).toBe(1);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
  it("database refuses company deletion while even a disabled Crew binding exists", async () => {
    const f = await fixture();
    await db
      .insert(connectionOrganizationBindings)
      .values({ companyId: f.company.id, accountsOrganizationId: randomUUID() });
    const [org] = await db
      .select()
      .from(connectionOrganizationBindings)
      .where(eq(connectionOrganizationBindings.companyId, f.company.id));
    await db.insert(connectionWorkspaceBindings).values({
      companyId: f.company.id,
      accountsOrganizationId: org.accountsOrganizationId,
      workspaceId: randomUUID(),
      communityId: randomUUID(),
      authorityUrl: "https://crew.example/api/connections/introspect",
    });
    await expect(db.delete(companies).where(eq(companies.id, f.company.id))).rejects.toThrow();
  });
  it("reconnect migrates a legacy company-scoped personal reference without rotating it", async () => {
    const f = await fixture();
    const legacy = await secretService(db).create(f.company.id, {
      name: "Legacy personal token",
      key: randomUUID(),
      provider: "local_encrypted",
      value: "legacy-token",
    });
    await db.insert(connectionGrants).values({
      companyId: f.company.id,
      connectionId: f.connection.id,
      kind: "user",
      subjectUserId: "owner",
      credentialSecretRefs: [
        {
          secretId: legacy.id,
          versionSelector: "latest",
          configPath: "oauth.access_token",
          required: true,
          label: "Legacy",
        },
      ],
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ access_token: "new-personal-token" }));
    await f.svc.completeOAuthCallback(callback(f.state));
    const [g] = await db.select().from(connectionGrants).where(eq(connectionGrants.connectionId, f.connection.id));
    expect(g.credentialSecretRefs[0].secretId).not.toBe(legacy.id);
    const [newSecret] = await db
      .select()
      .from(companySecrets)
      .where(eq(companySecrets.id, g.credentialSecretRefs[0].secretId));
    expect(newSecret).toMatchObject({ scope: "user", ownerUserId: "owner" });
    const [oldSecret] = await db.select().from(companySecrets).where(eq(companySecrets.id, legacy.id));
    expect(oldSecret.latestVersion).toBe(1);
  });

  it("two callbacks queued on the actual state lock perform one exchange", async () => {
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((r) => (locked = r)),
      gate = new Promise<void>((r) => (release = r));
    const locker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT state FROM tool_oauth_states WHERE state=${f.state} FOR UPDATE`);
      locked();
      await gate;
    });
    await ready;
    let exchanges = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      exchanges++;
      return Response.json({ access_token: "one-exchange" });
    });
    const callbacks = Promise.allSettled([
      f.svc.completeOAuthCallback(callback(f.state)),
      f.svc.completeOAuthCallback(callback(f.state)),
    ]);
    try {
      const deadline = Date.now() + 5000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const rows = await db.execute(
          sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'delete from "tool_oauth_states"%'`,
        );
        waiting = Number(rows[0]?.n ?? 0);
        if (waiting === 2) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(2);
    } finally {
      release();
      await locker;
    }
    const results = await callbacks;
    expect(exchanges).toBe(1);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
});
