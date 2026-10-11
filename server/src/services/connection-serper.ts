import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { connectionAvailability, type Db } from "@pilotai/db";
import { forbidden } from "../errors.js";
import { connectionAuthorityService } from "./connection-authority.js";
import { connectionDirectFetch } from "./connection-direct-tls.js";
import {
  auditConnectionExecution,
  ConnectionProviderFailure,
} from "./connection-execution-audit.js";
import { sharedConnectionCredential } from "./connection-shared-services.js";
import { secretService } from "./secrets.js";
import type { ConnectionWorkspaceOptions } from "./connection-workspaces.js";

const argumentsSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    maxResults: z.number().int().min(1).max(10).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    country: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
  })
  .strict();
/** Public web search is a workspace service, automatically available after administrator approval. */
export const serperTool = {
  name: "connections_web_search",
  action: "web-search.search",
  description:
    "Search the public web and return source titles, URLs and snippets. Use a concise public search query; never include secrets, private email contents or proprietary source code. Your workspace provides this service; no personal account connection is needed.",
  schema: argumentsSchema,
} as const;
const inputSchema = z
  .object({
    schema: z.enum([
      "crew.connections-catalog/v1",
      "crew.connections-prepare/v1",
      "crew.connections-execute/v1",
    ]),
    token: z.string().min(1).max(4096),
    tool: z.literal(serperTool.name),
    arguments: z.unknown().optional(),
  })
  .strict();
const endpoint = "https://google.serper.dev/search";
const denied = () => forbidden("Workspace web search is not authorized");
const resultSchema = z.object({
  organic: z
    .array(
      z.object({
        title: z.string().max(4096),
        link: z
          .string()
          .url()
          .max(2048)
          .refine((value) => {
            const url = new URL(value);
            return (
              ["https:", "http:"].includes(url.protocol) &&
              !url.username &&
              !url.password
            );
          }),
        snippet: z.string().max(8192).optional(),
      }),
    )
    .max(100),
});

async function boundedBody(response: Response) {
  if (!response.body) throw new ConnectionProviderFailure("provider_error");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 65536) throw new ConnectionProviderFailure("provider_error");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, total),
    );
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Execute only against the current workspace's approved company credential and trusted turn identity. */
export function serperConnectionService(
  db: Db,
  options: ConnectionWorkspaceOptions = {},
) {
  const authority = connectionAuthorityService(db, {
    fetch: options.authorityFetch,
  });
  const provider = options.providerFetch ?? connectionDirectFetch;
  async function identity(bindingId: string, token: string) {
    const { binding: b, context: c } =
      await authority.resolveConnectionAuthority({
        bindingId,
        token,
        purpose: "execution",
        action: serperTool.action,
      });
    if (
      c.schema !== "crew.connection-workspace-execution/v1" ||
      c.sourceMemberAccountIds.length !== 1 ||
      c.sourceMemberAccountIds[0] !== c.requesterAccountId
    )
      throw denied();
    return { b, c };
  }
  async function resolve(bindingId: string, token: string) {
    const current = await identity(bindingId, token);
    const [policy] = await db
      .select()
      .from(connectionAvailability)
      .where(
        and(
          eq(connectionAvailability.bindingId, current.b.id),
          eq(connectionAvailability.appId, "web-search"),
        ),
      );
    const secret = await sharedConnectionCredential(
      db,
      current.b,
      "web-search",
    );
    if (!policy?.enabled || !policy.actions.includes("search") || !secret)
      throw denied();
    return {
      ...current,
      policy,
      secretId: secret.id,
      version: secret.latestVersion,
    };
  }
  const fingerprint = (value: Awaited<ReturnType<typeof resolve>>) =>
    JSON.stringify(value);
  async function handle(
    bindingId: string,
    raw: unknown,
    operation: "catalog" | "prepare" | "execute",
  ) {
    const input = inputSchema.parse(raw);
    if (
      input.schema !== `crew.connections-${operation}/v1` ||
      (operation === "catalog" && Object.hasOwn(input, "arguments"))
    )
      throw denied();
    if (operation === "catalog") {
      await resolve(bindingId, input.token);
      return {
        schema: "crew.connections-catalog-result/v1",
        tool: {
          name: serperTool.name,
          description: serperTool.description,
          inputSchema: z.toJSONSchema(argumentsSchema),
        },
      };
    }
    const actor = await identity(bindingId, input.token);
    return auditConnectionExecution(
      db,
      actor,
      serperTool.action,
      operation,
      async (phase) => {
        const args = argumentsSchema.parse(input.arguments);
        const before = await resolve(bindingId, input.token);
        if (operation === "prepare")
          return {
            schema: "crew.connections-prepared/v1",
            tool: serperTool.name,
          };
        await phase("credentials");
        const key = await secretService(db).resolveSecretValue(
          before.b.companyId,
          before.secretId,
          before.version,
          {
            accessContext: {
              consumerType: "system",
              consumerId: `crew-web-search:${before.b.id}`,
              actorType: "user",
              actorId: before.c.requesterAccountId,
              responsibleUserId: before.c.requesterAccountId,
            },
          },
        );
        if (
          !key ||
          /[\r\n\u0000]/.test(key) ||
          key.length > 4096 ||
          fingerprint(await resolve(bindingId, input.token)) !==
            fingerprint(before)
        )
          throw denied();
        await phase("provider");
        let payload: unknown;
        try {
          const response = await provider(endpoint, {
            method: "POST",
            redirect: "error",
            cache: "no-store",
            signal: AbortSignal.timeout(4000),
            headers: { "content-type": "application/json", "X-API-KEY": key },
            body: JSON.stringify({
              q: args.query,
              num: args.maxResults ?? 10,
              ...(args.language ? { hl: args.language } : {}),
              ...(args.country ? { gl: args.country } : {}),
            }),
          });
          if (
            !response.ok ||
            response.redirected ||
            (response.url && response.url !== endpoint)
          )
            throw new ConnectionProviderFailure("provider_error");
          payload = JSON.parse(await boundedBody(response));
        } catch (error) {
          if (error instanceof ConnectionProviderFailure) throw error;
          throw new ConnectionProviderFailure("provider_error");
        }
        await phase("result");
        if (
          fingerprint(await resolve(bindingId, input.token)) !==
          fingerprint(before)
        )
          throw denied();
        const publicResults = resultSchema.parse(payload).organic;
        const redact = (value: string) => value.replaceAll(key, "[redacted]");
        const results = publicResults
          .slice(0, args.maxResults ?? 10)
          .map((row) => ({
            title: redact(row.title).slice(0, 300),
            url: redact(row.link),
            snippet: redact(row.snippet ?? "").slice(0, 1800),
          }));
        // Match Crew's text-result byte ceiling, including multibyte snippets and JSON escapes.
        let text = JSON.stringify({ results });
        while (Buffer.byteLength(text, "utf8") > 32768 && results.length > 0) {
          results.pop();
          text = JSON.stringify({ results });
        }
        return {
          schema: "crew.connections-execution-result/v1",
          content: [{ type: "text", text }],
          isError: false,
        };
      },
    );
  }
  return {
    catalog: (bindingId: string, raw: unknown) =>
      handle(bindingId, raw, "catalog"),
    prepare: (bindingId: string, raw: unknown) =>
      handle(bindingId, raw, "prepare"),
    execute: (bindingId: string, raw: unknown) =>
      handle(bindingId, raw, "execute"),
  };
}
