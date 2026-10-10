import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/** One immutable Accounts organization per shared resource namespace. */
export const connectionOrganizationBindings = pgTable(
  "connection_organization_bindings",
  {
    companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "restrict" }),
    accountsOrganizationId: text("accounts_organization_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationUq: uniqueIndex("connection_organization_bindings_organization_uq").on(table.accountsOrganizationId),
    companyOrganizationUq: uniqueIndex("connection_organization_bindings_company_org_uq").on(table.companyId, table.accountsOrganizationId),
    organizationShapeCheck: check("connection_organization_bindings_organization_check",
      sql`length(${table.accountsOrganizationId}) between 1 and 256 and ${table.accountsOrganizationId} !~ '[[:space:][:cntrl:]]'`),
  }),
);

/** Operator-managed Crew identity mapping; company is a resource namespace. */
export const connectionWorkspaceBindings = pgTable(
  "connection_workspace_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    accountsOrganizationId: text("accounts_organization_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    communityId: uuid("community_id").notNull(),
    authorityUrl: text("authority_url").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("connection_workspace_bindings_company_idx").on(table.companyId),
    // Even disabled records reserve the mapping. Rebinding is an operator lifecycle.
    scopeUq: uniqueIndex("connection_workspace_bindings_scope_uq").on(table.workspaceId, table.communityId),
    companyBindingUq: uniqueIndex("connection_workspace_bindings_company_binding_uq").on(table.companyId, table.id),
    companyOrganizationFk: foreignKey({
      name: "connection_workspace_bindings_company_org_fk",
      columns: [table.companyId, table.accountsOrganizationId],
      foreignColumns: [connectionOrganizationBindings.companyId, connectionOrganizationBindings.accountsOrganizationId],
    }).onDelete("restrict"),
    organizationShapeCheck: check("connection_workspace_bindings_organization_check",
      sql`length(${table.accountsOrganizationId}) between 1 and 256 and ${table.accountsOrganizationId} !~ '[[:space:][:cntrl:]]'`),
    authorityShapeCheck: check("connection_workspace_bindings_authority_check",
      sql`length(${table.authorityUrl}) <= 2048 and ${table.authorityUrl} ~ '^https://[^/?#@[:space:]]+/api/connections/introspect$'`),
  }),
);
