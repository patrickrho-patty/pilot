CREATE TABLE "connection_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"requester_account_id" text NOT NULL,
	"agent_pubkey" text NOT NULL,
	"conversation_id" text NOT NULL,
	"action" text NOT NULL,
	"operation_key" text NOT NULL,
	"digest" text NOT NULL,
	"draft_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_mutations" ADD CONSTRAINT "connection_mutations_resource_fk" FOREIGN KEY ("binding_id","connection_id") REFERENCES "public"."connection_resources"("binding_id","connection_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_mutations_operation_uq" ON "connection_mutations" USING btree ("connection_id","action","operation_key");--> statement-breakpoint
CREATE INDEX "connection_mutations_draft_idx" ON "connection_mutations" USING btree ("connection_id","draft_id");