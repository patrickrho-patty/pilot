import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  connectionAgentAccess,
  connectionMutations,
  connectionGrants,
  toolAccessAuditEvents,
} from "@pilotai/db";
import { connectionWorkspaceRoutes } from "../routes/connection-workspaces.js";
import { connectionExecutionFixture } from "./helpers/connection-execution-fixture.js";

describe("owner Gmail drafting, revision and immediate send", () => {
  const f = connectionExecutionFixture();
  const mail = () => ({
    operationId: randomUUID(),
    to: ["recipient@example.com"],
    subject: "회의 안내",
    body: "개인 이메일 본문 sentinel",
  });
  const current = (id = "a123") => ({
    id: "r-draft_123",
    message: {
      id,
      threadId: "b123",
      raw: Buffer.from(
        "From: owner@example.com\r\nTo: recipient@example.com\r\n\r\nPrivate draft body",
      ).toString("base64url"),
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "To", value: "recipient@example.com" }],
        body: { data: Buffer.from("Private draft body").toString("base64url") },
      },
    },
  });
  async function fixture(actions = ["read", "search", "write", "send"]) {
    const { b, id } = await f.connected(actions);
    const app = express();
    app.use(
      "/api/connection-workspaces",
      connectionWorkspaceRoutes(f.db, {
        authorityFetch: f.authorityFetch,
        providerFetch: f.resourceFetch,
      }),
    );
    const context = {
      channelId: randomUUID(),
      conversationId: randomUUID(),
      enrollmentId: randomUUID(),
    };
    const call = (tool: string, args: unknown) => {
      const e = f.execution(b, tool, args);
      Object.assign(f.contexts.get(e.token) as object, context);
      return request(app)
        .post(`/api/connection-workspaces/${b.id}/execute`)
        .send(e);
    };
    const catalog = (tool: string) => {
      const e = f.execution(b, tool, {});
      Object.assign(f.contexts.get(e.token) as object, context);
      return request(app)
        .post(`/api/connection-workspaces/${b.id}/catalog`)
        .send({ schema: "crew.connections-catalog/v1", token: e.token, tool });
    };
    return { b, id, call, catalog };
  }
  it("discovers strict draft and send schemas only with current owner grants, without provider writes", async () => {
    const { catalog } = await fixture();
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      throw new Error("catalog must not invoke Google");
    };
    for (const name of [
      "list_drafts",
      "create_draft",
      "read_draft",
      "update_draft",
      "send_draft",
    ]) {
      const response = await catalog(`connections_gmail_${name}`);
      expect(response.status).toBe(200);
      expect(response.body.tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      if (name === "send_draft")
        expect(response.body.tool.inputSchema.required).toEqual([
          "draftId",
          "expectedMessageId",
        ]);
    }
    const readOnly = await fixture(["read", "search"]);
    expect(
      (await readOnly.catalog("connections_gmail_send_draft")).status,
    ).toBe(403);
    expect(calls).toBe(0);
  });
  it("creates, reads, revises and sends the exact latest owner draft; receipts and audit contain no content", async () => {
    const { b, call } = await fixture();
    const requests: { url: string; method: string; body: unknown }[] = [];
    let version = "a123";
    f.providerFetch = async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer owner-access",
      );
      const method = init?.method ?? "GET",
        body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: String(url), method, body });
      if (String(url).endsWith("/profile"))
        return Response.json({ emailAddress: "owner@example.com" });
      if (method === "GET") return Response.json(current(version));
      if (String(url).endsWith("/send"))
        return Response.json({ id: "c123", threadId: "b123" });
      if (method === "PUT") version = "a124";
      expect(Buffer.from(body.message.raw, "base64url").toString()).toContain(
        "To: recipient@example.com",
      );
      return Response.json(current(version));
    };
    const created = await call("connections_gmail_create_draft", mail());
    expect(created.status).toBe(200);
    expect(JSON.parse(created.body.content[0].text)).toEqual({
      draftId: "r-draft_123",
      messageId: "a123",
      threadId: "b123",
    });
    const read = await call("connections_gmail_read_draft", {
      draftId: "r-draft_123",
    });
    expect(JSON.parse(read.body.content[0].text)).toMatchObject({
      text: "Private draft body",
      messageId: "a123",
    });
    const revision = {
      ...mail(),
      body: "수정한 이메일 본문",
      draftId: "r-draft_123",
      expectedMessageId: "a123",
    };
    expect(
      (await call("connections_gmail_update_draft", revision)).status,
    ).toBe(200);
    const send = { draftId: "r-draft_123", expectedMessageId: "a124" };
    const response = await call("connections_gmail_send_draft", send);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.content[0].text)).toEqual({
      messageId: "c123",
      threadId: "b123",
      sent: true,
    });
    expect(
      JSON.parse(
        (await call("connections_gmail_send_draft", send)).body.content[0].text,
      ),
    ).toEqual(JSON.parse(response.body.content[0].text));
    expect(requests.filter((r) => r.url.endsWith("/send"))).toEqual([
      {
        url: "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send",
        method: "POST",
        body: {
          id: "r-draft_123",
          message: { raw: current().message.raw, threadId: "b123" },
        },
      },
    ]);
    expect(
      (
        await call("connections_gmail_update_draft", {
          ...revision,
          operationId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    const logs = [
      await f.db
        .select()
        .from(connectionMutations)
        .where(eq(connectionMutations.bindingId, b.id)),
      await f.db
        .select()
        .from(toolAccessAuditEvents)
        .where(eq(toolAccessAuditEvents.companyId, b.companyId)),
    ];
    for (const value of [
      "recipient@example.com",
      "이메일 본문",
      "Private draft body",
      "owner-access",
    ])
      expect(JSON.stringify(logs)).not.toContain(value);
  });
  it("finds existing drafts with bounded search and pagination in the owner's mailbox", async () => {
    const { call } = await fixture();
    f.providerFetch = async (url, init) => {
      const parsed = new URL(String(url));
      expect(parsed.origin + parsed.pathname).toBe(
        "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      );
      expect(parsed.searchParams.get("q")).toBe("to:recipient@example.com");
      expect(parsed.searchParams.get("pageToken")).toBe("next_123");
      expect(parsed.searchParams.get("maxResults")).toBe("5");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer owner-access",
      );
      return Response.json({
        drafts: [
          { id: "r-draft_123", message: { id: "a123", threadId: "b123" } },
        ],
        nextPageToken: "next_124",
      });
    };
    const result = await call("connections_gmail_list_drafts", {
      query: "to:recipient@example.com",
      maxResults: 5,
      pageToken: "next_123",
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body.content[0].text)).toMatchObject({
      drafts: [{ id: "r-draft_123" }],
      nextPageToken: "next_124",
    });
  });
  it("replays draft creation once and refuses reuse for changed recipients or content", async () => {
    const { call } = await fixture();
    let writes = 0;
    f.providerFetch = async (url, init) => {
      if (String(url).endsWith("/profile"))
        return Response.json({ emailAddress: "owner@example.com" });
      if (init?.method === "POST") writes++;
      return Response.json(current());
    };
    const args = mail();
    expect((await call("connections_gmail_create_draft", args)).status).toBe(
      200,
    );
    expect((await call("connections_gmail_create_draft", args)).status).toBe(
      200,
    );
    expect(
      (
        await call("connections_gmail_create_draft", {
          ...args,
          to: ["different@example.com"],
        })
      ).status,
    ).toBe(409);
    expect(writes).toBe(1);
  });
  it("does not discard HTML or attachments while revising an existing draft", async () => {
    const { call } = await fixture();
    let writes = 0;
    f.providerFetch = async (_url, init) => {
      if (init?.method === "PUT") writes++;
      const value = current();
      value.message.payload.mimeType = "multipart/mixed";
      return Response.json(value);
    };
    expect(
      (
        await call("connections_gmail_update_draft", {
          ...mail(),
          draftId: "r-draft_123",
          expectedMessageId: "a123",
        })
      ).status,
    ).toBe(409);
    expect(writes).toBe(0);
  });
  it("does not silently expand read-only OAuth when workspace and agent policy add writing", async () => {
    const { b, id, call } = await fixture(["read", "search"]);
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      return Response.json(current());
    };
    await f.manage(b, "availability.set", {
      appId: "gmail",
      enabled: true,
      actions: ["read", "search", "write", "send"],
    });
    await f.db
      .update(connectionAgentAccess)
      .set({ actions: ["write", "send"] })
      .where(eq(connectionAgentAccess.connectionId, id));
    expect((await call("connections_gmail_create_draft", mail())).status).toBe(
      403,
    );
    expect(calls).toBe(0);
    const started = await f.manage(b, "connection.authorize", {
      connectionId: id,
    });
    expect(
      new URL(started.authorizationUrl!).searchParams.get("scope")?.split(" "),
    ).toContain("https://www.googleapis.com/auth/gmail.compose");
    f.providerFetch = async () =>
      Response.json({
        access_token: "partial",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      });
    const completion = f.completion(
      b,
      new URL(started.authorizationUrl!).searchParams.get("state")!,
    );
    await expect(f.service().complete(b.id, completion)).rejects.toMatchObject({
      status: 403,
    });
    const [consent] = await f.db
      .select()
      .from(connectionGrants)
      .where(eq(connectionGrants.connectionId, id));
    expect(consent.status).toBe("needs_reauthorization");
  });
  it("writing cannot send, and KB cannot be assigned write or send actions", async () => {
    const { b, call } = await fixture(["read", "search", "write"]);
    let calls = 0;
    f.providerFetch = async () => {
      calls++;
      return Response.json(current());
    };
    expect(
      (
        await call("connections_gmail_send_draft", {
          draftId: "r-draft_123",
          expectedMessageId: "a123",
        })
      ).status,
    ).toBe(403);
    expect(calls).toBe(0);
    expect(
      (
        await f.manage(b, "availability.set", {
          appId: "patty-kb",
          enabled: true,
          actions: ["write"],
        })
      ).outcome,
    ).toBe("denied");
    expect(
      (
        await f.manage(b, "access.request", {
          appId: "patty-kb",
          agentPubkey: "c".repeat(64),
          actions: ["send"],
        })
      ).outcome,
    ).toBe("denied");
  });
  it("refuses a stale draft version before sending and allows a fresh version afterward", async () => {
    const { call } = await fixture();
    let sends = 0;
    f.providerFetch = async (_url, init) =>
      init?.method === "POST"
        ? (sends++, Response.json({ id: "c123", threadId: "b123" }))
        : Response.json(current("a124"));
    expect(
      (
        await call("connections_gmail_send_draft", {
          draftId: "r-draft_123",
          expectedMessageId: "a123",
        })
      ).status,
    ).toBe(409);
    expect(sends).toBe(0);
    expect(
      (
        await call("connections_gmail_send_draft", {
          draftId: "r-draft_123",
          expectedMessageId: "a124",
        })
      ).status,
    ).toBe(200);
    expect(sends).toBe(1);
  });
  it("serializes competing sends and durably refuses replay after an unknown provider outcome", async () => {
    const { b, call } = await fixture();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    let sends = 0;
    f.providerFetch = async (_url, init) => {
      if (init?.method !== "POST") return Response.json(current());
      sends++;
      enter();
      await gate;
      throw new Error("lost response after provider may have sent");
    };
    const args = { draftId: "r-draft_123", expectedMessageId: "a123" };
    const first = call("connections_gmail_send_draft", args).then((r) => r);
    await entered;
    expect((await call("connections_gmail_send_draft", args)).status).toBe(409);
    release();
    expect((await first).body.code).toBe("gmail_mutation_uncertain");
    // A newly constructed service/request after interruption still consults durable storage.
    expect((await call("connections_gmail_send_draft", args)).status).toBe(409);
    expect(sends).toBe(1);
    expect(
      (
        await f.db
          .select()
          .from(connectionMutations)
          .where(eq(connectionMutations.bindingId, b.id))
      )[0].state,
    ).toBe("uncertain");
  });
  it("revalidates owner permission after the draft read and before provider send", async () => {
    const { b, id, call } = await fixture();
    let sends = 0;
    f.providerFetch = async (_url, init) => {
      if (init?.method === "POST") {
        sends++;
        return Response.json({ id: "c123", threadId: "b123" });
      }
      await f.db
        .update(connectionAgentAccess)
        .set({ revoked: true })
        .where(
          and(
            eq(connectionAgentAccess.bindingId, b.id),
            eq(connectionAgentAccess.connectionId, id),
          ),
        );
      return Response.json(current());
    };
    expect(
      (
        await call("connections_gmail_send_draft", {
          draftId: "r-draft_123",
          expectedMessageId: "a123",
        })
      ).status,
    ).toBe(403);
    expect(sends).toBe(0);
  });
});
