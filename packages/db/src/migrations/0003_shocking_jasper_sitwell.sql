CREATE TABLE "connection_agent_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"consent_generation" integer NOT NULL,
	"agent_pubkey" text NOT NULL,
	"actions" jsonb NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_agent_access_pubkey_check" CHECK ("connection_agent_access"."agent_pubkey" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "connection_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"requester_account_id" text NOT NULL,
	"requester_pubkey" text NOT NULL,
	"agent_pubkey" text NOT NULL,
	"actions" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"requester_account_id" text NOT NULL,
	"digest" text NOT NULL,
	"operation" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_provider_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_id" uuid,
	"redirect_uri" text NOT NULL,
	"audience" text,
	"qualified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_resources" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"binding_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"owner_account_id" text NOT NULL,
	"consent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_resources_binding_connection_uq" UNIQUE("binding_id","connection_id")
);
--> statement-breakpoint
ALTER TABLE "connection_organization_bindings" DROP CONSTRAINT "connection_organization_bindings_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "connection_workspace_bindings" DROP CONSTRAINT "connection_workspace_bindings_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "connection_workspace_bindings" DROP CONSTRAINT "connection_workspace_bindings_company_org_fk";
--> statement-breakpoint
ALTER TABLE "connection_grants" ADD COLUMN "consent_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD COLUMN "external_binding_id" uuid;--> statement-breakpoint
ALTER TABLE "tool_oauth_states" ADD COLUMN "redirect_uri" text;--> statement-breakpoint
ALTER TABLE "tool_oauth_states" ADD COLUMN "external_binding_id" uuid;--> statement-breakpoint
ALTER TABLE "tool_oauth_states" ADD COLUMN "external_operation_id" text;--> statement-breakpoint
ALTER TABLE "tool_oauth_states" ADD COLUMN "consent_generation" integer;--> statement-breakpoint
ALTER TABLE "connection_agent_access" ADD CONSTRAINT "connection_agent_access_consent_id_connection_grants_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."connection_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_agent_access" ADD CONSTRAINT "connection_agent_access_resource_fk" FOREIGN KEY ("binding_id","connection_id") REFERENCES "public"."connection_resources"("binding_id","connection_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_approval_requests" ADD CONSTRAINT "connection_approval_requests_binding_id_connection_workspace_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."connection_workspace_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_availability" ADD CONSTRAINT "connection_availability_binding_id_connection_workspace_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."connection_workspace_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_operations" ADD CONSTRAINT "connection_operations_binding_id_connection_workspace_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."connection_workspace_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_provider_registrations" ADD CONSTRAINT "connection_provider_registrations_binding_id_connection_workspace_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."connection_workspace_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_resources" ADD CONSTRAINT "connection_resources_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_resources" ADD CONSTRAINT "connection_resources_binding_id_connection_workspace_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."connection_workspace_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_resources" ADD CONSTRAINT "connection_resources_consent_id_connection_grants_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."connection_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_agent_access_resource_agent_uq" ON "connection_agent_access" USING btree ("binding_id","connection_id","agent_pubkey");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_availability_binding_app_uq" ON "connection_availability" USING btree ("binding_id","app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_operations_event_uq" ON "connection_operations" USING btree ("binding_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_operations_request_uq" ON "connection_operations" USING btree ("binding_id","requester_account_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_provider_registrations_binding_app_uq" ON "connection_provider_registrations" USING btree ("binding_id","app_id");--> statement-breakpoint
ALTER TABLE "connection_organization_bindings" ADD CONSTRAINT "connection_organization_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_workspace_bindings" ADD CONSTRAINT "connection_workspace_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_workspace_bindings" ADD CONSTRAINT "connection_workspace_bindings_company_org_fk" FOREIGN KEY ("company_id","accounts_organization_id") REFERENCES "public"."connection_organization_bindings"("company_id","accounts_organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_external_binding_id_connection_workspace_bindings_id_fk" FOREIGN KEY ("external_binding_id") REFERENCES "public"."connection_workspace_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_oauth_states" ADD CONSTRAINT "tool_oauth_states_external_binding_id_connection_workspace_bindings_id_fk" FOREIGN KEY ("external_binding_id") REFERENCES "public"."connection_workspace_bindings"("id") ON DELETE restrict ON UPDATE no action;