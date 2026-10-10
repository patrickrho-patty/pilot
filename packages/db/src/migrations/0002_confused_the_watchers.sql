CREATE TABLE "connection_organization_bindings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"accounts_organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_organization_bindings_organization_check" CHECK (length("connection_organization_bindings"."accounts_organization_id") between 1 and 256 and "connection_organization_bindings"."accounts_organization_id" !~ '[[:space:][:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "connection_organization_bindings" ADD CONSTRAINT "connection_organization_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_organization_bindings_organization_uq" ON "connection_organization_bindings" USING btree ("accounts_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_organization_bindings_company_org_uq" ON "connection_organization_bindings" USING btree ("company_id","accounts_organization_id");--> statement-breakpoint
ALTER TABLE "connection_workspace_bindings" ADD CONSTRAINT "connection_workspace_bindings_company_org_fk" FOREIGN KEY ("company_id","accounts_organization_id") REFERENCES "public"."connection_organization_bindings"("company_id","accounts_organization_id") ON DELETE cascade ON UPDATE no action;