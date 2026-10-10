import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  connectionAgentAccess,
  connectionAvailability,
  connectionGrants,
  companySecrets,
  connectionProviderRegistrations,
  connectionResources,
  toolConnections,
  type Db,
} from "@pilotai/db";
import { connectionAuthorityService } from "./connection-authority.js";
import { connectionDirectFetch } from "./connection-direct-tls.js";
import {
  connectionRegistrationReady,
  registeredConnectionConfiguration,
  connectionRegistry,
  connectionScopesValid,
} from "./connection-registry.js";
import { kbTools, kbRead } from "./connection-kb.js";
import {
  auditConnectionExecution,
  ConnectionProviderFailure,
} from "./connection-execution-audit.js";
import { connectionNeedsReauthorization } from "./connection-readiness.js";
import { gmailMessage } from "./connection-gmail.js";
import { gmailWriteTools, gmailWrite } from "./connection-gmail-write.js";
import { connectionAccessToken } from "./connection-credentials.js";
import { forbidden } from "../errors.js";
import type { ConnectionWorkspaceOptions } from "./connection-workspaces.js";

const denied = () => forbidden("Connection execution denied");
const searchArguments = z
  .object({
    query: z
      .string()
      .min(1)
      .max(1024)
      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
    maxResults: z.number().int().min(1).max(20).optional(),
    pageToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,512}$/)
      .optional(),
  })
  .strict();
const readArguments = z
  .object({ messageId: z.string().regex(/^[a-fA-F0-9]{1,64}$/) })
  .strict();
/** Fixed names are the only bridge from model tool names to provider actions. */
export const connectionTools = [
  ...kbTools,
  ...gmailWriteTools,
  {
    name: "connections_gmail_search",
    appId: "gmail",
    action: "gmail.search",
    grant: "search",
    description: "Search your connected Gmail in this private conversation",
    schema: searchArguments,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 1024 },
        maxResults: { type: "integer", minimum: 1, maximum: 20 },
        pageToken: { type: "string", maxLength: 512 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "connections_gmail_read",
    appId: "gmail",
    action: "gmail.read",
    grant: "read",
    description: "Read a Gmail message in this private conversation",
    schema: readArguments,
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", pattern: "^[a-fA-F0-9]{1,64}$" },
      },
      required: ["messageId"],
      additionalProperties: false,
    },
  },
] as const;
const envelope = z
  .object({
    schema: z.literal("crew.connections-execute/v1"),
    token: z.string().min(1).max(4096),
    tool: z.string().min(1).max(128),
    arguments: z.unknown(),
  })
  .strict();

