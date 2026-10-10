import { createHash } from "node:crypto";
import { and, eq, or, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { connectionMutations, type Db } from "@pilotai/db";
import { conflict } from "../errors.js";
import { ConnectionProviderFailure } from "./connection-execution-audit.js";
import { gmailMessage } from "./connection-gmail.js";
import type { ConnectionCredentialContext } from "./connection-credentials.js";

const messageId = z.string().regex(/^[a-fA-F0-9]{1,64}$/);
const draftId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const mailboxes = z
  .array(
    z
      .email()
      .max(254)
      .refine((v) => !/[\r\n\u0000]/.test(v)),
  )
  .max(20);
const fields = {
  operationId: z
    .uuid()
    .refine((v) => v !== "00000000-0000-0000-0000-000000000000"),
  to: mailboxes.min(1),
  cc: mailboxes.optional(),
  bcc: mailboxes.optional(),
  subject: z
    .string()
    .max(512)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
  body: z
    .string()
    .max(8192)
    .refine((v) => Buffer.byteLength(v) <= 8192 && !v.includes("\u0000")),
};
/** Plain-text draft inputs; sender, transport and arbitrary MIME headers are server-owned. */
export const gmailDraftArguments = z.object(fields).strict();
const read = z.object({ draftId }).strict();
const update = gmailDraftArguments
  .extend({ draftId, expectedMessageId: messageId })
  .strict();
const send = z.object({ draftId, expectedMessageId: messageId }).strict();
const list = z
  .object({
    query: z
      .string()
      .max(1024)
      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v))
      .optional(),
    maxResults: z.number().int().min(1).max(20).optional(),
    pageToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,512}$/)
      .optional(),
  })
  .strict();
/** Fixed writing choices remain separate from the irreversible send grant. */
export const gmailWriteTools = [
  {
    name: "connections_gmail_list_drafts",
    appId: "gmail",
    action: "gmail.write",
    grant: "write",
    gmailOperation: "list",
    schema: list,
    description:
      "Find existing Gmail drafts to revise or send. Optional query uses Gmail search syntax. Returns draft IDs; read the selected draft before proceeding.",
  },
  {
    name: "connections_gmail_create_draft",
    appId: "gmail",
    action: "gmail.write",
    grant: "write",
    gmailOperation: "create",
    schema: gmailDraftArguments,
    description:
      "Create a plain-text Gmail draft, without sending. Supply a fresh operationId UUID; reuse it only for an exact retry. Returns draftId and messageId.",
  },
  {
    name: "connections_gmail_read_draft",
    appId: "gmail",
    action: "gmail.write",
    grant: "write",
    gmailOperation: "read",
    schema: read,
    description:
      "Read a Gmail draft before revising or sending it. Returns its current messageId. Unsupported or truncated contents must not be silently overwritten.",
  },
  {
    name: "connections_gmail_update_draft",
    appId: "gmail",
    action: "gmail.write",
    grant: "write",
    gmailOperation: "update",
    schema: update,
    description:
      "Replace an existing plain-text draft with revised recipients, subject and body. expectedMessageId must match its latest version. Use a fresh operationId UUID for each revision; reuse only for an exact retry. Does not send.",
  },
  {
    name: "connections_gmail_send_draft",
    appId: "gmail",
    action: "gmail.send",
    grant: "send",
    gmailOperation: "send",
    schema: send,
    description:
      "Send the current Gmail draft immediately when the user requests sending. Use its latest messageId as expectedMessageId. No extra confirmation is required. Never recreate/resend mail after an uncertain result; check Sent mail first. Each draft is sent at most once by this broker.",
  },
] as const;
type Tool = (typeof gmailWriteTools)[number];
/** Safe closed failure code: a provider mutation may have completed, so replay is forbidden. */
export class GmailMutationUncertain extends ConnectionProviderFailure {
  constructor() {
    super("uncertain", 409);
  }
}
const draft = z.object({
  id: draftId,
  message: z.object({
    id: messageId,
    threadId: messageId,
    payload: z.unknown().optional(),
    raw: z
      .string()
      .regex(/^[A-Za-z0-9_-]+={0,2}$/)
      .max(48000)
      .optional(),
  }),
});
const sent = z.object({ id: messageId, threadId: messageId });

