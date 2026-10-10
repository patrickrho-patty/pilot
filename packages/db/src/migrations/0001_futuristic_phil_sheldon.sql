CREATE TABLE "connection_workspace_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"accounts_organization_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"authority_url" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_workspace_bindings_organization_check" CHECK (length("connection_workspace_bindings"."accounts_organization_id") between 1 and 256 and "connection_workspace_bindings"."accounts_organization_id" !~ '[[:space:][:cntrl:]]'),
	CONSTRAINT "connection_workspace_bindings_authority_check" CHECK (length("connection_workspace_bindings"."authority_url") <= 2048 and "connection_workspace_bindings"."authority_url" ~ '^https://[^/?#@[:space:]]+/api/connections/introspect$')
);
--> statement-breakpoint
ALTER TABLE "connection_workspace_bindings" ADD CONSTRAINT "connection_workspace_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_workspace_bindings_company_idx" ON "connection_workspace_bindings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_workspace_bindings_scope_uq" ON "connection_workspace_bindings" USING btree ("workspace_id","community_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_workspace_bindings_company_binding_uq" ON "connection_workspace_bindings" USING btree ("company_id","id");