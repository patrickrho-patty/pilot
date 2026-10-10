import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { companies, connectionOrganizationBindings, connectionWorkspaceBindings, createDb } from "@pilotai/db";
import type { ConnectionManagementContext, ConnectionExecutionContext } from "@pilotai/shared";
import { connectionAuthorityService } from "../services/connection-authority.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("connection authority with current persisted bindings", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let binding: typeof connectionWorkspaceBindings.$inferSelect;
  let management: ConnectionManagementContext;
  let execution: ConnectionExecutionContext;
  let response: () => Response | Promise<Response>;
  let requests: Array<{ url: string; init?: RequestInit }>;

  // Only the external HTTPS peer is controlled. Storage and resolver stay real.
  const fetchAuthority: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return response();
  };
  const resolve = () => connectionAuthorityService(db, { fetch: fetchAuthority }).resolveConnectionAuthority({
    bindingId: binding.id, token: "opaque-connections-token", purpose: "management",
    action: "connections.list", requestDigest: "c".repeat(64),
  });
  const verdict = (context: unknown) => Response.json({ schema: "crew.connection-authority/v1", valid: true, context });

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("pilot-connection-authority-");
    db = createDb(tempDb.connectionString);
  }, 30_000);
  beforeEach(async () => {
    const [company] = await db.insert(companies).values({ name: "Shared resources", issuePrefix: `C${randomUUID().slice(0, 8)}` }).returning();
    await db.insert(connectionOrganizationBindings).values({ companyId: company.id, accountsOrganizationId: "organization-1" });
    [binding] = await db.insert(connectionWorkspaceBindings).values({
      companyId: company.id, accountsOrganizationId: "organization-1", workspaceId: randomUUID(), communityId: randomUUID(),
      authorityUrl: "https://crew.example/api/connections/introspect", enabled: true,
    }).returning();
    const now = Math.floor(Date.now() / 1_000);
    const common = {
      audience: "patty.connections" as const, accountsOrganizationId: binding.accountsOrganizationId,
      workspaceId: binding.workspaceId, communityId: binding.communityId,
      requesterAccountId: "account-1", requesterPubkey: "a".repeat(64),
      issuedAt: now - 1, expiresAt: now + 59,
    };
    management = { ...common, schema: "crew.connection-management/v1", role: "member", requestId: "b".repeat(64), action: "connections.list", requestDigest: "c".repeat(64) };
    execution = {
      ...common, schema: "crew.connection-execution/v1", action: "gmail.search", agentPubkey: "d".repeat(64), enrollmentId: randomUUID(), generation: 1,
      channelId: randomUUID(), conversationId: "channel:conversation-1", turnId: randomUUID(), sourceMemberAccountIds: ["account-1"], audienceAccountIds: ["account-1"],
    };
    requests = [];
    response = () => verdict(management);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await db.delete(connectionWorkspaceBindings);
    await db.delete(connectionOrganizationBindings);
    await db.delete(companies);
  });
  afterAll(async () => { await tempDb?.cleanup(); });

  it("returns the verified identity in the stored company namespace and sends only the token envelope", async () => {
    const result = await resolve();
    expect(result.binding.companyId).toBe(binding.companyId);
    expect(result.context).toMatchObject({ requesterAccountId: "account-1", role: "member", action: "connections.list" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://crew.example/api/connections/introspect");
    expect(requests[0].init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ schema: "crew.connection-introspection/v1", token: "opaque-connections-token" });
    expect(requests[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts an execution identity without native Pilot agent/run records", async () => {
    response = () => verdict(execution);
    const result = await connectionAuthorityService(db, { fetch: fetchAuthority }).resolveConnectionAuthority({
      bindingId: binding.id, token: "opaque-execution-token", purpose: "execution", action: "gmail.search",
    });
    expect(result.context).toMatchObject({ schema: "crew.connection-execution/v1", generation: 1, audienceAccountIds: ["account-1"] });
  });

  it("denies reuse of an execution capability for a different action", async () => {
    response = () => verdict(execution);
    await expect(connectionAuthorityService(db, { fetch: fetchAuthority }).resolveConnectionAuthority({
      bindingId: binding.id, token: "opaque-execution-token", purpose: "execution", action: "gmail.read",
    })).rejects.toMatchObject({ status: 403 });
  });

  it.each(["missing", "disabled"])("denies %s binding before contacting the authority", async (state) => {
    if (state === "missing") await db.delete(connectionWorkspaceBindings).where(eq(connectionWorkspaceBindings.id, binding.id));
    else await db.update(connectionWorkspaceBindings).set({ enabled: false }).where(eq(connectionWorkspaceBindings.id, binding.id));
    await expect(resolve()).rejects.toMatchObject({ status: 403 });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["organization", { accountsOrganizationId: "other-org" }],
    ["workspace", { workspaceId: randomUUID() }],
    ["community", { communityId: randomUUID() }],
    ["audience", { audience: "native.pilot" }],
    ["action", { action: "connections.revoke" }],
    ["digest", { requestDigest: "e".repeat(64) }],
    ["native token context", { schema: "pilot.gateway/v1" }],
    ["expired", { issuedAt: 1_000, expiresAt: 1_060 }],
    ["unknown identity", { callerIdentity: "spoof" }],
    ["management/agent ambiguity", { agentPubkey: "f".repeat(64) }],
  ])("denies wrong %s", async (_case, override) => {
    response = () => verdict({ ...management, ...override });
    await expect(resolve()).rejects.toMatchObject({ status: 403 });
  });

  it("denies execution authority for a management operation", async () => {
    response = () => verdict(execution);
    await expect(resolve()).rejects.toMatchObject({ status: 403 });
  });
  it("denies management authority for an execution operation", async () => {
    await expect(connectionAuthorityService(db, { fetch: fetchAuthority }).resolveConnectionAuthority({
      bindingId: binding.id, token: "opaque-token", purpose: "execution", action: "gmail.search",
    })).rejects.toMatchObject({ status: 403 });
  });
  it.each(["sourceMemberAccountIds", "audienceAccountIds"] as const)("denies duplicate or empty %s", async (field) => {
    for (const accounts of [[], ["account-1", "account-1"]]) {
      response = () => verdict({ ...execution, [field]: accounts });
      await expect(connectionAuthorityService(db, { fetch: fetchAuthority }).resolveConnectionAuthority({
        bindingId: binding.id, token: "opaque-token", purpose: "execution", action: "gmail.search",
      })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("enforces expiry exclusively at the boundary and rejects future or overlong authority", async () => {
    const now = Math.floor(Date.now() / 1_000);
    for (const timestamps of [
      { issuedAt: now - 60, expiresAt: now },
      { issuedAt: now + 1, expiresAt: now + 60 },
      { issuedAt: now - 1, expiresAt: now + 60 },
    ]) {
      response = () => verdict({ ...management, ...timestamps });
      await expect(resolve()).rejects.toMatchObject({ status: 403 });
    }
  });

  it.each([
    ["revoked", () => Response.json({ schema: "crew.connection-authority/v1", valid: false })],
    ["invalid JSON", () => new Response("secret-provider-body")],
    ["redirect", () => new Response(null, { status: 302, headers: { location: "https://evil.test" } })],
    ["unavailable", () => new Response("secret-provider-body", { status: 503 })],
    ["transport error", () => { throw new Error("secret-provider-body opaque-connections-token"); }],
  ])("fails closed on %s without exposing sensitive body/token", async (_case, factory) => {
    response = factory;
    const error = await resolve().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/secret-provider-body|opaque-connections-token/);
  });

  it("fails closed on an unknown outer key with an otherwise valid context", async () => {
    response = () => Response.json({ schema: "crew.connection-authority/v1", valid: true, context: management, extra: "secret-provider-body" });
    const error = await resolve().catch((error: unknown) => error);
    expect(error).toMatchObject({ status: 403 });
    expect(String(error)).not.toMatch(/secret-provider-body|opaque-connections-token/);
  });

  it("bounds the response even without Content-Length", async () => {
    let cancelled = false;
    response = () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(16_384)); },
      cancel() { cancelled = true; },
    }));
    await expect(resolve()).rejects.toMatchObject({ status: 503 });
    expect(cancelled).toBe(true);
  });
  it("refuses an oversized declared response before reading it", async () => {
    response = () => new Response("{}", { headers: { "content-length": "1000000" } });
    await expect(resolve()).rejects.toMatchObject({ status: 503 });
  });
  it("times out a stalled authority request within five seconds", async () => {
    // Let the real database lookup complete before advancing only the transport clock.
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    response = () => { started(); return new Promise<Response>(() => {}); };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = resolve();
    const denied = expect(pending).rejects.toMatchObject({ status: 503 });
    await didStart;
    await vi.advanceTimersByTimeAsync(5_001);
    await denied;
    expect(requests[0].init?.signal?.aborted).toBe(true);
  });
  it("cancels a stalled response stream when its request budget expires", async () => {
    let reading!: () => void;
    const didRead = new Promise<void>((resolve) => { reading = resolve; });
    let cancelled = false;
    response = () => new Response(new ReadableStream({
      pull() { reading(); },
      cancel() { cancelled = true; },
    }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const denied = expect(resolve()).rejects.toMatchObject({ status: 503 });
    await didRead;
    await vi.advanceTimersByTimeAsync(5_001);
    await denied;
    expect(cancelled).toBe(true);
  });

  it("rechecks the binding and fresh verdict on every call", async () => {
    const service = connectionAuthorityService(db, { fetch: fetchAuthority });
    const input = { bindingId: binding.id, token: "same-token", purpose: "management" as const, action: "connections.list", requestDigest: "c".repeat(64) };
    await service.resolveConnectionAuthority(input);
    response = () => Response.json({ schema: "crew.connection-authority/v1", valid: false });
    await expect(service.resolveConnectionAuthority(input)).rejects.toMatchObject({ status: 403 });
    await db.update(connectionWorkspaceBindings).set({ enabled: false }).where(eq(connectionWorkspaceBindings.id, binding.id));
    await expect(service.resolveConnectionAuthority(input)).rejects.toMatchObject({ status: 403 });
    expect(requests).toHaveLength(2);
  });
  it("rejects a binding disabled while introspection is in flight", async () => {
    response = async () => {
      await db.update(connectionWorkspaceBindings).set({ enabled: false }).where(eq(connectionWorkspaceBindings.id, binding.id));
      return verdict(management);
    };
    await expect(resolve()).rejects.toMatchObject({ status: 403 });
  });
  it("uses only a changed current persisted authority endpoint", async () => {
    await resolve();
    await db.update(connectionWorkspaceBindings).set({ authorityUrl: "https://new-crew.example/api/connections/introspect" }).where(eq(connectionWorkspaceBindings.id, binding.id));
    await resolve();
    expect(requests.map((request) => request.url)).toEqual(["https://crew.example/api/connections/introspect", "https://new-crew.example/api/connections/introspect"]);
  });
  it("rejects caller-supplied identity or URLs before transport", async () => {
    await expect(connectionAuthorityService(db, { fetch: fetchAuthority }).resolveConnectionAuthority({
      bindingId: binding.id, token: "opaque-token", purpose: "management", action: "connections.list", requestDigest: "c".repeat(64),
      authorityUrl: "https://evil.test", requesterAccountId: "spoof",
    } as Parameters<ReturnType<typeof connectionAuthorityService>["resolveConnectionAuthority"]>[0])).rejects.toMatchObject({ status: 403 });
    expect(requests).toHaveLength(0);
  });

  it("stores new bindings disabled and forbids ambiguous workspace/community namespaces", async () => {
    const [company] = await db.insert(companies).values({ name: "Other namespace", issuePrefix: "OTHER" }).returning();
    await db.insert(connectionOrganizationBindings).values({ companyId: company.id, accountsOrganizationId: "org-2" });
    const [disabled] = await db.insert(connectionWorkspaceBindings).values({
      companyId: company.id, accountsOrganizationId: "org-2", workspaceId: randomUUID(), communityId: randomUUID(), authorityUrl: binding.authorityUrl,
    }).returning();
    expect(disabled.enabled).toBe(false);
    await expect(db.insert(connectionWorkspaceBindings).values({
      companyId: company.id, accountsOrganizationId: "org-2", workspaceId: binding.workspaceId, communityId: binding.communityId, authorityUrl: binding.authorityUrl,
    })).rejects.toThrow();
    await expect(db.delete(companies).where(eq(companies.id, company.id))).rejects.toThrow();
    expect(await db.select().from(connectionWorkspaceBindings).where(eq(connectionWorkspaceBindings.id, disabled.id))).toHaveLength(1);
  });
  it("allows multiple workspaces from the same organization in one company namespace", async () => {
    const [other] = await db.insert(connectionWorkspaceBindings).values({
      companyId: binding.companyId, accountsOrganizationId: binding.accountsOrganizationId,
      workspaceId: randomUUID(), communityId: randomUUID(), authorityUrl: binding.authorityUrl,
    }).returning();
    expect(other.companyId).toBe(binding.companyId);
    expect(other.enabled).toBe(false);
  });
  it("forbids a workspace binding from borrowing another company's organization", async () => {
    const [otherCompany] = await db.insert(companies).values({ name: "Another namespace", issuePrefix: "ANOTHER" }).returning();
    await db.insert(connectionOrganizationBindings).values({ companyId: otherCompany.id, accountsOrganizationId: "org-2" });
    await expect(db.insert(connectionWorkspaceBindings).values({
      companyId: binding.companyId, accountsOrganizationId: "org-2", workspaceId: randomUUID(), communityId: randomUUID(), authorityUrl: binding.authorityUrl,
    })).rejects.toThrow();
    await expect(db.insert(connectionWorkspaceBindings).values({
      companyId: otherCompany.id, accountsOrganizationId: binding.accountsOrganizationId, workspaceId: randomUUID(), communityId: randomUUID(), authorityUrl: binding.authorityUrl,
    })).rejects.toThrow();
  });
  it("forbids the same Accounts organization in two company namespaces", async () => {
    const [otherCompany] = await db.insert(companies).values({ name: "Conflicting namespace", issuePrefix: "CONFLICT" }).returning();
    await expect(db.insert(connectionOrganizationBindings).values({ companyId: otherCompany.id, accountsOrganizationId: binding.accountsOrganizationId })).rejects.toThrow();
  });
  it("serializes concurrent organization mappings for the same company", async () => {
    const [company] = await db.insert(companies).values({ name: "Concurrent namespace", issuePrefix: "RACE" }).returning();
    const results = await Promise.allSettled([
      db.insert(connectionOrganizationBindings).values({ companyId: company.id, accountsOrganizationId: "race-org-1" }),
      db.insert(connectionOrganizationBindings).values({ companyId: company.id, accountsOrganizationId: "race-org-2" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.select().from(connectionOrganizationBindings).where(eq(connectionOrganizationBindings.companyId, company.id))).toHaveLength(1);
  });
});
