import { z } from "zod";
import { forbidden } from "../errors.js";
import { kbSchemas } from "./connection-kb-schemas.js";
import { verifyConnectionKbIdentity } from "./connection-registry.js";
import type { ConnectionCredentialContext } from "./connection-credentials.js";
const bounded = z
  .string()
  .min(1)
  .max(1000)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
/** The initial KB surface has no writes, arbitrary exports, downloads or attachments. */
export const kbTools = [
  {
    name: "connections_patty_kb_search_pages",
    upstream: "search_pages",
    appId: "patty-kb",
    action: "patty-kb.search",
    grant: "search",
    description: "Search pages allowed by your KB account",
    schema: z
      .object({
        query: bounded,
        space_id: bounded.optional(),
        limit: z.number().int().min(1).max(20).optional(),
        offset: z.number().int().min(0).max(1000).optional(),
      })
      .strict(),
    inputSchema: kbSchemas.search_pages,
  },
  {
    name: "connections_patty_kb_get_page",
    upstream: "get_page",
    appId: "patty-kb",
    action: "patty-kb.read",
    grant: "read",
    description: "Read a page allowed by your KB account",
    schema: z
      .object({ page_id: bounded, format: z.literal("markdown").optional() })
      .strict(),
    inputSchema: kbSchemas.get_page,
  },
  {
    name: "connections_patty_kb_semantic_search",
    upstream: "semantic_search",
    appId: "patty-kb",
    action: "patty-kb.search",
    grant: "search",
    description: "Find passages allowed by your KB account",
    schema: z
      .object({
        query: bounded,
        space: bounded.optional(),
        under: bounded.optional(),
        created_after: bounded.optional(),
        created_before: bounded.optional(),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    inputSchema: kbSchemas.semantic_search,
  },
] as const;
const denied = () => forbidden("Connection resource denied");
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Verify current subject and the actual MCP catalog before one bounded read. */
export async function kbRead(
  s: ConnectionCredentialContext,
  access: string,
  tool: (typeof kbTools)[number],
  args: unknown,
  provider: typeof fetch,
  catalogOnly = false,
) {
  const identity = await verifyConnectionKbIdentity(
    access,
    s.r.registration,
    provider,
  );
  if (
    identity.issuer !== s.r.consent.providerTenant?.name ||
    identity.subject !== s.r.consent.providerTenant?.externalId
  )
    throw denied();
  let id = 0;
  let session: string | null = null;
  async function rpc(method: string, params?: unknown, notification = false) {
    const requestId = ++id;
    const headers: Record<string, string> = {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2024-11-05",
    };
    if (session) headers["mcp-session-id"] = session;
    const response = await provider("https://mcp.kb.patty.io/mcp", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(notification ? {} : { id: requestId }),
        method,
        ...(params === undefined ? {} : { params }),
      }),
    });
    if (!response.ok || response.redirected) throw denied();
    const next = response.headers.get("mcp-session-id");
    if (next) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(next) || (session && session !== next))
        throw denied();
      session = next;
    }
    if (notification) return undefined;
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 65536) throw denied();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw denied();
    }
    const envelope = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.literal(requestId),
        result: z.unknown(),
      })
      .strict()
      .parse(parsed);
    return envelope.result;
  }
  const init = z
    .object({
      protocolVersion: z.literal("2024-11-05"),
      capabilities: z.object({ tools: z.object({}).passthrough() }),
      serverInfo: z.object({
        name: z.string().max(256),
        version: z.string().max(128),
      }),
    })
    .parse(
      await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "Crew Connections", version: "1" },
      }),
    );
  if (!init.capabilities.tools) throw denied();
  await rpc("notifications/initialized", undefined, true);
  const list = z
    .object({
      tools: z
        .array(
          z
            .object({
              name: z.string().max(128),
              inputSchema: z.unknown(),
              annotations: z
                .object({
                  readOnlyHint: z.boolean().optional(),
                  destructiveHint: z.boolean().optional(),
                })
                .optional(),
            })
            .passthrough(),
        )
        .max(100),
    })
    .strict()
    .parse(await rpc("tools/list"));
  const selected = list.tools.filter((t) => t.name === tool.upstream);
  if (
    selected.length !== 1 ||
    selected[0].annotations?.readOnlyHint !== true ||
    selected[0].annotations?.destructiveHint === true ||
    stable(selected[0].inputSchema) !== stable(kbSchemas[tool.upstream])
  )
    throw denied();
  if (catalogOnly) return [];
  const arguments_ = tool.schema.parse(args);
  const result = z
    .object({
      content: z
        .array(
          z
            .object({ type: z.literal("text"), text: z.string().max(32768) })
            .strict(),
        )
        .min(1)
        .max(16),
      isError: z.boolean().optional(),
    })
    .strict()
    .parse(
      await rpc("tools/call", {
        name: tool.upstream,
        arguments:
          tool.upstream === "get_page"
            ? { ...arguments_, format: "markdown" }
            : arguments_,
      }),
    );
  if (result.isError || Buffer.byteLength(JSON.stringify(result)) > 49152)
    throw denied();
  return result.content;
}
