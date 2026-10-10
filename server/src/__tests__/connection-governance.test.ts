import { ConnectionTlsDisconnect } from "./helpers/connection-tls-peer.js";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  toolAccessAuditEvents,
  toolConnections,
  connectionGrants,
  connectionApprovalRequests,
  connectionAvailability,
} from "@pilotai/db";
import { connectionWorkspaceRoutes } from "../routes/connection-workspaces.js";
import { connectionExecutionFixture } from "./helpers/connection-execution-fixture.js";

describe("external Connections governance", () => {
  const f = connectionExecutionFixture();
  const app = () =>
    express().use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
  const call = (
    b: Awaited<ReturnType<typeof f.fixture>>,
    body = f.execution(b),
    route = "execute",
  ) =>
    request(app())
      .post(`/api/connection-workspaces/${b.id}/${route}`)
      .send(body);
  const prepare = (b: Awaited<ReturnType<typeof f.fixture>>) =>
    call(
      b,
      { ...f.execution(b), schema: "crew.connections-prepare/v1" },
      "prepare",
    );
  const inventory = (b: Awaited<ReturnType<typeof f.fixture>>) =>
    f.manage(b, "connections.list", { scope: "personal" });
  async function expire(id: string, claim?: object) {
    const [row] = await f.db
      .select()
      .from(toolConnections)
      .where(eq(toolConnections.id, id));
    await f.db
      .update(toolConnections)
      .set({
        config: {
          ...row.config,
          oauth: {
            ...(row.config.oauth as object),
            expiresAt: new Date(0).toISOString(),
            ...(claim ? { externalRefresh: claim } : {}),
          },
        },
      })
      .where(eq(toolConnections.id, id));
  }
  it("durably audits trusted execution context and distinct outcomes without private material", async () => {
    const { b } = await f.connected();
    const body = f.execution(b, "connections_gmail_search", {
      query: "PRIVATE_QUERY_SENTINEL",
    });
    const context = f.contexts.get(body.token) as Record<string, unknown>;
    f.providerFetch = async () =>
      Response.json({ messages: [{ id: "a123", threadId: "b123" }] });
    expect((await call(b, body)).status).toBe(200);
    let rows = await f.db
      .select()
      .from(toolAccessAuditEvents)
      .where(eq(toolAccessAuditEvents.companyId, b.companyId));
    expect(rows).toHaveLength(1);
    const first = rows[0];
    expect(first).toMatchObject({
      actorType: "user",
      actorId: "owner",
      action: "gmail.search",
      outcome: "success",
      gatewayId: null,
      gatewayTokenId: null,
      catalogEntryId: null,
    });
    expect(first.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.details).toMatchObject({
      source: "crew_connections",
      operation: "execute",
      bindingId: b.id,
      workspaceId: b.workspaceId,
      communityId: b.communityId,
      requesterAccountId: "owner",
      agentPubkey: context.agentPubkey,
      enrollmentId: context.enrollmentId,
      generation: 1,
      channelId: context.channelId,
      conversationId: context.conversationId,
      turnId: context.turnId,
    });
    f.providerFetch = async () =>
      Response.json({ error: "PRIVATE_BODY_SENTINEL" }, { status: 503 });
    expect((await call(b)).status).toBeGreaterThanOrEqual(400);
    f.providerFetch = async () => {
      throw new ConnectionTlsDisconnect("PRIVATE_BODY_SENTINEL");
    };
    expect((await call(b)).status).toBeGreaterThanOrEqual(400);
    await f.db
      .update(connectionAvailability)
      .set({ enabled: false })
      .where(eq(connectionAvailability.bindingId, b.id));
    expect((await call(b)).status).toBe(403);
    const untrusted = { ...f.execution(b), token: "untrusted-submitted-token" };
    expect((await call(b, untrusted)).status).toBeGreaterThanOrEqual(400);
    rows = await f.db
      .select()
      .from(toolAccessAuditEvents)
      .where(eq(toolAccessAuditEvents.companyId, b.companyId));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.outcome).sort()).toEqual([
      "denied",
      "provider_error",
      "success",
      "uncertain",
    ]);
    expect(new Set(rows.map((r) => r.correlationId)).size).toBe(4);
    expect(rows.find((r) => r.id === first.id)?.correlationId).toBe(
      first.correlationId,
    );
    for (const secret of [
      body.token,
      "owner-access",
      "PRIVATE_QUERY_SENTINEL",
      "PRIVATE_BODY_SENTINEL",
      "a123",
      "untrusted-submitted-token",
    ])
      expect(JSON.stringify(rows)).not.toContain(secret);
  });
  it("persists an uncertain attempt before provider work and records later owner revocation", async () => {
    const { b, id } = await f.connected();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      blocked = new Promise<void>((r) => (release = r));
    f.providerFetch = async () => {
      enter();
      await blocked;
      return Response.json({ messages: [{ id: "a123", threadId: "b123" }] });
    };
    const pending = call(b).then((r) => r);
    await entered;
    const [during] = await f.db
      .select()
      .from(toolAccessAuditEvents)
      .where(eq(toolAccessAuditEvents.companyId, b.companyId));
    expect(during.outcome).toBe("uncertain");
    expect(during.details.phase).toBe("provider");
    await f.manage(b, "access.revoke", {
      connectionId: id,
      agentPubkey: "c".repeat(64),
    });
    release();
    expect((await pending).status).toBe(403);
    const after = await f.db
      .select()
      .from(toolAccessAuditEvents)
      .where(eq(toolAccessAuditEvents.companyId, b.companyId));
    expect(after).toHaveLength(1);
    expect(after[0].outcome).toBe("denied");
    expect(after[0].correlationId).toBe(during.correlationId);
    expect(after[0].details.turnId).toBe(during.details.turnId);
    expect(JSON.stringify(after)).not.toContain("a123");
  });
  it("projects invalid-grant and abandoned refresh as reconnect required without replay", async () => {
    for (const abandoned of [false, true]) {
      const { b, id } = await f.connected();
      const [consent] = await f.db
        .select()
        .from(connectionGrants)
        .where(eq(connectionGrants.connectionId, id));
      await expire(
        id,
        abandoned
          ? {
              id: randomUUID(),
              consentId: consent.id,
              generation: consent.consentGeneration,
              expiresAt: Date.now() - 1,
            }
          : undefined,
      );
      let exchanges = 0;
      f.providerFetch = async () => {
        exchanges++;
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      };
      if (!abandoned) expect((await call(b)).status).toBe(403);
      expect((await inventory(b)).connections?.[0].outcome).toBe(
        "authorization-required",
      );
      expect((await f.manage(b, "access.list", {})).access).toEqual([]);
      expect((await prepare(b)).status).toBe(403);
      expect(
        (
          await call(
            b,
            {
              ...f.execution(b),
              schema: "crew.connections-catalog/v1",
              arguments: undefined,
            },
            "catalog",
          )
        ).status,
      ).toBe(403);
      expect((await call(b)).status).toBe(403);
      expect(exchanges).toBe(abandoned ? 0 : 1);
    }
  });
  it("keeps healthy refresh in flight distinct and fences old failure after new consent", async () => {
    const { b, id } = await f.connected();
    await expire(id);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      blocked = new Promise<void>((r) => (release = r));
    f.providerFetch = async () => {
      enter();
      await blocked;
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    };
    const pending = call(b).then((r) => r);
    await entered;
    expect((await inventory(b)).connections?.[0].outcome).toBe("ready");
    expect((await prepare(b)).status).toBe(200);
    f.providerFetch = async () =>
      Response.json({
        access_token: "new-owner-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      });
    const started = await f.manage(b, "connection.authorize", {
      connectionId: id,
    });
    await f
      .service()
      .complete(
        b.id,
        f.completion(
          b,
          new URL(started.authorizationUrl!).searchParams.get("state")!,
        ),
      );
    await f.manage(b, "access.grant", {
      connectionId: id,
      agentPubkey: "c".repeat(64),
      actions: ["search"],
    });
    const [fresh] = await f.db
      .select()
      .from(connectionGrants)
      .where(eq(connectionGrants.connectionId, id));
    release();
    expect((await pending).status).toBe(403);
    expect((await inventory(b)).connections?.[0].outcome).toBe("ready");
    const [after] = await f.db
      .select()
      .from(connectionGrants)
      .where(eq(connectionGrants.id, fresh.id));
    expect(after.consentGeneration).toBe(fresh.consentGeneration);
    expect(after.status).toBe("active");
    expect(after.credentialSecretRefs).toEqual(fresh.credentialSecretRefs);
    f.providerFetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer new-owner-access",
      );
      return Response.json({ messages: [] });
    };
    expect((await call(b)).status).toBe(200);
  });
  it("keeps pending approvals visible and resolvable after one hundred terminal rows", async () => {
    const { b } = await f.connected();
    await f.db
      .insert(connectionApprovalRequests)
      .values(
        Array.from({ length: 100 }, () => ({
          bindingId: b.id,
          requesterAccountId: "owner",
          requesterPubkey: "a".repeat(64),
          appId: "gmail",
          agentPubkey: "c".repeat(64),
          actions: ["read"] as Array<"read">,
          status: "denied" as const,
        })),
      );
    const [pending] = await f.db
      .insert(connectionApprovalRequests)
      .values({
        bindingId: b.id,
        requesterAccountId: "owner",
        requesterPubkey: "a".repeat(64),
        appId: "gmail",
        agentPubkey: "c".repeat(64),
        actions: ["read"],
        status: "pending",
      })
      .returning();
    const listed = await f.manage(b, "access.list", {});
    expect(listed.requests?.map((r) => r.approvalRequestId)).toContain(
      pending.id,
    );
    expect(
      (
        await f.manage(b, "access.request-resolve", {
          approvalRequestId: pending.id,
          approved: true,
        })
      ).outcome,
    ).toBe("complete");
    expect(
      (await f.manage(b, "access.list", {}, "other", "member")).requests,
    ).toEqual([]);
  });
  it("denies two owner resources and recovers after the competing grant is revoked", async () => {
    const { b, id } = await f.connected();
    const second = await f.personal(b);
    const started = await f.manage(b, "connection.authorize", {
      connectionId: second,
    });
    await f
      .service()
      .complete(
        b.id,
        f.completion(
          b,
          new URL(started.authorizationUrl!).searchParams.get("state")!,
        ),
      );
    await f.manage(b, "access.grant", {
      connectionId: second,
      agentPubkey: "c".repeat(64),
      actions: ["search"],
    });
    let reads = 0;
    f.providerFetch = async () => {
      reads++;
      return Response.json({ messages: [] });
    };
    expect((await prepare(b)).status).toBe(403);
    expect(reads).toBe(0);
    expect((await inventory(b)).connections).toHaveLength(2);
    expect((await f.manage(b, "access.list", {})).access).toHaveLength(2);
    expect(
      (
        await f.manage(
          b,
          "connections.list",
          { scope: "personal" },
          "other",
          "member",
        )
      ).connections,
    ).toEqual([]);
    expect(
      (await f.manage(b, "access.list", {}, "other", "member")).access,
    ).toEqual([]);
    await f.manage(b, "access.revoke", {
      connectionId: second,
      agentPubkey: "c".repeat(64),
    });
    expect((await prepare(b)).status).toBe(200);
    expect((await call(b)).status).toBe(200);
    expect(reads).toBe(1);
    expect(
      (await f.manage(b, "access.list", {})).access?.[0].connectionId,
    ).toBe(id);
  });
});