/** Stateless external execution: canonical owner resources, never native Pilot runs. */
export function connectionExecutionService(
  db: Db,
  options: ConnectionWorkspaceOptions = {},
) {
  const authority = connectionAuthorityService(db, {
    fetch: options.authorityFetch,
  });
  const provider = options.providerFetch ?? connectionDirectFetch;
  async function executionIdentity(
    bindingId: string,
    token: string,
    tool: (typeof connectionTools)[number],
  ) {
    const { binding: b, context: c } =
      await authority.resolveConnectionAuthority({
        bindingId,
        token,
        purpose: "execution",
        action: tool.action,
      });
    if (
      c.schema !== "crew.connection-execution/v1" ||
      c.sourceMemberAccountIds.length !== 1 ||
      c.sourceMemberAccountIds[0] !== c.requesterAccountId ||
      c.audienceAccountIds.length !== 1 ||
      c.audienceAccountIds[0] !== c.requesterAccountId
    )
      throw denied();
    return { b, c };
  }
  async function resolve(
    bindingId: string,
    token: string,
    tool: (typeof connectionTools)[number],
    identity?: Awaited<ReturnType<typeof executionIdentity>>,
  ) {
    const { b, c } =
      identity ?? (await executionIdentity(bindingId, token, tool));
    const rows = await db
      .select({
        resource: connectionResources,
        connection: toolConnections,
        consent: connectionGrants,
        grant: connectionAgentAccess,
        availability: connectionAvailability,
        registration: connectionProviderRegistrations,
      })
      .from(connectionResources)
      .innerJoin(
        toolConnections,
        eq(toolConnections.id, connectionResources.connectionId),
      )
      .innerJoin(
        connectionGrants,
        eq(connectionGrants.id, connectionResources.consentId),
      )
      .innerJoin(
        connectionAgentAccess,
        and(
          eq(connectionAgentAccess.bindingId, connectionResources.bindingId),
          eq(
            connectionAgentAccess.connectionId,
            connectionResources.connectionId,
          ),
        ),
      )
      .innerJoin(
        connectionAvailability,
        and(
          eq(connectionAvailability.bindingId, connectionResources.bindingId),
          eq(connectionAvailability.appId, connectionResources.appId),
        ),
      )
      .innerJoin(
        connectionProviderRegistrations,
        and(
          eq(
            connectionProviderRegistrations.bindingId,
            connectionResources.bindingId,
          ),
          eq(connectionProviderRegistrations.appId, connectionResources.appId),
        ),
      )
      .where(
        and(
          eq(connectionResources.bindingId, b.id),
          eq(connectionResources.appId, tool.appId),
          eq(connectionResources.ownerAccountId, c.requesterAccountId),
          eq(connectionAgentAccess.agentPubkey, c.agentPubkey),
          eq(connectionAgentAccess.revoked, false),
          eq(connectionGrants.status, "active"),
          eq(connectionGrants.subjectUserId, c.requesterAccountId),
          eq(connectionGrants.kind, "user"),
          eq(toolConnections.companyId, b.companyId),
          eq(toolConnections.externalBindingId, b.id),
          eq(toolConnections.enabled, true),
          eq(connectionAvailability.enabled, true),
        ),
      );
    const eligible = rows.filter(
      (r) =>
        r.grant.consentId === r.consent.id &&
        r.grant.consentGeneration === r.consent.consentGeneration &&
        r.grant.actions.includes(tool.grant) &&
        r.availability.actions.includes(tool.grant) &&
        connectionRegistrationReady(b, r.registration) &&
        !connectionNeedsReauthorization(r.connection, r.consent),
    );
    if (eligible.length !== 1) throw denied();
    const r = eligible[0];
    const app = connectionRegistry.find((app) => app.appId === tool.appId);
    if (!app) throw denied();
    const canonical = registeredConnectionConfiguration(app, r.registration);
    const actual = r.connection.config.oauth as
      | Record<string, unknown>
      | undefined;
    if (
      r.connection.config.url !== canonical.config.url ||
      actual?.clientId !== r.registration.clientId ||
      actual.clientRedirectUri !== r.registration.redirectUri ||
      actual.tokenUrl !== app.tokenUrl ||
      !connectionScopesValid(app, actual.scopes) ||
      (r.connection.credentialSecretRefs.find(
        (ref) => ref.configPath === "oauth.client_secret",
      )?.secretId ?? null) !== r.registration.clientSecretId
    )
      throw denied();
    if (
      (tool.grant === "write" || tool.grant === "send") &&
      (typeof actual.scope !== "string" ||
        !actual.scope
          .split(" ")
          .includes("https://www.googleapis.com/auth/gmail.compose"))
    )
      throw denied();
    let registrationSecretVersion: number | null = null;
    if (r.registration.clientSecretId) {
      const [secret] = await db
        .select()
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.id, r.registration.clientSecretId),
            eq(companySecrets.companyId, b.companyId),
            eq(companySecrets.scope, "company"),
          ),
        );
      if (!secret || secret.status !== "active") throw denied();
      registrationSecretVersion = secret.latestVersion;
    }
    return { b, c, r, app, registrationSecretVersion };
  }
  async function execute(bindingId: string, raw: unknown) {
    const input = envelope.parse(raw);
    const tool = connectionTools.find((t) => t.name === input.tool);
    if (!tool) throw denied();
    const identity = await executionIdentity(bindingId, input.token, tool);
    return auditConnectionExecution(
      db,
      identity,
      tool.action,
      "execute",
      async (phase) => {
        const args = tool.schema.parse(input.arguments);
        const before = await resolve(bindingId, input.token, tool, identity);
        await phase("credentials");
        const access = await connectionAccessToken(db, before, provider, () =>
          resolve(bindingId, input.token, tool),
        );
        if ("upstream" in tool) {
          await phase("provider");
          let content;
          try {
            content = await kbRead(before, access, tool, args, provider);
          } catch {
            throw new ConnectionProviderFailure("uncertain");
          }
          await phase("result");
          const after = await resolve(bindingId, input.token, tool);
          if (
            after.r.consent.consentGeneration !==
              before.r.consent.consentGeneration ||
            JSON.stringify(after.r.registration) !==
              JSON.stringify(before.r.registration) ||
            after.registrationSecretVersion !== before.registrationSecretVersion
          )
            throw denied();
          return {
            schema: "crew.connections-execution-result/v1",
            content,
            isError: false,
          };
        }
        if ("gmailOperation" in tool) {
          await phase("provider");
          const data = await gmailWrite(
            db,
            before,
            access,
            tool,
            args,
            provider,
            async () => {
              const current = await resolve(bindingId, input.token, tool);
              if (
                current.r.consent.id !== before.r.consent.id ||
                current.r.consent.consentGeneration !==
                  before.r.consent.consentGeneration ||
                JSON.stringify(current.r.registration) !==
                  JSON.stringify(before.r.registration) ||
                current.registrationSecretVersion !==
                  before.registrationSecretVersion
              )
                throw denied();
            },
          );
          await phase("result");
          const after = await resolve(bindingId, input.token, tool);
          if (
            after.r.consent.id !== before.r.consent.id ||
            after.r.consent.consentGeneration !==
              before.r.consent.consentGeneration ||
            JSON.stringify(after.r.registration) !==
              JSON.stringify(before.r.registration) ||
            after.registrationSecretVersion !== before.registrationSecretVersion
          )
            throw denied();
          return {
            schema: "crew.connections-execution-result/v1",
            content: [{ type: "text", text: JSON.stringify(data) }],
            isError: false,
          };
        }
        const gmailArgs = tool.schema.parse(input.arguments);
        let url: string;
        if ("query" in gmailArgs) {
          const query = new URLSearchParams({
            q: gmailArgs.query,
            maxResults: String(gmailArgs.maxResults ?? 10),
          });
          if (gmailArgs.pageToken) query.set("pageToken", gmailArgs.pageToken);
          url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`;
        } else
          url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailArgs.messageId}?format=full`;
        let payload: unknown;
        await phase("provider");
        try {
          const response = await provider(url, {
            headers: { authorization: `Bearer ${access}` },
            redirect: "error",
            cache: "no-store",
          });
          if (!response.ok || response.redirected)
            throw new ConnectionProviderFailure("provider_error");
          const text = await response.text();
          if (Buffer.byteLength(text) > 65536)
            throw new ConnectionProviderFailure("provider_error");
          try {
            payload = JSON.parse(text);
          } catch {
            throw new ConnectionProviderFailure("provider_error");
          }
        } catch (error) {
          if (error instanceof ConnectionProviderFailure) throw error;
          throw new ConnectionProviderFailure("uncertain");
        }
        await phase("result");
        const after = await resolve(bindingId, input.token, tool);
        if (
          after.r.consent.id !== before.r.consent.id ||
          after.r.consent.consentGeneration !==
            before.r.consent.consentGeneration ||
          JSON.stringify(after.r.registration) !==
            JSON.stringify(before.r.registration) ||
          after.registrationSecretVersion !== before.registrationSecretVersion
        )
          throw denied();
        const data =
          "query" in gmailArgs
            ? z
                .object({
                  messages: z
                    .array(
                      z.object({
                        id: z.string().regex(/^[a-fA-F0-9]{1,64}$/),
                        threadId: z.string().max(64),
                      }),
                    )
                    .max(20)
                    .optional(),
                  nextPageToken: z.string().max(512).optional(),
                  resultSizeEstimate: z.number().int().nonnegative().optional(),
                })
                .parse(payload)
            : gmailMessage(payload);
        return {
          schema: "crew.connections-execution-result/v1",
          content: [{ type: "text", text: JSON.stringify(data) }],
          isError: false,
        };
      },
    );
  }
  async function catalog(bindingId: string, raw: unknown) {
    const input = z
      .object({
        schema: z.literal("crew.connections-catalog/v1"),
        token: z.string().min(1).max(4096),
        tool: z.string().max(128),
      })
      .strict()
      .parse(raw);
    const tool = connectionTools.find((t) => t.name === input.tool);
    if (!tool) throw denied();
    const before = await resolve(bindingId, input.token, tool);
    if ("upstream" in tool) {
      const access = await connectionAccessToken(db, before, provider, () =>
        resolve(bindingId, input.token, tool),
      );
      await kbRead(before, access, tool, {}, provider, true);
      await resolve(bindingId, input.token, tool);
    }
    return {
      schema: "crew.connections-catalog-result/v1",
      tool: {
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema),
      },
    };
  }
  // Content-free eligibility is not an execution lease. Execute resolves again.
  async function prepare(bindingId: string, raw: unknown) {
    const input = envelope
      .extend({ schema: z.literal("crew.connections-prepare/v1") })
      .parse(raw);
    const tool = connectionTools.find((t) => t.name === input.tool);
    if (!tool) throw denied();
    const identity = await executionIdentity(bindingId, input.token, tool);
    return auditConnectionExecution(
      db,
      identity,
      tool.action,
      "prepare",
      async () => {
        tool.schema.parse(input.arguments);
        await resolve(bindingId, input.token, tool, identity);
        return { schema: "crew.connections-prepared/v1", tool: tool.name };
      },
    );
  }
  return { execute, catalog, prepare };
}
