import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  boolean,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import type { ConnectionAction, ConnectionResult } from "@pilotai/shared";
import { connectionWorkspaceBindings } from "./connection_workspaces.js";
import { toolConnections, connectionGrants } from "./tool_access.js";
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Workspace approval is independent from provider setup and human consent. */
export const connectionAvailability = pgTable(
  "connection_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => connectionWorkspaceBindings.id, { onDelete: "restrict" }),
    appId: text("app_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    actions: jsonb("actions").$type<ConnectionAction[]>().notNull().default([]),
  },
  (t) => [uniqueIndex("connection_availability_binding_app_uq").on(t.bindingId, t.appId)],
);
/** Only the resource map is new: credentials and owner consent stay canonical. */
export const connectionResources = pgTable(
  "connection_resources",
  {
    connectionId: uuid("connection_id")
      .primaryKey()
      .references(() => toolConnections.id, { onDelete: "restrict" }),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => connectionWorkspaceBindings.id, { onDelete: "restrict" }),
    appId: text("app_id").notNull(),
    ownerAccountId: text("owner_account_id").notNull(),
    consentId: uuid("consent_id")
      .notNull()
      .references(() => connectionGrants.id, { onDelete: "restrict" }),
    createdAt: created(),
  },
  (t) => [
    unique("connection_resources_binding_connection_uq").on(t.bindingId, t.connectionId),
    unique("connection_resources_consent_uq").on(t.bindingId, t.connectionId, t.consentId),
    foreignKey({
      name: "connection_resources_external_fk",
      columns: [t.bindingId, t.connectionId],
      foreignColumns: [toolConnections.externalBindingId, toolConnections.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "connection_resources_consent_fk",
      columns: [t.connectionId, t.consentId],
      foreignColumns: [connectionGrants.connectionId, connectionGrants.id],
    }).onDelete("restrict"),
  ],
);
/** Grants bind the real consent generation, never a synthetic Pilot agent. */
export const connectionAgentAccess = pgTable(
  "connection_agent_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bindingId: uuid("binding_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    consentId: uuid("consent_id")
      .notNull()
      .references(() => connectionGrants.id, { onDelete: "restrict" }),
    consentGeneration: integer("consent_generation").notNull(),
    agentPubkey: text("agent_pubkey").notNull(),
    actions: jsonb("actions").$type<ConnectionAction[]>().notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("connection_agent_access_resource_agent_uq").on(t.bindingId, t.connectionId, t.agentPubkey),
    foreignKey({
      name: "connection_agent_access_resource_fk",
      columns: [t.bindingId, t.connectionId, t.consentId],
      foreignColumns: [connectionResources.bindingId, connectionResources.connectionId, connectionResources.consentId],
    }).onDelete("restrict"),
    check("connection_agent_access_pubkey_check", sql`${t.agentPubkey} ~ '^[0-9a-f]{64}$'`),
  ],
);
export const connectionApprovalRequests = pgTable("connection_approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  bindingId: uuid("binding_id")
    .notNull()
    .references(() => connectionWorkspaceBindings.id, { onDelete: "restrict" }),
  appId: text("app_id").notNull(),
  requesterAccountId: text("requester_account_id").notNull(),
  requesterPubkey: text("requester_pubkey").notNull(),
  agentPubkey: text("agent_pubkey").notNull(),
  actions: jsonb("actions").$type<ConnectionAction[]>().notNull(),
  status: text("status").$type<"pending" | "approved" | "denied">().notNull().default("pending"),
  createdAt: created(),
});
/** No signed bodies, callbacks, capabilities, OAuth URLs or provider data. */
export const connectionOperations = pgTable(
  "connection_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => connectionWorkspaceBindings.id, { onDelete: "restrict" }),
    eventId: text("event_id").notNull(),
    requestId: uuid("request_id").notNull(),
    requesterAccountId: text("requester_account_id").notNull(),
    digest: text("digest").notNull(),
    operation: text("operation").notNull(),
    result: jsonb("result").$type<ConnectionResult>().notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("connection_operations_event_uq").on(t.bindingId, t.eventId),
    uniqueIndex("connection_operations_request_uq").on(t.bindingId, t.requesterAccountId, t.requestId),
  ],
);
/** Operator-owned registration, with no client secret values. No public mutation route. */
export const connectionProviderRegistrations = pgTable(
  "connection_provider_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => connectionWorkspaceBindings.id, { onDelete: "restrict" }),
    appId: text("app_id").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretId: uuid("client_secret_id"),
    redirectUri: text("redirect_uri").notNull(),
    audience: text("audience"),
    qualified: boolean("qualified").notNull().default(false),
  },
  (t) => [uniqueIndex("connection_provider_registrations_binding_app_uq").on(t.bindingId, t.appId)],
);
