import { z } from "zod";
const uuid = z
  .string()
  .uuid()
  .refine((v) => v !== "00000000-0000-0000-0000-000000000000");
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const appId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9._-]+$/);
const label = z
  .string()
  .refine((v) => v.trim().length > 0 && new TextEncoder().encode(v).length <= 128 && !/[\u0000-\u001f\u007f]/.test(v));
export const connectionActionsSchema = z
  .array(z.enum(["read", "search", "write", "send"]))
  .min(1)
  .max(4)
  .refine((v) => new Set(v).size === v.length);
const common = { schema: z.literal("crew.connections-control/v1"), requestId: uuid };
const create = z.object({ appId, displayName: label }).strict();
const connection = z.object({ connectionId: uuid }).strict();
/** Exact signed Crew intent; identity and transport are never control fields. */
export const connectionControlSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.literal("catalog.get"), parameters: z.object({}).strict() }).strict(),
  z
    .object({
      ...common,
      operation: z.literal("availability.set"),
      parameters: z.object({ appId, enabled: z.boolean(), actions: connectionActionsSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("connections.list"),
      parameters: z.object({ scope: z.enum(["personal", "workspace"]) }).strict(),
    })
    .strict(),
  z.object({ ...common, operation: z.literal("connection.create-personal"), parameters: create }).strict(),
  z.object({ ...common, operation: z.literal("connection.create-workspace"), parameters: create }).strict(),
  z.object({ ...common, operation: z.literal("connection.authorize"), parameters: connection }).strict(),
  z.object({ ...common, operation: z.literal("connection.disconnect"), parameters: connection }).strict(),
  z
    .object({
      ...common,
      operation: z.literal("access.list"),
      parameters: z.object({ connectionId: uuid.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("access.grant"),
      parameters: z.object({ connectionId: uuid, agentPubkey: hex, actions: connectionActionsSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("access.revoke"),
      parameters: z.object({ connectionId: uuid, agentPubkey: hex }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("access.request"),
      parameters: z.object({ appId, agentPubkey: hex, actions: connectionActionsSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("access.request-resolve"),
      parameters: z.object({ approvalRequestId: uuid, approved: z.boolean() }).strict(),
    })
    .strict(),
]);
const ephemeral = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => new TextEncoder().encode(v).length <= 4096 && !/[\u0000-\u001f\u007f]/.test(v));
const callbackIssuer = z.enum(["https://accounts.google.com", "https://login.patty.io/realms/internal"]).optional();
export const connectionOAuthCallbackSchema = z.union([
  z
    .object({
      schema: z.literal("crew.connection-oauth-callback/v1"),
      state: ephemeral,
      code: ephemeral,
      iss: callbackIssuer,
    })
    .strict(),
  z
    .object({
      schema: z.literal("crew.connection-oauth-callback/v1"),
      state: ephemeral,
      error: z.enum(["access_denied", "temporarily_unavailable", "server_error"]),
      iss: callbackIssuer,
    })
    .strict(),
]);
export const connectionManageEnvelopeSchema = z
  .object({
    schema: z.literal("crew.connections-manage/v1"),
    token: z.string().min(1).max(4096),
    control: z.string().min(1).max(16384),
  })
  .strict();
export const connectionCompleteEnvelopeSchema = z
  .object({
    schema: z.literal("crew.connections-oauth-complete/v1"),
    token: z.string().min(1).max(4096),
    callback: z.string().min(1).max(16384),
  })
  .strict();
export type ConnectionControl = z.infer<typeof connectionControlSchema>;
export type ConnectionAction = "read" | "search" | "write" | "send";
export type ConnectionOutcome =
  | "ready"
  | "requires-setup"
  | "unavailable"
  | "denied"
  | "complete"
  | "authorization-required";
/** Bounded credential-free private result matching the frozen Crew receiver. */
export interface ConnectionResult {
  schema: "crew.connections-result/v1";
  outcome: ConnectionOutcome;
  retryable: boolean;
  apps?: {
    appId: string;
    displayName: string;
    enabled: boolean;
    actions: ConnectionAction[];
    outcome: ConnectionOutcome;
  }[];
  connections?: {
    connectionId: string;
    appId: string;
    displayName: string;
    scope: "personal" | "workspace";
    outcome: ConnectionOutcome;
  }[];
  access?: { connectionId: string; agentPubkey: string; actions: ConnectionAction[] }[];
  requests?: {
    approvalRequestId: string;
    appId: string;
    requesterPubkey: string;
    agentPubkey: string;
    actions: ConnectionAction[];
    status: "pending" | "approved" | "denied";
  }[];
  authorizationUrl?: string;
}
