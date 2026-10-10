import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  uniqueIndex,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { connectionResources } from "./connection_access.js";

/** Durable mutation receipts contain identifiers only, never mail or credential values. */
export const connectionMutations = pgTable(
  "connection_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bindingId: uuid("binding_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    requesterAccountId: text("requester_account_id").notNull(),
    agentPubkey: text("agent_pubkey").notNull(),
    conversationId: text("conversation_id").notNull(),
    action: text("action").notNull(),
    operationKey: text("operation_key").notNull(),
    digest: text("digest").notNull(),
    draftId: text("draft_id"),
    state: text("state")
      .$type<"pending" | "succeeded" | "uncertain">()
      .notNull()
      .default("pending"),
    result: jsonb("result").$type<{
      draftId?: string;
      messageId: string;
      threadId: string;
      sent?: boolean;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("connection_mutations_operation_uq").on(
      t.connectionId,
      t.action,
      t.operationKey,
    ),
    index("connection_mutations_draft_idx").on(t.connectionId, t.draftId),
    foreignKey({
      name: "connection_mutations_resource_fk",
      columns: [t.bindingId, t.connectionId],
      foreignColumns: [
        connectionResources.bindingId,
        connectionResources.connectionId,
      ],
    }).onDelete("restrict"),
  ],
);
