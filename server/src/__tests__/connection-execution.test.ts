import { secretService } from "../services/secrets.js";
import express from "express";
import request from "supertest";
import { connectionWorkspaceRoutes } from "../routes/connection-workspaces.js";
import { createHash, randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  companySecrets,
  secretAccessEvents,
  connectionAvailability,
  connectionGrants,
  connectionOperations,
  connectionProviderRegistrations,
  connectionResources,
  toolConnections,
  agents,
  issues,
  heartbeatRuns,
} from "@pilotai/db";

import { connectionExecutionFixture } from "./helpers/connection-execution-fixture.js";

describe("Crew personal execution", () => {
  const f = connectionExecutionFixture();
  it("mediates an owner Gmail search using only canonical user credentials and fixed me resource", async () => {
    const { b } = await f.connected();
    const seen: string[] = [];
    f.providerFetch = async (url, init) => {
      seen.push(String(url));
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer owner-access",
      );
      return Response.json({
        messages: [{ id: "a123", threadId: "b123" }],
        resultSizeEstimate: 1,
      });
    };
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const response = await request(app)
      .post(`/api/connection-workspaces/${b.id}/execute`)
      .send(f.execution(b));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schema: "crew.connections-execution-result/v1",
      content: [{ type: "text" }],
    });
    expect(response.body.content[0].text).toContain("a123");
    expect(seen).toEqual([
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=subject%3Aprivate&maxResults=10",
    ]);
    expect(JSON.stringify(response.body)).not.toContain("owner-access");
    expect(
      await f.db.select().from(agents).where(eq(agents.companyId, b.companyId)),
    ).toHaveLength(0);
    expect(
      await f.db.select().from(issues).where(eq(issues.companyId, b.companyId)),
    ).toHaveLength(0);
    expect(
      await f.db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.companyId, b.companyId)),
    ).toHaveLength(0);
  });
  it("reads bounded Gmail text without attachments or shared activity content", async () => {
    const { b } = await f.connected();
    let reads = 0;
    const sentinel = "Owner-private Gmail body sentinel";
    f.providerFetch = async (url, init) => {
      reads++;
      expect(String(url)).toBe(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/a123?format=full",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer owner-access",
      );
      return Response.json({
        id: "a123",
        threadId: "b123",
        snippet: "Only a short summary",
        payload: {
          mimeType: "multipart/mixed",
          headers: [{ name: "Subject", value: "Private subject" }],
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                {
                  mimeType: "text/html",
                  body: {
                    data: Buffer.from("<p>HTML fallback</p>").toString(
                      "base64url",
                    ),
                  },
                },
                {
                  mimeType: "text/plain",
                  body: { data: Buffer.from(sentinel).toString("base64url") },
                },
              ],
            },
            {
              mimeType: "text/plain",
              filename: "secret.txt",
              body: {
                data: Buffer.from("Distinct attachment sentinel").toString(
                  "base64url",
                ),
              },
            },
            {
              mimeType: "text/plain",
              body: {
                attachmentId: "attachment-only",
                data: Buffer.from("Distinct attachment sentinel").toString(
                  "base64url",
                ),
              },
            },
            {
              mimeType: "text/plain",
              headers: [{ name: "Content-Disposition", value: "attachment" }],
              body: {
                data: Buffer.from("Distinct attachment sentinel").toString(
                  "base64url",
                ),
              },
            },
          ],
        },
      });
    };
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const response = await request(app)
      .post(`/api/connection-workspaces/${b.id}/execute`)
      .send(f.execution(b, "connections_gmail_read", { messageId: "a123" }));
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.content[0].text).text).toBe(sentinel);
    expect(JSON.parse(response.body.content[0].text).bodyStatus).toBe(
      "complete",
    );
    expect(JSON.stringify(response.body)).not.toContain(
      "Distinct attachment sentinel",
    );
    expect(reads).toBe(1);
    const logs = [
      await f.db
        .select()
        .from(connectionOperations)
        .where(eq(connectionOperations.bindingId, b.id)),
      await f.db
        .select()
        .from(secretAccessEvents)
        .where(eq(secretAccessEvents.companyId, b.companyId)),
    ];
    expect(JSON.stringify(logs)).not.toContain(sentinel);
    expect(JSON.stringify(logs)).not.toContain("owner-access");
    const denied = await request(app)
      .post(`/api/connection-workspaces/${b.id}/execute`)
      .send(
        f.execution(b, "connections_gmail_read", {
          messageId: "a123",
          attachmentId: "private",
        }),
      );
    expect(denied.status).toBe(400);
    expect(reads).toBe(1);
  });

  it("prepares only current eligible strict requests without provider or vault access", async () => {
    const { b, id } = await f.connected();
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      throw new Error("preparation must not fetch");
    };
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const prepare = (args: unknown = { messageId: "a123" }) =>
      request(app)
        .post(`/api/connection-workspaces/${b.id}/prepare`)
        .send({
          ...f.execution(b, "connections_gmail_read", args),
          schema: "crew.connections-prepare/v1",
        });
    const logsBefore = await f.db
      .select()
      .from(secretAccessEvents)
      .where(eq(secretAccessEvents.companyId, b.companyId));
    expect(
      (await prepare({ messageId: "a123", attachmentId: "no" })).status,
    ).toBe(400);
    expect((await prepare()).body).toEqual({
      schema: "crew.connections-prepared/v1",
      tool: "connections_gmail_read",
    });
    await f.db
      .update(connectionAvailability)
      .set({ enabled: false })
      .where(eq(connectionAvailability.bindingId, b.id));
    expect((await prepare()).status).toBe(403);
    await f.db
      .update(connectionAvailability)
      .set({ enabled: true })
      .where(eq(connectionAvailability.bindingId, b.id));
    await f.db
      .update(connectionProviderRegistrations)
      .set({ qualified: false })
      .where(eq(connectionProviderRegistrations.bindingId, b.id));
    expect((await prepare()).status).toBe(403);
    await f.db
      .update(connectionProviderRegistrations)
      .set({ qualified: true })
      .where(eq(connectionProviderRegistrations.bindingId, b.id));
    const admitted = f.execution(b, "connections_gmail_read", {
      messageId: "a123",
    });
    expect(
      (
        await request(app)
          .post(`/api/connection-workspaces/${b.id}/prepare`)
          .send({ ...admitted, schema: "crew.connections-prepare/v1" })
      ).status,
    ).toBe(200);
    await f.db
      .update(connectionGrants)
      .set({ status: "revoked" })
      .where(eq(connectionGrants.connectionId, id));
    expect((await prepare()).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/connection-workspaces/${b.id}/execute`)
          .send(admitted)
      ).status,
    ).toBe(403);
    expect(calls).toBe(0);
    expect(
      await f.db
        .select()
        .from(secretAccessEvents)
        .where(eq(secretAccessEvents.companyId, b.companyId)),
    ).toEqual(logsBefore);
  });

  it("refreshes an expired canonical consent once across competing executions", async () => {
    f.providerFetch = async () =>
      Response.json({
        access_token: "owner-access",
        refresh_token: "owner-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      });
    const { b, id } = await f.connected();
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
          },
        },
      })
      .where(eq(toolConnections.id, id));
    let exchanges = 0,
      reads = 0;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    f.providerFetch = async (url, init) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        exchanges++;
        expect(
          new URLSearchParams(String(init?.body)).get("refresh_token"),
        ).toBe("owner-refresh");
        enter();
        await blocked;
        return Response.json({
          access_token: "refreshed-access",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        });
      }
      reads++;
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer refreshed-access",
      );
      return Response.json({ messages: [{ id: "a123", threadId: "b123" }] });
    };
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const replica = express();
    replica.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const first = request(app)
      .post(`/api/connection-workspaces/${b.id}/execute`)
      .send(f.execution(b))
      .then((r) => r);
    await entered;
    const [claimed] = await f.db
      .select()
      .from(toolConnections)
      .where(eq(toolConnections.id, id));
    const claim = (claimed.config.oauth as Record<string, unknown>)
      .externalRefresh as Record<string, unknown>;
    expect(claim.id).toEqual(expect.any(String));
    expect(claim.consentId).toEqual(expect.any(String));
    const second = request(replica)
      .post(`/api/connection-workspaces/${b.id}/execute`)
      .send(f.execution(b))
      .then((r) => r);
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(exchanges).toBe(1);
    expect(reads).toBe(2);
  });

  it("rejects wrong principals, extra arguments and writes before any resource call", async () => {
    const { b } = await f.connected();
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      return Response.json({ messages: [] });
    };
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const denied = async (e: ReturnType<typeof f.execution>) =>
      expect(
        (
          await request(app)
            .post(`/api/connection-workspaces/${b.id}/execute`)
            .send(e)
        ).status,
      ).toBeGreaterThanOrEqual(400);
    for (const [key, value] of [
      ["requesterAccountId", "other"],
      ["agentPubkey", "d".repeat(64)],
      ["workspaceId", randomUUID()],
      ["audienceAccountIds", ["owner", "other"]],
      ["sourceMemberAccountIds", ["owner", "other"]],
      ["expiresAt", 0],
      ["action", "gmail.read"],
    ]) {
      const e = f.execution(b);
      (f.contexts.get(e.token) as Record<string, unknown>)[key as string] =
        value;
      await denied(e);
    }
    await denied(
      f.execution(b, "connections_gmail_send", {
        to: "other",
        body: "private",
      }),
    );
    await denied(
      f.execution(b, "connections_gmail_search", {
        query: "private",
        userId: "other",
      }),
    );
    expect(calls).toBe(0);
  });
  it("discards a blocked provider result after owner revoke", async () => {
    const { b, id } = await f.connected();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      blocked = new Promise<void>((r) => (release = r));
    f.providerFetch = async () => {
      enter();
      await blocked;
      return Response.json({ messages: [{ id: "a123", threadId: "b123" }] });
    };
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const pending = request(app)
      .post(`/api/connection-workspaces/${b.id}/execute`)
      .send(f.execution(b))
      .then((r) => r);
    await entered;
    await f.manage(b, "access.revoke", {
      connectionId: id,
      agentPubkey: "c".repeat(64),
    });
    release();
    const response = await pending;
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain("a123");
  });
  it.each([
    "reconnect",
    "disable",
    "rotate",
    "registration-disable",
    "secret-rotate",
    "revoke",
  ])("discards blocked rotating refresh on %s and never publishes returned credentials", async (mode) => {
    const { b, id } = await f.connected();
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
          },
        },
      })
      .where(eq(toolConnections.id, id));
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      blocked = new Promise<void>((r) => (release = r));
    let calls = 0;
    f.providerFetch = async (url) => {
      calls++;
      expect(String(url)).toBe("https://oauth2.googleapis.com/token");
      enter();
      await blocked;
      return Response.json({
        access_token: "stale-returned-token",
        expires_in: 3600,
      });
    };
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const pending = request(app)
      .post(`/api/connection-workspaces/${b.id}/execute`)
      .send(f.execution(b))
      .then((r) => r);
    await entered;
    const before = await f.db
      .select()
      .from(companySecrets)
      .where(eq(companySecrets.companyId, b.companyId));
    if (mode === "reconnect")
      await f.manage(b, "connection.authorize", { connectionId: id });
    if (mode === "disable")
      await f.manage(b, "availability.set", {
        appId: "gmail",
        enabled: false,
        actions: ["read", "search"],
      });
    if (mode === "rotate")
      await f.db
        .update(connectionProviderRegistrations)
        .set({ clientId: "replacement-client" })
        .where(eq(connectionProviderRegistrations.bindingId, b.id));
    if (mode === "registration-disable")
      await f.db
        .update(connectionProviderRegistrations)
        .set({ qualified: false })
        .where(eq(connectionProviderRegistrations.bindingId, b.id));
    if (mode === "secret-rotate") {
      const [registration] = await f.db
        .select()
        .from(connectionProviderRegistrations)
        .where(eq(connectionProviderRegistrations.bindingId, b.id));
      await secretService(f.db).rotate(registration.clientSecretId!, {
        value: "replacement-provider-client",
      });
    }
    if (mode === "revoke")
      await f.manage(b, "connection.disconnect", { connectionId: id });
    release();
    const response = await pending;
    expect(response.status).toBe(403);
    expect(calls).toBe(1);
    expect(
      (
        await f.db
          .select()
          .from(companySecrets)
          .where(eq(companySecrets.companyId, b.companyId))
      ).map((s) => [s.id, s.latestVersion, s.scope, s.ownerUserId]),
    ).toEqual(
      before.map((s) => [
        s.id,
        s.latestVersion +
          (mode === "secret-rotate" && s.scope === "company" ? 1 : 0),
        s.scope,
        s.ownerUserId,
      ]),
    );
    const [resource] = await f.db
      .select()
      .from(connectionResources)
      .where(eq(connectionResources.connectionId, id));
    const [consent] = await f.db
      .select()
      .from(connectionGrants)
      .where(eq(connectionGrants.id, resource.consentId));
    if (mode === "reconnect") {
      expect(consent.status).toBe("needs_reauthorization");
      expect(consent.credentialSecretRefs).toEqual([]);
    }
  });

  it("pins KB discovery schemas and executes only owner-bound read tools", async () => {
    const b = await f.fixture();
    await f.db.insert(connectionProviderRegistrations).values({
      bindingId: b.id,
      appId: "patty-kb",
      clientId: "kb-client",
      audience: "https://mcp.kb.patty.io",
      redirectUri: "https://crew.example/api/connections/oauth/callback",
      qualified: true,
    });
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = {
      ...pair.publicKey.export({ format: "jwk" }),
      kid: "fixture",
      alg: "RS256",
    };
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const signing = `${encode({ alg: "RS256", kid: "fixture" })}.${encode({ iss: "https://login.patty.io/realms/internal", azp: "kb-client", aud: "https://mcp.kb.patty.io", sub: "kb-owner", scope: "mcp:tools", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    const token = `${signing}.${sign("RSA-SHA256", Buffer.from(signing), pair.privateKey).toString("base64url")}`;
    f.providerFetch = async (url) =>
      String(url).endsWith("/certs")
        ? Response.json({ keys: [jwk] })
        : Response.json({
            access_token: token,
            refresh_token: "kb-refresh",
            expires_in: 3600,
            scope: "mcp:tools",
          });
    await f.manage(b, "availability.set", {
      appId: "patty-kb",
      enabled: true,
      actions: ["read", "search"],
    });
    const created = await f.manage(b, "connection.create-personal", {
      appId: "patty-kb",
      displayName: "My KB",
    });
    const id = created.connections![0].connectionId;
    const started = await f.manage(b, "connection.authorize", {
      connectionId: id,
    });
    const cb = f.completion(
      b,
      new URL(started.authorizationUrl!).searchParams.get("state")!,
    );
    cb.callback = JSON.stringify({
      ...JSON.parse(cb.callback),
      iss: "https://login.patty.io/realms/internal",
    });
    (f.contexts.get(cb.token) as Record<string, unknown>).requestDigest =
      createHash("sha256").update(cb.callback).digest("hex");
    await f.service().complete(b.id, cb);
    await f.manage(b, "access.grant", {
      connectionId: id,
      agentPubkey: "c".repeat(64),
      actions: ["read", "search"],
    });
    const schemas = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        new URL("./fixtures/connection-kb-schemas.json", import.meta.url),
        "utf8",
      ),
    );
    let reads = 0;
    let changed = false;
    f.providerFetch = async (url, init) => {
      if (String(url).endsWith("/certs")) return Response.json({ keys: [jwk] });
      expect(String(url)).toBe("https://mcp.kb.patty.io/mcp");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${token}`,
      );
      const req = JSON.parse(String(init?.body));
      if (req.method === "initialize")
        return Response.json({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "KB", version: "fixture" },
          },
        });
      if (req.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (req.method === "tools/list")
        return Response.json({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            tools: Object.entries(schemas).map(([name, inputSchema]) => ({
              name,
              inputSchema: changed ? { type: "object" } : inputSchema,
              annotations: { readOnlyHint: true, destructiveHint: false },
            })),
          },
        });
      reads++;
      expect(req.params).toEqual({
        name: "get_page",
        arguments: { page_id: "page-owner", format: "markdown" },
      });
      return Response.json({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          content: [{ type: "text", text: "Useful owner-private KB page" }],
          isError: false,
        },
      });
    };
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const execute = () => {
      const e = f.execution(b, "connections_patty_kb_get_page", {
        page_id: "page-owner",
      });
      (f.contexts.get(e.token) as Record<string, unknown>).action =
        "patty-kb.read";
      return request(app)
        .post(`/api/connection-workspaces/${b.id}/execute`)
        .send(e);
    };
    expect((await execute()).body.content?.[0]?.text).toBe(
      "Useful owner-private KB page",
    );
    expect(reads).toBe(1);
    changed = true;
    expect((await execute()).status).toBe(403);
    expect(reads).toBe(1);
    changed = false;
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
          },
        },
      })
      .where(eq(toolConnections.id, id));
    const otherSigning = `${encode({ alg: "RS256", kid: "fixture" })}.${encode({ iss: "https://login.patty.io/realms/internal", azp: "kb-client", aud: "https://mcp.kb.patty.io", sub: "different-kb-owner", scope: "mcp:tools", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    const otherToken = `${otherSigning}.${sign("RSA-SHA256", Buffer.from(otherSigning), pair.privateKey).toString("base64url")}`;
    const previous = f.providerFetch;
    let refreshes = 0;
    f.providerFetch = async (url, init) =>
      String(url).endsWith("/token")
        ? (refreshes++,
          Response.json({
            access_token: otherToken,
            expires_in: 3600,
            scope: "mcp:tools",
          }))
        : previous(url, init);
    expect((await execute()).status).toBe(403);
    expect(refreshes).toBe(1);
    expect(reads).toBe(1);
    const [resource] = await f.db
      .select()
      .from(connectionResources)
      .where(eq(connectionResources.connectionId, id));
    const [consent] = await f.db
      .select()
      .from(connectionGrants)
      .where(eq(connectionGrants.id, resource.consentId));
    expect(consent.providerTenant?.externalId).toBe("kb-owner");
  });
});