/** RFC 2047 subject and base64 UTF-8 body prevent header injection and preserve Korean. */
export function gmailMime(
  mail: z.infer<typeof gmailDraftArguments>,
  sender: string,
): string {
  const from = z.email().max(254).parse(sender);
  const subject = Array.from(
    mail.subject.matchAll(/[\s\S]{1,10}/gu),
    (m) => `=?UTF-8?B?${Buffer.from(m[0]).toString("base64")}?=`,
  ).join("\r\n ");
  const body =
    Buffer.from(mail.body.replace(/\r\n|\r|\n/g, "\r\n"))
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? "";
  return Buffer.from(
    [
      `From: ${from}`,
      `To: ${mail.to.join(",\r\n ")}`,
      ...(mail.cc?.length ? [`Cc: ${mail.cc.join(",\r\n ")}`] : []),
      ...(mail.bcc?.length ? [`Bcc: ${mail.bcc.join(",\r\n ")}`] : []),
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ].join("\r\n"),
  ).toString("base64url");
}
async function request(
  provider: typeof fetch,
  access: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  try {
    const response = await provider(
      `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        cache: "no-store",
      },
    );
    if (!response.ok || response.redirected)
      throw new ConnectionProviderFailure("provider_error");
    const text = await response.text();
    if (Buffer.byteLength(text) > 65536)
      throw new ConnectionProviderFailure("uncertain");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ConnectionProviderFailure) throw error;
    throw new ConnectionProviderFailure("uncertain");
  }
}
/** Durable claim before provider mutation; no SQL lock or automatic retry crosses HTTP. */
export async function gmailWrite(
  db: Db,
  identity: ConnectionCredentialContext,
  access: string,
  tool: Tool,
  raw: unknown,
  provider: typeof fetch,
  revalidate: () => Promise<unknown>,
) {
  const args = tool.schema.parse(raw);
  const id = "draftId" in args ? args.draftId : null;
  const operation = tool.gmailOperation;
  const key = "operationId" in args ? args.operationId : id;
  if (operation === "list") {
    const args = list.parse(raw),
      query = new URLSearchParams({
        maxResults: String(args.maxResults ?? 10),
      });
    if (args.query) query.set("q", args.query);
    if (args.pageToken) query.set("pageToken", args.pageToken);
    return z
      .object({
        drafts: z
          .array(
            z.object({
              id: draftId,
              message: z.object({ id: messageId, threadId: messageId }),
            }),
          )
          .max(20)
          .optional(),
        nextPageToken: z.string().max(512).optional(),
        resultSizeEstimate: z.number().int().nonnegative().optional(),
      })
      .parse(await request(provider, access, `/drafts?${query}`));
  }
  if (operation === "read") {
    const value = draft.parse(
      await request(provider, access, `/drafts/${id}?format=full`),
    );
    return {
      draftId: value.id,
      messageId: value.message.id,
      ...gmailMessage(value.message),
    };
  }
  if (!key) throw conflict("Gmail mutation operation identity is required");
  const digest = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex");
  const action =
    operation === "send" ? "gmail.send" : `gmail.draft.${operation}`;
  const { b, c, r } = identity;
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    // Serialize all revisions and sending for this draft (or create operation).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${r.connection.id + ":" + (id ?? key)}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(connectionMutations)
      .where(
        and(
          eq(connectionMutations.connectionId, r.connection.id),
          eq(connectionMutations.action, action),
          eq(connectionMutations.operationKey, key),
        ),
      );
    if (existing) {
      if (
        existing.digest !== digest ||
        existing.requesterAccountId !== c.requesterAccountId ||
        existing.agentPubkey !== c.agentPubkey ||
        existing.conversationId !== c.conversationId
      )
        throw conflict("Gmail operation intent changed");
      if (existing.state !== "succeeded" || !existing.result)
        throw new GmailMutationUncertain();
      return { replay: existing.result, id: existing.id };
    }
    if (id) {
      const blocked = await tx
        .select({ id: connectionMutations.id })
        .from(connectionMutations)
        .where(
          and(
            eq(connectionMutations.connectionId, r.connection.id),
            eq(connectionMutations.draftId, id),
            or(
              ne(connectionMutations.state, "succeeded"),
              eq(connectionMutations.action, "gmail.send"),
            ),
          ),
        )
        .limit(1);
      if (blocked.length)
        throw conflict(
          "Gmail draft has a pending, uncertain or completed send",
        );
    }
    const [row] = await tx
      .insert(connectionMutations)
      .values({
        bindingId: b.id,
        connectionId: r.connection.id,
        requesterAccountId: c.requesterAccountId,
        agentPubkey: c.agentPubkey,
        conversationId: c.conversationId,
        action,
        operationKey: key,
        digest,
        draftId: id,
      })
      .returning();
    return { id: row.id, replay: null };
  });
  if (claimed.replay) return claimed.replay;
  let dispatched = false;
  try {
    let threadId: string | undefined;
    let replyHeaders: string[] = [];
    let rawMessage: string | undefined;
    if (id) {
      const current = draft.parse(
        await request(
          provider,
          access,
          `/drafts/${id}?format=${operation === "send" ? "raw" : "full"}`,
        ),
      );
      if (
        !("expectedMessageId" in args) ||
        current.id !== id ||
        current.message.id !== args.expectedMessageId
      )
        throw conflict(
          "Gmail draft changed; read the latest version before proceeding",
        );
      if (operation === "send") {
        if (!current.message.raw)
          throw conflict("Gmail draft MIME contents are unavailable");
        rawMessage = current.message.raw;
        threadId = current.message.threadId;
      }
      // Updating an HTML/attachment draft would destroy data. Creation/revision is plain text only.
      if (
        operation === "update" &&
        (current.message.payload as { mimeType?: string })?.mimeType !==
          "text/plain"
      )
        throw conflict("Only plain-text Gmail drafts can be revised");
      if (operation === "update") {
        if (gmailMessage(current.message).bodyStatus !== "complete")
          throw conflict("Gmail draft contents cannot be safely revised");
        threadId = current.message.threadId;
        const headers =
          z
            .object({
              headers: z
                .array(
                  z.object({
                    name: z.string(),
                    value: z
                      .string()
                      .max(4096)
                      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
                  }),
                )
                .max(100)
                .optional(),
            })
            .parse(current.message.payload).headers ?? [];
        replyHeaders = headers
          .filter((h) =>
            ["in-reply-to", "references"].includes(h.name.toLowerCase()),
          )
          .map(
            (h) =>
              `${h.name.toLowerCase() === "references" ? "References" : "In-Reply-To"}: ${h.value}`,
          );
      }
    }
    if (operation !== "send") {
      // Sender is derived from the authenticated Google account, never from model input.
      const profile = z
        .object({ emailAddress: z.email().max(254) })
        .parse(await request(provider, access, "/profile"));
      rawMessage = gmailMime(
        gmailDraftArguments.parse(argsWithFields(args)),
        profile.emailAddress,
      );
      if (replyHeaders.length)
        rawMessage = Buffer.from(
          replyHeaders.join("\r\n") +
            "\r\n" +
            Buffer.from(rawMessage, "base64url").toString(),
        ).toString("base64url");
    }
    await revalidate();
    dispatched = true;
    const payload =
      operation === "send"
        ? await request(provider, access, "/drafts/send", "POST", {
            id,
            message: { raw: rawMessage, threadId },
          })
        : await request(
            provider,
            access,
            id ? `/drafts/${id}` : "/drafts",
            id ? "PUT" : "POST",
            { message: { raw: rawMessage, ...(threadId ? { threadId } : {}) } },
          );
    const value =
      operation === "send" ? sent.parse(payload) : draft.parse(payload);
    if (operation === "update" && "message" in value && value.id !== id)
      throw new GmailMutationUncertain();
    const result =
      "message" in value
        ? {
            draftId: value.id,
            messageId: value.message.id,
            threadId: value.message.threadId,
          }
        : { messageId: value.id, threadId: value.threadId, sent: true };
    await db
      .update(connectionMutations)
      .set({
        state: "succeeded",
        result,
        draftId: id ?? ("draftId" in result ? result.draftId : null),
      })
      .where(eq(connectionMutations.id, claimed.id));
    return result;
  } catch (error) {
    // Even provider errors stay closed: an interrupted mutation cannot be assumed absent.
    if (dispatched)
      await db
        .update(connectionMutations)
        .set({ state: "uncertain" })
        .where(eq(connectionMutations.id, claimed.id));
    else
      await db
        .delete(connectionMutations)
        .where(eq(connectionMutations.id, claimed.id));
    if (dispatched) throw new GmailMutationUncertain();
    throw error;
  }
}
function argsWithFields(args: Record<string, unknown>) {
  const { draftId: _draft, expectedMessageId: _version, ...mail } = args;
  return mail;
}
