import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  companySecrets,
  companySecretVersions,
  connectionAgentAccess,
  connectionResources,
  secretAccessEvents,
  toolAccessAuditEvents,
} from "@pilotai/db";
import { connectionExecutionService } from "../services/connection-execution.js";
import { secretService } from "../services/secrets.js";
import { connectionExecutionFixture } from "./helpers/connection-execution-fixture.js";

describe("Crew administrator-enabled workspace web search", () => {
  const f = connectionExecutionFixture();
  const key = "synthetic-serper-company-key";
  const service = () =>
    connectionExecutionService(f.db, {
      authorityFetch: f.authorityFetch,
      providerFetch: f.resourceFetch,
    });
  async function workspace(enabled = true) {
    const b = await f.fixture();
    const secret = await secretService(f.db).create(b.companyId, {
      name: "Crew web search",
      key: "CREW_SERPER_API_KEY",
      provider: "local_encrypted",
      value: key,
    });
    expect(
      (
        await f.manage(b, "availability.set", {
          appId: "web-search",
          enabled,
          actions: ["search"],
        })
      ).outcome,
    ).toBe("complete");
    return { b, secret };
  }
  function execution(
    b: Awaited<ReturnType<typeof f.fixture>>,
    args: unknown = { query: "public documentation" },
    actor = "member",
  ) {
    const input = f.execution(b, "connections_web_search", args);
    const context = f.contexts.get(input.token) as Record<string, unknown>;
    context.schema = "crew.connection-workspace-execution/v1";
    context.action = "web-search.search";
    context.requesterAccountId = actor;
    context.requesterPubkey = "b".repeat(64);
    context.sourceMemberAccountIds = [actor];
    delete context.audienceAccountIds;
    return input;
  }
  it("is disabled by default, requires server credentials, and only administrators can enable it", async () => {
    const b = await f.fixture();
    expect(
      (await f.manage(b, "catalog.get", {})).apps?.find(
        (app) => app.appId === "web-search",
      ),
    ).toMatchObject({
      enabled: false,
      actions: ["search"],
      outcome: "requires-setup",
    });
    expect(
      (
        await f.manage(b, "availability.set", {
          appId: "web-search",
          enabled: true,
          actions: ["search"],
        })
      ).outcome,
    ).toBe("requires-setup");
    const ready = await workspace(false);
    expect(
      (
        await f.manage(
          ready.b,
          "availability.set",
          { appId: "web-search", enabled: true, actions: ["search"] },
          "member",
          "member",
        )
      ).outcome,
    ).toBe("denied");
    expect(
      (
        await f.manage(ready.b, "availability.set", {
          appId: "web-search",
          enabled: true,
          actions: ["write"],
        })
      ).outcome,
    ).toBe("denied");
    const { arguments: _args, ...catalog } = execution(ready.b);
    await expect(
      service().catalog(ready.b.id, {
        ...catalog,
        schema: "crew.connections-catalog/v1",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("automatically serves a member without any personal connection, consent or agent grant", async () => {
    const { b, secret } = await workspace();
    let calls = 0;
    f.providerFetch = async (url, init) => {
      calls++;
      expect(String(url)).toBe("https://google.serper.dev/search");
      expect(new Headers(init?.headers).get("X-API-KEY")).toBe(key);
      expect(JSON.parse(String(init?.body))).toEqual({
        q: "public documentation",
        num: 3,
        hl: "ko",
        gl: "kr",
      });
      return Response.json({
        organic: [
          {
            title: "Source",
            link: "https://example.com/docs",
            snippet: "Public result",
          },
        ],
        privateField: key,
      });
    };
    const input = execution(b, {
      query: "public documentation",
      maxResults: 3,
      language: "ko",
      country: "kr",
    });
    const { arguments: _args, ...catalog } = input;
    expect(
      await service().catalog(b.id, {
        ...catalog,
        schema: "crew.connections-catalog/v1",
      }),
    ).toMatchObject({ tool: { name: "connections_web_search" } });
    expect(
      await service().prepare(b.id, {
        ...input,
        schema: "crew.connections-prepare/v1",
      }),
    ).toEqual({ schema: "crew.connections-prepared/v1", tool: input.tool });
    expect(calls).toBe(0);
    const result = await service().execute(b.id, input);
    expect(result).toMatchObject({ isError: false });
    expect(JSON.stringify(result)).toContain("https://example.com/docs");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(calls).toBe(1);
    expect(await f.db.select().from(connectionResources)).toHaveLength(0);
    expect(await f.db.select().from(connectionAgentAccess)).toHaveLength(0);
    expect(
      (
        await f.manage(
          b,
          "connection.create-personal",
          { appId: "web-search", displayName: "My search" },
          "member",
          "member",
        )
      ).outcome,
    ).toBe("denied");
    const audit = await f.db
      .select()
      .from(toolAccessAuditEvents)
      .where(eq(toolAccessAuditEvents.companyId, b.companyId));
    expect(audit.find((row) => row.outcome === "success")).toMatchObject({
      actorId: "member",
      action: "web-search.search",
      details: { agentPubkey: "c".repeat(64), workspaceId: b.workspaceId },
    });
    expect(JSON.stringify(audit)).not.toContain(key);
    expect(JSON.stringify(audit)).not.toContain("public documentation");
    expect(
      await f.db
        .select()
        .from(secretAccessEvents)
        .where(eq(secretAccessEvents.secretId, secret.id)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "member",
          responsibleUserId: "member",
        }),
      ]),
    );
  });
  it("hides the tool and blocks a previously issued turn after administrator disable", async () => {
    const { b } = await workspace();
    const input = execution(b);
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      return Response.json({ organic: [] });
    };
    await f.manage(b, "availability.set", {
      appId: "web-search",
      enabled: false,
      actions: ["search"],
    });
    const { arguments: _args, ...catalog } = input;
    await expect(
      service().catalog(b.id, {
        ...catalog,
        schema: "crew.connections-catalog/v1",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service().execute(b.id, input)).rejects.toMatchObject({
      status: 403,
    });
    expect(calls).toBe(0);
  });
  it("rejects cross-workspace authority, personal capabilities and joined requester substitution", async () => {
    const first = await workspace(),
      second = await workspace();
    await expect(
      service().execute(second.b.id, execution(first.b)),
    ).rejects.toMatchObject({ status: 403 });
    const personal = f.execution(first.b, "connections_web_search");
    (f.contexts.get(personal.token) as Record<string, unknown>).action =
      "web-search.search";
    await expect(service().execute(first.b.id, personal)).rejects.toMatchObject(
      { status: 403 },
    );
    const joined = execution(first.b);
    (
      f.contexts.get(joined.token) as Record<string, unknown>
    ).sourceMemberAccountIds = ["member", "another"];
    await expect(service().execute(first.b.id, joined)).rejects.toMatchObject({
      status: 403,
    });
    const expired = execution(first.b);
    (f.contexts.get(expired.token) as Record<string, unknown>).expiresAt =
      Math.floor(Date.now() / 1000) - 1;
    await expect(service().execute(first.b.id, expired)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("rejects caller credentials, arbitrary endpoints and unbounded or empty input before provider I/O", async () => {
    const { b } = await workspace();
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      return Response.json({ organic: [] });
    };
    for (const args of [
      { query: " " },
      { query: "ok", apiKey: "member-key" },
      { query: "ok", url: "https://evil.example" },
      { query: "ok", maxResults: 100 },
      { query: "x".repeat(1025) },
      { query: "hello\nsecret" },
    ]) {
      await expect(
        service().prepare(b.id, {
          ...execution(b, args),
          schema: "crew.connections-prepare/v1",
        }),
      ).rejects.toBeDefined();
    }
    expect(calls).toBe(0);
  });
  it("withholds an in-flight result when the administrator disables the service", async () => {
    const { b } = await workspace();
    f.providerFetch = async () => {
      await f.manage(b, "availability.set", {
        appId: "web-search",
        enabled: false,
        actions: ["search"],
      });
      return Response.json({
        organic: [{ title: "Result", link: "https://example.com" }],
      });
    };
    await expect(service().execute(b.id, execution(b))).rejects.toMatchObject({
      status: 403,
    });
    const rows = await f.db
      .select()
      .from(toolAccessAuditEvents)
      .where(eq(toolAccessAuditEvents.companyId, b.companyId));
    expect(rows.some((row) => row.outcome === "success")).toBe(false);
  });
  it("does not resurrect an in-flight search after a disable and re-enable", async () => {
    const { b } = await workspace();
    f.providerFetch = async () => {
      await f.manage(b, "availability.set", {
        appId: "web-search",
        enabled: false,
        actions: ["search"],
      });
      await f.manage(b, "availability.set", {
        appId: "web-search",
        enabled: true,
        actions: ["search"],
      });
      return Response.json({
        organic: [{ title: "Old request", link: "https://example.com" }],
      });
    };
    await expect(service().execute(b.id, execution(b))).rejects.toMatchObject({
      status: 403,
    });
    f.providerFetch = async () => Response.json({ organic: [] });
    expect(await service().execute(b.id, execution(b))).toMatchObject({
      isError: false,
    });
  });
  it("denies inactive credentials and never falls back to a process environment key", async () => {
    const { b, secret } = await workspace();
    await f.db
      .update(companySecrets)
      .set({ status: "disabled" })
      .where(eq(companySecrets.id, secret.id));
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      return Response.json({ organic: [] });
    };
    await expect(service().execute(b.id, execution(b))).rejects.toMatchObject({
      status: 403,
    });
    expect(calls).toBe(0);
    expect(
      (await f.manage(b, "catalog.get", {})).apps?.find(
        (app) => app.appId === "web-search",
      )?.outcome,
    ).toBe("requires-setup");
  });
  it("does not let another workspace use the company credential without its own administrator approval", async () => {
    const { b } = await workspace();
    const { connectionWorkspaceBindings } = await import("@pilotai/db");
    const [other] = await f.db
      .insert(connectionWorkspaceBindings)
      .values({
        companyId: b.companyId,
        accountsOrganizationId: b.accountsOrganizationId,
        workspaceId: crypto.randomUUID(),
        communityId: crypto.randomUUID(),
        authorityUrl: b.authorityUrl,
        enabled: true,
      })
      .returning();
    expect(
      (await f.manage(other, "catalog.get", {})).apps?.find(
        (app) => app.appId === "web-search",
      ),
    ).toMatchObject({ outcome: "ready", enabled: false });
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      return Response.json({ organic: [] });
    };
    await expect(
      service().execute(other.id, execution(other)),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(0);
  });
  it("withholds results after credential version revocation and marks the service unavailable", async () => {
    const { b, secret } = await workspace();
    f.providerFetch = async () => {
      await f.db
        .update(companySecretVersions)
        .set({ revokedAt: new Date() })
        .where(eq(companySecretVersions.secretId, secret.id));
      return Response.json({
        organic: [{ title: "Result", link: "https://example.com" }],
      });
    };
    await expect(service().execute(b.id, execution(b))).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (await f.manage(b, "catalog.get", {})).apps?.find(
        (app) => app.appId === "web-search",
      )?.outcome,
    ).toBe("requires-setup");
    expect(
      (
        await f.manage(b, "availability.set", {
          appId: "web-search",
          enabled: false,
          actions: ["search"],
        })
      ).outcome,
    ).toBe("complete");
  });
  it("withholds a result across credential rotation and resolves the new version on the next request", async () => {
    const { b, secret } = await workspace();
    const replacement = "synthetic-rotated-company-key";
    f.providerFetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("X-API-KEY")).toBe(key);
      await secretService(f.db).rotate(secret.id, {
        value: replacement,
        expectedLatestVersion: 1,
      });
      return Response.json({ organic: [] });
    };
    await expect(service().execute(b.id, execution(b))).rejects.toMatchObject({
      status: 403,
    });
    f.providerFetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("X-API-KEY")).toBe(replacement);
      return Response.json({ organic: [] });
    };
    expect(await service().execute(b.id, execution(b))).toMatchObject({
      isError: false,
    });
  });
  it("bounds and redacts provider output, including errors and oversized responses", async () => {
    const { b } = await workspace();
    f.providerFetch = async () =>
      Response.json({
        organic: [{ title: key, link: "https://example.com", snippet: key }],
      });
    expect(
      JSON.stringify(await service().execute(b.id, execution(b))),
    ).not.toContain(key);
    for (const response of [
      Response.json({ error: key }),
      Response.json({ error: key }, { status: 401 }),
      Response.json({ error: key }, { status: 429 }),
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example" },
      }),
      new Response("x".repeat(65537)),
      Response.json({
        organic: [{ title: "Bad", link: "javascript:alert(1)" }],
      }),
    ]) {
      f.providerFetch = async () => response;
      try {
        await service().execute(b.id, execution(b));
        throw new Error("expected rejection");
      } catch (error) {
        expect(String(error)).not.toContain(key);
        expect(String(error)).not.toContain("expected rejection");
      }
    }
  });
  it("keeps multibyte public results inside Crew's 32 KiB text ceiling", async () => {
    const { b } = await workspace();
    f.providerFetch = async () =>
      Response.json({
        organic: Array.from({ length: 8 }, (_, i) => ({
          title: "한".repeat(300),
          link: `https://example.com/source/${i}`,
          snippet: "글".repeat(1800),
        })),
      });
    const result = await service().execute(b.id, execution(b));
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(32768);
    expect(JSON.parse(text).results.length).toBeGreaterThan(0);
    expect(JSON.parse(text).results.length).toBeLessThan(8);
  });
});
