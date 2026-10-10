import { z } from "zod";

/** Immutable external identifiers are compared exactly, without normalization. */
export const connectionAuthorityIdSchema = z.string().min(1).max(256).regex(/^[^\s\u0000-\u001f\u007f]+$/);
const uuid = z.string().uuid().regex(/^[0-9a-f-]+$/);
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const utcSeconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const connectionAuthorityActionSchema = z.string().min(1).max(128).regex(/^[a-z][a-z0-9._:-]*$/);
const token = z.string().min(1).max(4_096);

/** Only an operator's canonical HTTPS origin and the fixed introspection path. */
export const connectionAuthorityUrlSchema = z.string().max(2_048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && value === `${url.origin}/api/connections/introspect`;
  } catch {
    return false;
  }
}, "Authority must use a canonical HTTPS origin and /api/connections/introspect");

export const connectionWorkspaceBindingSchema = z.object({
  id: uuid,
  companyId: uuid,
  accountsOrganizationId: connectionAuthorityIdSchema,
  workspaceId: uuid,
  communityId: uuid,
  authorityUrl: connectionAuthorityUrlSchema,
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

const common = {
  audience: z.literal("patty.connections"),
  accountsOrganizationId: connectionAuthorityIdSchema,
  workspaceId: uuid,
  communityId: uuid,
  requesterAccountId: connectionAuthorityIdSchema,
  requesterPubkey: hex,
  issuedAt: utcSeconds,
  expiresAt: utcSeconds,
};
const uniqueIds = z.array(connectionAuthorityIdSchema).min(1).max(100)
  .refine((values) => new Set(values).size === values.length, "Account IDs must be unique");

export const connectionManagementContextSchema = z.object({
  schema: z.literal("crew.connection-management/v1"),
  ...common,
  role: z.enum(["owner", "admin", "member"]),
  requestId: hex,
  action: connectionAuthorityActionSchema,
  requestDigest: hex,
}).strict().refine((context) => context.expiresAt > context.issuedAt && context.expiresAt - context.issuedAt <= 60,
  "Authority lifetime must be positive and at most sixty seconds");

export const connectionExecutionContextSchema = z.object({
  schema: z.literal("crew.connection-execution/v1"),
  ...common,
  action: connectionAuthorityActionSchema,
  agentPubkey: hex,
  enrollmentId: uuid,
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  channelId: uuid,
  conversationId: connectionAuthorityIdSchema,
  turnId: uuid,
  sourceMemberAccountIds: uniqueIds,
  audienceAccountIds: uniqueIds,
}).strict().refine((context) => context.expiresAt > context.issuedAt && context.expiresAt - context.issuedAt <= 60,
  "Authority lifetime must be positive and at most sixty seconds");

/** Purpose-specific, short-lived identity; expiry is additionally checked at use. */
export const connectionAuthorityContextSchema = z.discriminatedUnion("schema", [
  connectionManagementContextSchema,
  connectionExecutionContextSchema,
]);

export const connectionAuthorityResponseSchema = z.object({
  schema: z.literal("crew.connection-authority/v1"),
  valid: z.literal(true),
  context: connectionAuthorityContextSchema,
}).strict();

/** The relay derives all identity and purpose fields from this opaque token. */
export const connectionIntrospectionRequestSchema = z.object({
  schema: z.literal("crew.connection-introspection/v1"),
  token,
}).strict();

export const resolveConnectionAuthorityInputSchema = z.discriminatedUnion("purpose", [
  z.object({ bindingId: uuid, token, purpose: z.literal("management"), action: connectionAuthorityActionSchema, requestDigest: hex }).strict(),
  z.object({ bindingId: uuid, token, purpose: z.literal("execution"), action: connectionAuthorityActionSchema }).strict(),
]);
