CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch" WITH SCHEMA public;
CREATE FUNCTION public.remove_deleted_agent_from_inbox_policy_allowlists() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	UPDATE "user_inbox_agent_policies"
	SET
		"allowed_agent_ids" = "allowed_agent_ids" - OLD."id"::text,
		"updated_at" = now()
	WHERE "allowed_agent_ids" ? OLD."id"::text;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"agent_id" uuid,
	"run_id" uuid,
	"responsible_user_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adapter_auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"adapter_type" text NOT NULL,
	"started_by_user_id" text NOT NULL,
	"public_session_id" varchar(128) NOT NULL,
	"provider_lease_id" text,
	"status" text DEFAULT 'starting' NOT NULL,
	"expires_at" timestamp with time zone,
	"promotion_expires_at" timestamp with time zone,
	"bound_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"responsible_user_id" text,
	"scope_config" jsonb,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_config_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"source" text DEFAULT 'patch' NOT NULL,
	"rolled_back_from_revision_id" uuid,
	"changed_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"before_config" jsonb NOT NULL,
	"after_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" text DEFAULT 'joined' NOT NULL,
	"starred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runtime_state" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"adapter_type" text NOT NULL,
	"session_id" text,
	"state_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_id" uuid,
	"last_run_status" text,
	"total_input_tokens" bigint DEFAULT 0 NOT NULL,
	"total_output_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost_cents" bigint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"adapter_type" text NOT NULL,
	"task_key" text NOT NULL,
	"session_params_json" jsonb,
	"session_display_id" text,
	"last_run_id" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_wakeup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" text NOT NULL,
	"trigger_detail" text,
	"reason" text,
	"payload" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"coalesced_count" integer DEFAULT 0 NOT NULL,
	"requested_by_actor_type" text,
	"requested_by_actor_id" text,
	"idempotency_key" text,
	"run_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'general' NOT NULL,
	"title" text,
	"icon" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"reports_to" uuid,
	"capabilities" text,
	"adapter_type" text DEFAULT 'process' NOT NULL,
	"adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"runtime_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_environment_id" uuid,
	"budget_monthly_cents" integer DEFAULT 0 NOT NULL,
	"spent_monthly_cents" integer DEFAULT 0 NOT NULL,
	"pause_reason" text,
	"paused_at" timestamp with time zone,
	"error_reason" text,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"requested_by_agent_id" uuid,
	"requested_by_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"decision_note" text,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"original_filename" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "board_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"window_kind" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"threshold_type" text NOT NULL,
	"amount_limit" integer NOT NULL,
	"amount_observed" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"approval_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"metric" text DEFAULT 'billed_cents' NOT NULL,
	"window_kind" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"warn_percent" integer DEFAULT 80 NOT NULL,
	"hard_stop_enabled" boolean DEFAULT true NOT NULL,
	"notify_enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "built_in_managed_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bundle_key" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_key" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"stock_version" text NOT NULL,
	"stock_hash" text NOT NULL,
	"defaults_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_agent_id" uuid,
	"run_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_events_kind_check" CHECK ("case_events"."kind" in (
        'created',
        'updated',
        'fields_changed',
        'status_changed',
        'issue_linked',
        'issue_unlinked',
        'document_revised',
        'child_linked',
        'attachment_added',
        'label_added',
        'label_removed'
      )),
	CONSTRAINT "case_events_actor_type_check" CHECK ("case_events"."actor_type" in ('user', 'agent', 'system'))
);
--> statement-breakpoint
CREATE TABLE "case_issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_issue_links_role_check" CHECK ("case_issue_links"."role" in ('origin', 'work', 'reference'))
);
--> statement-breakpoint
CREATE TABLE "case_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"case_number" integer NOT NULL,
	"identifier" text NOT NULL,
	"case_type" text NOT NULL,
	"key" text,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_case_id" uuid,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_status_check" CHECK ("cases"."status" in ('draft', 'in_progress', 'in_review', 'approved', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "cli_auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_hash" text NOT NULL,
	"command" text NOT NULL,
	"client_name" text,
	"requested_access" text DEFAULT 'board' NOT NULL,
	"requested_company_id" uuid,
	"pending_key_hash" text NOT NULL,
	"pending_key_name" text NOT NULL,
	"approved_by_user_id" text,
	"board_api_key_id" uuid,
	"approved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"pause_reason" text,
	"paused_at" timestamp with time zone,
	"issue_prefix" text DEFAULT 'PIL' NOT NULL,
	"issue_counter" integer DEFAULT 0 NOT NULL,
	"budget_monthly_cents" integer DEFAULT 0 NOT NULL,
	"spent_monthly_cents" integer DEFAULT 0 NOT NULL,
	"attachment_max_bytes" integer DEFAULT 10485760 NOT NULL,
	"default_responsible_user_id" text,
	"require_board_approval_for_new_agents" boolean DEFAULT false NOT NULL,
	"interaction_resolver_governance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feedback_data_sharing_enabled" boolean DEFAULT false NOT NULL,
	"feedback_data_sharing_consent_at" timestamp with time zone,
	"feedback_data_sharing_consent_by_user_id" text,
	"feedback_data_sharing_terms_version" text,
	"brand_color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_logos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"membership_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_onboarding_seeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"mission" text,
	"agent_name" text,
	"agent_role" text,
	"first_task_title" text,
	"first_task_details" text,
	"goal_id" uuid,
	"agent_id" uuid,
	"issue_id" uuid,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_secret_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"secret_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"config_path" text NOT NULL,
	"version_selector" text DEFAULT 'latest' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"label" text,
	"projection_class" text DEFAULT 'unclassified' NOT NULL,
	"projection_allowlist_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_secret_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_name" text,
	"proposed_key" text,
	"proposed_description" text,
	"justification" text NOT NULL,
	"value_ciphertext" jsonb,
	"value_fingerprint_sha256" text,
	"value_length" integer,
	"secret_id" uuid,
	"secret_proposal_id" uuid,
	"target_type" text,
	"target_id" uuid,
	"config_path" text,
	"projection_class" text DEFAULT 'unclassified' NOT NULL,
	"binding_target_policy_snapshot" text,
	"proposer_ancestor_ids_snapshot" jsonb,
	"target_ancestor_ids_snapshot" jsonb,
	"proposed_by_agent_id" uuid NOT NULL,
	"origin_issue_id" uuid,
	"origin_run_id" uuid NOT NULL,
	"interaction_id" uuid,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	"created_secret_id" uuid,
	"applied_binding_config_path" text,
	"ciphertext_scrubbed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_secret_proposals_kind_check" CHECK ("company_secret_proposals"."kind" in ('secret', 'binding')),
	CONSTRAINT "company_secret_proposals_status_check" CHECK ("company_secret_proposals"."status" in ('pending', 'approved', 'rejected', 'withdrawn', 'expired')),
	CONSTRAINT "company_secret_proposals_projection_check" CHECK ("company_secret_proposals"."projection_class" = 'unclassified'),
	CONSTRAINT "company_secret_proposals_shape_check" CHECK ((
      "company_secret_proposals"."kind" = 'secret'
      and "company_secret_proposals"."proposed_name" is not null
      and "company_secret_proposals"."proposed_key" is not null
      and "company_secret_proposals"."secret_id" is null
      and "company_secret_proposals"."secret_proposal_id" is null
      and "company_secret_proposals"."target_type" is null
      and "company_secret_proposals"."target_id" is null
      and "company_secret_proposals"."config_path" is null
    ) or (
      "company_secret_proposals"."kind" = 'binding'
      and (("company_secret_proposals"."secret_id" is not null)::int + ("company_secret_proposals"."secret_proposal_id" is not null)::int) = 1
      and "company_secret_proposals"."target_type" = 'agent'
      and "company_secret_proposals"."target_id" is not null
      and "company_secret_proposals"."config_path" is not null
    ))
);
--> statement-breakpoint
CREATE TABLE "company_secret_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_status" text,
	"health_checked_at" timestamp with time zone,
	"health_message" text,
	"health_details" jsonb,
	"disabled_at" timestamp with time zone,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_secret_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"material" jsonb NOT NULL,
	"value_sha256" text NOT NULL,
	"provider_version_ref" text,
	"status" text DEFAULT 'current' NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"rotation_job_id" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope" text DEFAULT 'company' NOT NULL,
	"owner_user_id" text,
	"user_secret_definition_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'local_encrypted' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"managed_mode" text DEFAULT 'pilot_managed' NOT NULL,
	"external_ref" text,
	"provider_config_id" uuid,
	"provider_metadata" jsonb,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"last_resolved_at" timestamp with time zone,
	"last_rotated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_secrets_scope_shape_check" CHECK ((
        "company_secrets"."scope" = 'company'
        and "company_secrets"."owner_user_id" is null
        and "company_secrets"."user_secret_definition_id" is null
      ) or (
        "company_secrets"."scope" = 'user'
        and "company_secrets"."owner_user_id" is not null
        and "company_secrets"."user_secret_definition_id" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "company_skill_policies" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"revision" integer NOT NULL,
	"default_effect" text NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_skill_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"company_skill_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"author_agent_id" uuid,
	"author_user_id" text,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_skill_stars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"company_skill_id" uuid NOT NULL,
	"agent_id" uuid,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_skill_test_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_skill_test_run_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"body" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_skill_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"input_id" uuid,
	"input_snapshot" text NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issue_id" uuid NOT NULL,
	"template_id" text,
	"template_name" text,
	"template_body" text,
	"rendered_template_body" text,
	"harness_issue_description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"output_document_key" text DEFAULT 'output' NOT NULL,
	"output_snapshot" text DEFAULT '' NOT NULL,
	"error" text,
	"deleted_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"harness_issue_expires_at" timestamp with time zone,
	"harness_issue_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"company_skill_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"label" text,
	"release_id" text,
	"release_name" text,
	"released_at" timestamp with time zone,
	"file_inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"folder_id" uuid,
	"key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"markdown" text NOT NULL,
	"source_type" text DEFAULT 'local_path' NOT NULL,
	"source_locator" text,
	"source_ref" text,
	"trust_level" text DEFAULT 'markdown_only' NOT NULL,
	"compatibility" text DEFAULT 'compatible' NOT NULL,
	"file_inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"icon_url" text,
	"color" text,
	"tagline" text,
	"author_name" text,
	"homepage_url" text,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"sharing_scope" text DEFAULT 'company' NOT NULL,
	"public_share_token" text,
	"forked_from_skill_id" uuid,
	"forked_from_company_id" uuid,
	"star_count" integer DEFAULT 0 NOT NULL,
	"install_count" integer DEFAULT 0 NOT NULL,
	"fork_count" integer DEFAULT 0 NOT NULL,
	"current_version_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_transfer_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"actor_key" text NOT NULL,
	"container_ref" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"manifest_sha256" text,
	"manifest" jsonb,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"blob_count" integer DEFAULT 0 NOT NULL,
	"completed_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_user_sidebar_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"project_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"issue_id" uuid,
	"project_id" uuid,
	"goal_id" uuid,
	"heartbeat_run_id" uuid,
	"billing_code" text,
	"provider" text NOT NULL,
	"biller" text DEFAULT 'unknown' NOT NULL,
	"billing_type" text DEFAULT 'unknown' NOT NULL,
	"cost_status" text DEFAULT 'reported' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_archive_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"archive_version" integer NOT NULL,
	"origin_agent_id" uuid NOT NULL,
	"origin_issue_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_archive_notification_outbox_status_check" CHECK ("decision_archive_notification_outbox"."status" IN ('pending', 'delivering', 'delivered'))
);
--> statement-breakpoint
CREATE TABLE "decision_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"added_by_type" text NOT NULL,
	"added_by_agent_id" uuid,
	"added_by_user_id" text,
	"added_by_run_id" uuid,
	"added_by_agent_api_key_id" uuid,
	"responsible_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_queue_items_actor_check" CHECK ((
        ("decision_queue_items"."added_by_type" = 'agent' AND "decision_queue_items"."added_by_agent_id" IS NOT NULL AND "decision_queue_items"."added_by_user_id" IS NULL)
        OR ("decision_queue_items"."added_by_type" = 'user' AND "decision_queue_items"."added_by_agent_id" IS NULL AND "decision_queue_items"."added_by_user_id" IS NOT NULL)
        OR ("decision_queue_items"."added_by_type" = 'system' AND "decision_queue_items"."added_by_agent_id" IS NULL AND "decision_queue_items"."added_by_user_id" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "decision_queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_by_type" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"created_by_agent_api_key_id" uuid,
	"retention_days" integer,
	"seed_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seed_rules_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_queues_id_company_uq" UNIQUE("id","company_id"),
	CONSTRAINT "decision_queues_creator_check" CHECK ((
        ("decision_queues"."created_by_type" = 'agent' AND "decision_queues"."created_by_agent_id" IS NOT NULL AND "decision_queues"."created_by_user_id" IS NULL)
        OR ("decision_queues"."created_by_type" = 'user' AND "decision_queues"."created_by_agent_id" IS NULL AND "decision_queues"."created_by_user_id" IS NOT NULL)
        OR ("decision_queues"."created_by_type" = 'system' AND "decision_queues"."created_by_agent_id" IS NULL AND "decision_queues"."created_by_user_id" IS NULL)
      )),
	CONSTRAINT "decision_queues_retention_days_check" CHECK ("decision_queues"."retention_days" IS NULL OR ("decision_queues"."retention_days" >= 1 AND "decision_queues"."retention_days" <= 3650))
);
--> statement-breakpoint
CREATE TABLE "decision_retention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_activity_at" timestamp with time zone NOT NULL,
	"keep" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_reason" text,
	"archived_by_type" text,
	"archived_by_agent_id" uuid,
	"archived_by_user_id" text,
	"archived_by_run_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archive_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_retention_archive_actor_check" CHECK ((
        ("decision_retention"."archived_at" IS NULL AND "decision_retention"."archived_by_type" IS NULL AND "decision_retention"."archived_by_agent_id" IS NULL AND "decision_retention"."archived_by_user_id" IS NULL)
        OR ("decision_retention"."archived_at" IS NOT NULL AND "decision_retention"."archived_by_type" = 'system' AND "decision_retention"."archived_by_agent_id" IS NULL AND "decision_retention"."archived_by_user_id" IS NULL)
        OR ("decision_retention"."archived_at" IS NOT NULL AND "decision_retention"."archived_by_type" = 'agent' AND "decision_retention"."archived_by_agent_id" IS NOT NULL AND "decision_retention"."archived_by_user_id" IS NULL)
        OR ("decision_retention"."archived_at" IS NOT NULL AND "decision_retention"."archived_by_type" = 'user' AND "decision_retention"."archived_by_agent_id" IS NULL AND "decision_retention"."archived_by_user_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "decision_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"decide_by" text,
	"decide_by_date" date,
	"snoozed_until" timestamp with time zone,
	"set_by_type" text NOT NULL,
	"set_by_agent_id" uuid,
	"set_by_user_id" text,
	"set_by_run_id" uuid,
	"set_by_agent_api_key_id" uuid,
	"responsible_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_triage_actor_check" CHECK ((
        ("decision_triage"."set_by_type" = 'agent' AND "decision_triage"."set_by_agent_id" IS NOT NULL AND "decision_triage"."set_by_user_id" IS NULL)
        OR ("decision_triage"."set_by_type" = 'user' AND "decision_triage"."set_by_agent_id" IS NULL AND "decision_triage"."set_by_user_id" IS NOT NULL)
      )),
	CONSTRAINT "decision_triage_decide_by_check" CHECK ((
        ("decision_triage"."decide_by" IS NULL AND "decision_triage"."decide_by_date" IS NULL)
        OR ("decision_triage"."decide_by" IN ('today', 'this_week', 'whenever') AND "decision_triage"."decide_by_date" IS NULL)
        OR ("decision_triage"."decide_by" = 'date' AND "decision_triage"."decide_by_date" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "decision_triage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"queue_id" uuid,
	"source_kind" text,
	"source_id" text,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_agent_id" uuid,
	"actor_user_id" text,
	"actor_run_id" uuid,
	"agent_api_key_id" uuid,
	"responsible_user_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_triage_events_actor_check" CHECK ((
        ("decision_triage_events"."actor_type" = 'agent' AND "decision_triage_events"."actor_agent_id" IS NOT NULL AND "decision_triage_events"."actor_user_id" IS NULL)
        OR ("decision_triage_events"."actor_type" = 'user' AND "decision_triage_events"."actor_agent_id" IS NULL AND "decision_triage_events"."actor_user_id" IS NOT NULL)
        OR ("decision_triage_events"."actor_type" = 'system' AND "decision_triage_events"."actor_agent_id" IS NULL AND "decision_triage_events"."actor_user_id" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "decision_training_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"notes_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision_outcome" text,
	"retention_policy" text DEFAULT 'scrub_deleted_comments_v1' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"origin_agent_id" uuid NOT NULL,
	"origin_issue_id" uuid NOT NULL,
	"origin_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_effect_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"effect_index" integer NOT NULL,
	"effect_type" text NOT NULL,
	"target_issue_id" uuid NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"result" jsonb,
	"error" text,
	"activity_log_id" uuid,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "decision_target_issues" (
	"decision_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	CONSTRAINT "decision_target_issues_decision_id_issue_id_pk" PRIMARY KEY("decision_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bundle_id" uuid,
	"origin_agent_id" uuid NOT NULL,
	"origin_issue_id" uuid NOT NULL,
	"origin_run_id" uuid NOT NULL,
	"rule_key" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"options" jsonb NOT NULL,
	"inputs" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"execution_status" text,
	"chosen_option_id" text,
	"input_values" jsonb,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"idempotency_key" text,
	"signed_spec" text NOT NULL,
	"target_snapshots" jsonb NOT NULL,
	"continuation_policy" text DEFAULT 'none' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_annotation_anchor_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"from_revision_id" uuid,
	"from_revision_number" integer,
	"to_revision_id" uuid,
	"to_revision_number" integer NOT NULL,
	"previous_anchor" jsonb NOT NULL,
	"next_anchor" jsonb,
	"anchor_state" text NOT NULL,
	"anchor_confidence" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_annotation_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"issue_id" uuid,
	"routine_id" uuid,
	"case_id" uuid,
	"document_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_type" text NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"created_by_run_id" uuid,
	"issue_comment_id" uuid,
	"source_trust" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_annotation_comments_exactly_one_owner_chk" CHECK (num_nonnulls("document_annotation_comments"."issue_id", "document_annotation_comments"."routine_id", "document_annotation_comments"."case_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "document_annotation_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid,
	"routine_id" uuid,
	"case_id" uuid,
	"document_id" uuid NOT NULL,
	"document_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"anchor_state" text DEFAULT 'active' NOT NULL,
	"original_revision_id" uuid,
	"original_revision_number" integer NOT NULL,
	"current_revision_id" uuid,
	"current_revision_number" integer NOT NULL,
	"selected_text" text NOT NULL,
	"prefix_text" text DEFAULT '' NOT NULL,
	"suffix_text" text DEFAULT '' NOT NULL,
	"normalized_start" integer NOT NULL,
	"normalized_end" integer NOT NULL,
	"markdown_start" integer NOT NULL,
	"markdown_end" integer NOT NULL,
	"anchor_confidence" text DEFAULT 'exact' NOT NULL,
	"anchor_selector" jsonb NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"resolved_by_agent_id" uuid,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_annotation_threads_exactly_one_owner_chk" CHECK (num_nonnulls("document_annotation_threads"."issue_id", "document_annotation_threads"."routine_id", "document_annotation_threads"."case_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "document_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"starred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"title" text,
	"format" text DEFAULT 'markdown' NOT NULL,
	"body" text NOT NULL,
	"change_summary" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text,
	"format" text DEFAULT 'markdown' NOT NULL,
	"latest_body" text NOT NULL,
	"latest_revision_id" uuid,
	"latest_revision_number" integer DEFAULT 1 NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"locked_at" timestamp with time zone,
	"locked_by_agent_id" uuid,
	"locked_by_user_id" text,
	"source_trust" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_custom_image_setup_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"template_id" uuid,
	"promoted_template_id" uuid,
	"provider" text NOT NULL,
	"provider_lease_id" text,
	"environment_lease_id" uuid,
	"status" text DEFAULT 'starting' NOT NULL,
	"started_by_user_id" text,
	"started_by_agent_id" uuid,
	"base_template_ref" text,
	"expires_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_reason" text,
	"connection_summary" jsonb,
	"connection_secret_ref" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_custom_image_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"template_kind" text DEFAULT 'unknown' NOT NULL,
	"template_ref" text NOT NULL,
	"source_template_ref" text,
	"source_environment_config_fingerprint" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"captured_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"superseded_by_template_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"environment_id" uuid,
	"execution_workspace_id" uuid,
	"issue_id" uuid,
	"heartbeat_run_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"lease_policy" text DEFAULT 'ephemeral' NOT NULL,
	"provider" text,
	"provider_lease_id" text,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"failure_reason" text,
	"cleanup_status" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"driver" text DEFAULT 'local' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"env_vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_workspace_runtime_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"execution_workspace_id" uuid NOT NULL,
	"owner_key" text NOT NULL,
	"owner_issue_id" uuid,
	"owner_run_id" uuid,
	"owner_agent_id" uuid,
	"last_action" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"renewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_workspace_runtime_leases_execution_workspace_id_unique" UNIQUE("execution_workspace_id")
);
--> statement-breakpoint
CREATE TABLE "execution_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_workspace_id" uuid,
	"source_issue_id" uuid,
	"mode" text NOT NULL,
	"strategy_type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cwd" text,
	"repo_url" text,
	"base_ref" text,
	"branch_name" text,
	"provider_type" text DEFAULT 'local_fs' NOT NULL,
	"provider_ref" text,
	"derived_from_execution_workspace_id" uuid,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"cleanup_eligible_at" timestamp with time zone,
	"cleanup_reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_object_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_issue_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_record_id" uuid,
	"document_key" text,
	"property_key" text,
	"matched_text_redacted" text,
	"sanitized_display_url" text,
	"canonical_identity_hash" text,
	"canonical_identity" jsonb,
	"object_id" uuid,
	"provider_key" text,
	"detector_key" text,
	"object_type" text,
	"confidence" text DEFAULT 'exact' NOT NULL,
	"created_by_plugin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"plugin_id" uuid,
	"object_type" text NOT NULL,
	"external_id" text NOT NULL,
	"sanitized_canonical_url" text,
	"canonical_identity_hash" text,
	"display_key" text,
	"icon_key" text,
	"display_title" text,
	"status_key" text,
	"status_label" text,
	"status_icon_key" text,
	"status_category" text DEFAULT 'unknown' NOT NULL,
	"status_tone" text DEFAULT 'neutral' NOT NULL,
	"liveness" text DEFAULT 'unknown' NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remote_version" text,
	"etag" text,
	"last_resolved_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"next_refresh_at" timestamp with time zone,
	"refresh_started_at" timestamp with time zone,
	"refresh_token" uuid,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_vote_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid,
	"author_user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"vote" text NOT NULL,
	"status" text DEFAULT 'local_only' NOT NULL,
	"destination" text,
	"export_id" text,
	"consent_version" text,
	"schema_version" text DEFAULT 'pilot-feedback-envelope-v2' NOT NULL,
	"bundle_version" text DEFAULT 'pilot-feedback-bundle-v2' NOT NULL,
	"payload_version" text DEFAULT 'pilot-feedback-v1' NOT NULL,
	"payload_digest" text,
	"payload_snapshot" jsonb,
	"target_summary" jsonb NOT NULL,
	"redaction_summary" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"exported_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"vote" text NOT NULL,
	"reason" text,
	"shared_with_labs" boolean DEFAULT false NOT NULL,
	"shared_at" timestamp with time zone,
	"consent_version" text,
	"redaction_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"issue_id" uuid,
	"project_id" uuid,
	"goal_id" uuid,
	"heartbeat_run_id" uuid,
	"cost_event_id" uuid,
	"billing_code" text,
	"description" text,
	"event_kind" text NOT NULL,
	"direction" text DEFAULT 'debit' NOT NULL,
	"biller" text NOT NULL,
	"provider" text,
	"execution_adapter_type" text,
	"pricing_tier" text,
	"region" text,
	"model" text,
	"quantity" integer,
	"unit" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"external_invoice_id" text,
	"metadata_json" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"system_key" text,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"level" text DEFAULT 'task' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"parent_id" uuid,
	"owner_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heartbeat_run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event_type" text NOT NULL,
	"stream" text,
	"level" text,
	"color" text,
	"message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heartbeat_run_watchdog_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"evaluation_issue_id" uuid,
	"decision" text NOT NULL,
	"snoozed_until" timestamp with time zone,
	"reason" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heartbeat_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"invocation_source" text DEFAULT 'on_demand' NOT NULL,
	"trigger_detail" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"responsible_user_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"wakeup_request_id" uuid,
	"exit_code" integer,
	"signal" text,
	"usage_json" jsonb,
	"result_json" jsonb,
	"session_id_before" text,
	"session_id_after" text,
	"log_store" text,
	"log_ref" text,
	"log_bytes" bigint,
	"log_sha256" text,
	"log_compressed" boolean DEFAULT false NOT NULL,
	"stdout_excerpt" text,
	"stderr_excerpt" text,
	"error_code" text,
	"external_run_id" text,
	"process_pid" integer,
	"process_group_id" integer,
	"process_started_at" timestamp with time zone,
	"last_output_at" timestamp with time zone,
	"last_output_seq" integer DEFAULT 0 NOT NULL,
	"last_output_stream" text,
	"last_output_bytes" bigint,
	"retry_of_run_id" uuid,
	"process_loss_retry_count" integer DEFAULT 0 NOT NULL,
	"scheduled_retry_at" timestamp with time zone,
	"scheduled_retry_attempt" integer DEFAULT 0 NOT NULL,
	"scheduled_retry_reason" text,
	"issue_comment_status" text DEFAULT 'not_applicable' NOT NULL,
	"issue_comment_satisfied_by_comment_id" uuid,
	"issue_comment_retry_queued_at" timestamp with time zone,
	"liveness_state" text,
	"liveness_reason" text,
	"continuation_attempt" integer DEFAULT 0 NOT NULL,
	"last_useful_action_at" timestamp with time zone,
	"next_action" text,
	"context_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"item_key" text NOT NULL,
	"kind" text DEFAULT 'dismiss' NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_user_id" text,
	"provider_tenant" jsonb,
	"credential_secret_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_agent_id" uuid,
	"revoked_by_user_id" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_grants_kind_check" CHECK ("connection_grants"."kind" in ('workspace', 'user')),
	CONSTRAINT "connection_grants_status_check" CHECK ("connection_grants"."status" in ('active', 'revoked', 'expired', 'needs_reauthorization')),
	CONSTRAINT "connection_grants_subject_check" CHECK (("connection_grants"."kind" = 'user' and "connection_grants"."subject_user_id" is not null) or ("connection_grants"."kind" = 'workspace' and "connection_grants"."subject_user_id" is null)),
	CONSTRAINT "connection_grants_default_check" CHECK ("connection_grants"."is_default" = false or "connection_grants"."kind" = 'workspace')
);
--> statement-breakpoint
CREATE TABLE "connection_token_issuances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"application_id" uuid,
	"connection_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid,
	"issue_id" uuid,
	"project_id" uuid,
	"responsible_user_id" text,
	"path" text NOT NULL,
	"requested_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issued_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ttl_seconds" integer,
	"expires_at" timestamp with time zone,
	"token_hash" text,
	"outcome" text NOT NULL,
	"error_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton_key" text DEFAULT 'default' NOT NULL,
	"default_environment_id" uuid,
	"general" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"experimental" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'instance_admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"invite_type" text DEFAULT 'company_join' NOT NULL,
	"token_hash" text NOT NULL,
	"allowed_join_types" text DEFAULT 'both' NOT NULL,
	"defaults_payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_approvals" (
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"linked_by_agent_id" uuid,
	"linked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_approvals_pk" PRIMARY KEY("issue_id","approval_id")
);
--> statement-breakpoint
CREATE TABLE "issue_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"issue_comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"on_behalf_of_user_id" text,
	"author_type" text,
	"created_by_run_id" uuid,
	"derived_author_agent_id" uuid,
	"derived_created_by_run_id" uuid,
	"derived_author_source" text,
	"body" text NOT NULL,
	"presentation" jsonb,
	"metadata" jsonb,
	"deleted_at" timestamp with time zone,
	"deleted_by_type" text,
	"deleted_by_agent_id" uuid,
	"deleted_by_user_id" text,
	"deleted_by_run_id" uuid,
	"source_trust" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_create_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_execution_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"stage_type" text NOT NULL,
	"actor_agent_id" uuid,
	"actor_user_id" text,
	"outcome" text NOT NULL,
	"body" text NOT NULL,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_inbox_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"archived_by_actor_type" text DEFAULT 'user' NOT NULL,
	"archived_by_agent_id" uuid,
	"archived_by_run_id" uuid,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_inbox_archives_archived_by_actor_type_check" CHECK ("issue_inbox_archives"."archived_by_actor_type" in ('user', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "issue_labels" (
	"issue_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_labels_pk" PRIMARY KEY("issue_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "issue_plan_decompositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_issue_id" uuid NOT NULL,
	"accepted_plan_revision_id" uuid NOT NULL,
	"accepted_interaction_id" uuid,
	"status" text DEFAULT 'in_flight' NOT NULL,
	"request_fingerprint" text NOT NULL,
	"requested_child_count" integer DEFAULT 0 NOT NULL,
	"requested_children" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"child_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_agent_id" uuid,
	"owner_user_id" text,
	"owner_run_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_read_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_recovery_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_issue_id" uuid NOT NULL,
	"recovery_issue_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_type" text DEFAULT 'agent' NOT NULL,
	"owner_agent_id" uuid,
	"owner_user_id" text,
	"previous_owner_agent_id" uuid,
	"return_owner_agent_id" uuid,
	"cause" text NOT NULL,
	"fingerprint" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_action" text NOT NULL,
	"wake_policy" jsonb,
	"monitor_policy" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer,
	"timeout_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"outcome" text,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_reference_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_issue_id" uuid NOT NULL,
	"target_issue_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_record_id" uuid,
	"document_key" text,
	"matched_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"related_issue_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_thread_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"continuation_policy" text DEFAULT 'wake_assignee' NOT NULL,
	"requested_resolver_policy" text DEFAULT 'anyone' NOT NULL,
	"effective_resolver_policy" text DEFAULT 'anyone' NOT NULL,
	"resolver_policy_provenance" text DEFAULT 'inherited' NOT NULL,
	"effective_resolver_policy_source" text DEFAULT 'requested' NOT NULL,
	"idempotency_key" text,
	"source_comment_id" uuid,
	"source_run_id" uuid,
	"title" text,
	"summary" text,
	"created_by_agent_id" uuid,
	"addressee_agent_id" uuid,
	"created_by_user_id" text,
	"resolved_by_agent_id" uuid,
	"resolved_by_run_id" uuid,
	"resolved_by_user_id" text,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_tree_hold_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"parent_issue_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"issue_identifier" text,
	"issue_title" text NOT NULL,
	"issue_status" text NOT NULL,
	"assignee_agent_id" uuid,
	"assignee_user_id" text,
	"active_run_id" uuid,
	"active_run_status" text,
	"skipped" boolean DEFAULT false NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_tree_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"root_issue_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"release_policy" jsonb,
	"created_by_actor_type" text DEFAULT 'system' NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"released_at" timestamp with time zone,
	"released_by_actor_type" text,
	"released_by_agent_id" uuid,
	"released_by_user_id" text,
	"released_by_run_id" uuid,
	"release_reason" text,
	"release_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_watchdogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"watchdog_agent_id" uuid NOT NULL,
	"instructions" text,
	"status" text DEFAULT 'active' NOT NULL,
	"watchdog_issue_id" uuid,
	"last_observed_fingerprint" text,
	"last_reviewed_fingerprint" text,
	"last_observed_stop_snapshot" jsonb,
	"last_reviewed_stop_snapshot" jsonb,
	"last_triggered_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"updated_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_work_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid NOT NULL,
	"execution_workspace_id" uuid,
	"runtime_service_id" uuid,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"url" text,
	"status" text NOT NULL,
	"review_state" text DEFAULT 'none' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"summary" text,
	"metadata" jsonb,
	"source_trust" jsonb,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"project_workspace_id" uuid,
	"goal_id" uuid,
	"parent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"work_mode" text DEFAULT 'standard' NOT NULL,
	"harness_kind" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"review_policy" text,
	"assignee_agent_id" uuid,
	"assignee_user_id" text,
	"checkout_run_id" uuid,
	"execution_run_id" uuid,
	"execution_agent_name_key" text,
	"execution_locked_at" timestamp with time zone,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"responsible_user_id" text,
	"issue_number" integer,
	"identifier" text,
	"origin_kind" text DEFAULT 'manual' NOT NULL,
	"origin_id" text,
	"origin_run_id" text,
	"origin_fingerprint" text DEFAULT 'default' NOT NULL,
	"request_depth" integer DEFAULT 0 NOT NULL,
	"billing_code" text,
	"assignee_adapter_overrides" jsonb,
	"execution_policy" jsonb,
	"execution_state" jsonb,
	"monitor_next_check_at" timestamp with time zone,
	"monitor_wake_requested_at" timestamp with time zone,
	"monitor_last_triggered_at" timestamp with time zone,
	"monitor_attempt_count" integer DEFAULT 0 NOT NULL,
	"monitor_notes" text,
	"monitor_scheduled_by" text,
	"execution_workspace_id" uuid,
	"execution_workspace_preference" text,
	"execution_workspace_settings" jsonb,
	"source_trust" jsonb,
	"unblock_descriptor" jsonb,
	"blocked_transition_at" timestamp with time zone,
	"blocked_owner_notified_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"request_ip" text NOT NULL,
	"requesting_user_id" text,
	"request_email_snapshot" text,
	"agent_name" text,
	"adapter_type" text,
	"capabilities" text,
	"agent_defaults_payload" jsonb,
	"claim_secret_hash" text,
	"claim_secret_expires_at" timestamp with time zone,
	"claim_secret_consumed_at" timestamp with time zone,
	"created_agent_id" uuid,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"rejected_by_user_id" text,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_automation_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"automation_id" text NOT NULL,
	"triggering_event_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"status" text NOT NULL,
	"execution_issue_id" uuid,
	"retry_of_execution_id" uuid,
	"generation" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_automation_executions_status_check" CHECK ("pipeline_automation_executions"."status" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_case_blockers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"blocked_by_case_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_case_blockers_no_self_block_check" CHECK ("pipeline_case_blockers"."case_id" <> "pipeline_case_blockers"."blocked_by_case_id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_case_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_agent_id" uuid,
	"run_id" uuid,
	"from_stage_id" uuid,
	"to_stage_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_case_events_type_check" CHECK ("pipeline_case_events"."type" in (
        'ingested',
        'updated',
        'claimed',
        'lease_released',
        'lease_expired',
        'transitioned',
        'transition_forced',
        'transition_suggested',
        'suggestion_resolved',
        'review_decided',
        'conversation_opened',
        'issue_linked',
        'issue_unlinked',
        'automation_executed',
        'automation_failed',
        'automation_retry_requested',
        'automation_effects_retired',
        'automation_retry_dispatched',
        'blockers_set',
        'blockers_resolved',
        'children_terminal',
        'upstream_drift',
        'drift_acknowledged'
      )),
	CONSTRAINT "pipeline_case_events_actor_type_check" CHECK ("pipeline_case_events"."actor_type" in ('user', 'agent', 'system')),
	CONSTRAINT "pipeline_case_events_agent_run_check" CHECK ("pipeline_case_events"."actor_type" <> 'agent' or "pipeline_case_events"."run_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "pipeline_case_issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_by_run_id" uuid,
	"automation_attempt_id" uuid,
	"retired_at" timestamp with time zone,
	"retired_by_attempt_id" uuid,
	"retired_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_case_issue_links_role_check" CHECK ("pipeline_case_issue_links"."role" in ('origin', 'conversation', 'work', 'automation'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"case_key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workspace_ref" jsonb,
	"parent_case_id" uuid,
	"parent_case_version" integer,
	"request_key" text,
	"automation_attempt_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"pending_suggestion" jsonb,
	"lease_owner_type" text,
	"lease_agent_id" uuid,
	"lease_user_id" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"terminal_kind" text,
	"terminal_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"retired_by_attempt_id" uuid,
	"retired_reason" text,
	"hidden_from_board_at" timestamp with time zone,
	"child_count" integer DEFAULT 0 NOT NULL,
	"terminal_child_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"origin_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_cases_terminal_kind_check" CHECK ("pipeline_cases"."terminal_kind" is null or "pipeline_cases"."terminal_kind" in ('done', 'cancelled')),
	CONSTRAINT "pipeline_cases_lease_owner_type_check" CHECK ("pipeline_cases"."lease_owner_type" is null or "pipeline_cases"."lease_owner_type" in ('user', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_kind_check" CHECK ("pipeline_stages"."kind" in ('working', 'review', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"from_stage_id" uuid NOT NULL,
	"to_stage_id" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enforce_transitions" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plugin_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_database_namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"namespace_name" text NOT NULL,
	"namespace_mode" text DEFAULT 'schema' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"company_id" uuid,
	"entity_type" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text,
	"external_id" text,
	"title" text,
	"status" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_entities_external_idx" UNIQUE NULLS NOT DISTINCT("company_id","plugin_id","entity_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "plugin_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"plugin_id" uuid NOT NULL,
	"company_id" uuid,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"duration_ms" integer,
	"error" text,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"job_key" text NOT NULL,
	"schedule" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"company_id" uuid,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_managed_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plugin_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_key" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"defaults_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"namespace_name" text NOT NULL,
	"migration_key" text NOT NULL,
	"checksum" text NOT NULL,
	"plugin_version" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "plugin_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text,
	"namespace" text DEFAULT 'default' NOT NULL,
	"state_key" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_state_unique_entry_idx" UNIQUE NULLS NOT DISTINCT("plugin_id","scope_kind","scope_id","namespace","state_key")
);
--> statement-breakpoint
CREATE TABLE "plugin_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"company_id" uuid,
	"webhook_key" text NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"duration_ms" integer,
	"error" text,
	"payload" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_key" text NOT NULL,
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"api_version" integer DEFAULT 1 NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"status" text DEFAULT 'installed' NOT NULL,
	"install_order" integer,
	"package_path" text,
	"last_error" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principal_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"permission_key" text NOT NULL,
	"scope" jsonb,
	"granted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_goals" (
	"project_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_goals_project_id_goal_id_pk" PRIMARY KEY("project_id","goal_id")
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" text DEFAULT 'joined' NOT NULL,
	"starred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_type" text DEFAULT 'local_path' NOT NULL,
	"cwd" text,
	"repo_url" text,
	"repo_ref" text,
	"default_ref" text,
	"visibility" text DEFAULT 'default' NOT NULL,
	"setup_command" text,
	"cleanup_command" text,
	"remote_provider" text,
	"remote_workspace_ref" text,
	"shared_workspace_key" text,
	"metadata" jsonb,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"goal_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"lead_agent_id" uuid,
	"target_date" date,
	"color" text,
	"icon" text,
	"env" jsonb,
	"pause_reason" text,
	"paused_at" timestamp with time zone,
	"execution_workspace_policy" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"restored_from_revision_id" uuid,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"responsible_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"trigger_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"routine_revision_id" uuid,
	"responsible_user_id" text,
	"idempotency_key" text,
	"trigger_payload" jsonb,
	"dispatch_fingerprint" text,
	"linked_issue_id" uuid,
	"coalesced_into_run_id" uuid,
	"failure_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"cron_expression" text,
	"timezone" text,
	"next_run_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"public_id" text,
	"secret_id" uuid,
	"signing_mode" text,
	"replay_window_sec" integer,
	"last_rotated_at" timestamp with time zone,
	"last_result" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"folder_id" uuid,
	"goal_id" uuid,
	"parent_issue_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assignee_agent_id" uuid,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"concurrency_policy" text DEFAULT 'coalesce_if_active' NOT NULL,
	"catch_up_policy" text DEFAULT 'skip_missed' NOT NULL,
	"activity_gate_policy" text DEFAULT 'always' NOT NULL,
	"activity_gate_scope" text DEFAULT 'company' NOT NULL,
	"origin_kind" text DEFAULT 'manual' NOT NULL,
	"origin_id" text,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env" jsonb,
	"latest_revision_id" uuid,
	"latest_revision_number" integer DEFAULT 1 NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"responsible_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"last_triggered_at" timestamp with time zone,
	"last_enqueued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"secret_id" uuid,
	"user_secret_definition_id" uuid,
	"secret_scope" text DEFAULT 'company' NOT NULL,
	"version" integer,
	"provider" text NOT NULL,
	"responsible_user_id" text,
	"credential_owner_user_id" text,
	"credential_subject_type" text,
	"credential_subject_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"consumer_type" text NOT NULL,
	"consumer_id" text NOT NULL,
	"config_path" text,
	"issue_id" uuid,
	"heartbeat_run_id" uuid,
	"plugin_id" uuid,
	"outcome" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smoke_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"path" text NOT NULL,
	"scenario_step" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"screenshot_artifact_ref" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smoke_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_card_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"generation_issue_id" uuid,
	"run_id" uuid,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"model" text,
	"query_version" integer,
	"change_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "status_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"title" text,
	"title_pinned" boolean DEFAULT false NOT NULL,
	"interest_prompt" text NOT NULL,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"query_version" integer DEFAULT 0 NOT NULL,
	"query_compiled_at" timestamp with time zone,
	"query_compiled_by_agent_id" uuid,
	"agent_id" uuid,
	"refresh_policy" jsonb NOT NULL,
	"state" text DEFAULT 'compiling' NOT NULL,
	"pending_change_count" integer DEFAULT 0 NOT NULL,
	"pending_change_hash" text,
	"last_change_at" timestamp with time zone,
	"fingerprint" jsonb,
	"fingerprint_at" timestamp with time zone,
	"mentioned_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_id" uuid,
	"last_update_run_kind" text,
	"last_generated_at" timestamp with time zone,
	"last_model" text,
	"generating_issue_id" uuid,
	"failure_reason" text,
	"next_eval_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" text,
	"archived_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" uuid,
	"slot_key" text NOT NULL,
	"document_id" uuid,
	"status" text DEFAULT 'idle' NOT NULL,
	"failure_reason" text,
	"generating_issue_id" uuid,
	"last_generated_at" timestamp with time zone,
	"last_generated_by_agent_id" uuid,
	"last_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_slots_company_scope_slot_uq" UNIQUE NULLS NOT DISTINCT("company_id","scope_kind","scope_id","slot_key")
);
--> statement-breakpoint
CREATE TABLE "tool_access_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway_id" uuid,
	"gateway_token_id" uuid,
	"gateway_public_id" text,
	"client_name" text,
	"correlation_id" text,
	"connection_id" uuid,
	"catalog_entry_id" uuid,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_action_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"issue_id" uuid,
	"interaction_id" uuid,
	"approval_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"canonical_arguments_hash" text NOT NULL,
	"canonical_arguments_summary" jsonb NOT NULL,
	"signed_arguments" text,
	"preview_markdown" text,
	"requested_by_agent_id" uuid,
	"requested_by_user_id" text,
	"resolved_by_agent_id" uuid,
	"resolved_by_user_id" text,
	"decided_by_agent_id" uuid,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"application_key" text,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"plugin_id" uuid,
	"owner_agent_id" uuid,
	"owner_user_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"agent_id" uuid,
	"run_id" uuid,
	"issue_id" uuid,
	"gateway_id" uuid,
	"gateway_token_id" uuid,
	"gateway_public_id" text,
	"client_subject_type" text,
	"client_subject_id" text,
	"client_name" text,
	"mcp_session_id" text,
	"correlation_id" text,
	"application_id" uuid,
	"connection_id" uuid,
	"catalog_entry_id" uuid,
	"invocation_id" uuid,
	"action_request_id" uuid,
	"runtime_slot_id" uuid,
	"tool_name" text,
	"decision" text,
	"matched_policy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_code" text,
	"policy_explanation" jsonb,
	"credential_scope_summary" jsonb,
	"header_policy_summary" jsonb,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"latency_ms" integer,
	"arguments_summary" jsonb,
	"request_hash" text,
	"request_summary" jsonb,
	"result_hash" text,
	"result_summary" jsonb,
	"result_size_bytes" integer,
	"redaction_plan" jsonb,
	"rate_limit_state" jsonb,
	"metadata" jsonb,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_catalog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"application_id" uuid,
	"connection_id" uuid NOT NULL,
	"entry_kind" text DEFAULT 'tool' NOT NULL,
	"name" text NOT NULL,
	"tool_name" text NOT NULL,
	"title" text,
	"description" text,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_level" text DEFAULT 'read' NOT NULL,
	"is_read_only" boolean DEFAULT true NOT NULL,
	"is_write" boolean DEFAULT false NOT NULL,
	"is_destructive" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" text,
	"version_hash" text NOT NULL,
	"schema_hash" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_agent_id" uuid,
	"reviewed_by_user_id" text,
	"quarantined_at" timestamp with time zone,
	"quarantine_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_connection_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_connection_installs_target_type_check" CHECK ("tool_connection_installs"."target_type" in ('company', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "tool_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"uid" text NOT NULL,
	"connection_kind" text DEFAULT 'managed' NOT NULL,
	"ownership" text DEFAULT 'customer' NOT NULL,
	"transport" text NOT NULL,
	"auth_kind" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transport_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credential_secret_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"health_status" text DEFAULT 'unchecked' NOT NULL,
	"health_message" text,
	"health_checked_at" timestamp with time zone,
	"last_health_at" timestamp with time zone,
	"last_catalog_refresh_at" timestamp with time zone,
	"last_error" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_connections_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "tool_connections_ownership_check" CHECK ("tool_connections"."ownership" in ('platform_shared', 'platform_provisioned', 'customer', 'dcr')),
	CONSTRAINT "tool_connections_transport_check" CHECK ("tool_connections"."transport" in ('mcp_remote', 'rest_api', 'local_stdio')),
	CONSTRAINT "tool_connections_auth_kind_check" CHECK ("tool_connections"."auth_kind" in ('oauth', 'api_key', 'none'))
);
--> statement-breakpoint
CREATE TABLE "tool_gateway_rate_limit_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"counter_key" text NOT NULL,
	"window_start_at" timestamp with time zone NOT NULL,
	"window_ms" integer NOT NULL,
	"limit" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_gateway_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"issue_id" uuid,
	"project_id" uuid,
	"gateway_id" uuid,
	"gateway_token_id" uuid,
	"gateway_public_id" text,
	"client_subject_type" text,
	"client_subject_id" text,
	"client_name" text,
	"mcp_session_id" text,
	"correlation_id" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"idempotency_key" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"agent_id" uuid,
	"issue_id" uuid,
	"run_id" uuid,
	"gateway_id" uuid,
	"gateway_token_id" uuid,
	"gateway_public_id" text,
	"client_subject_type" text,
	"client_subject_id" text,
	"client_name" text,
	"mcp_session_id" text,
	"correlation_id" text,
	"application_id" uuid,
	"connection_id" uuid,
	"catalog_entry_id" uuid,
	"catalog_version_hash" text,
	"catalog_schema_hash" text,
	"provider_type" text,
	"application_key" text,
	"upstream_tool_name" text,
	"risk_level" text,
	"tool_name" text NOT NULL,
	"arguments_hash" text,
	"arguments_summary" jsonb,
	"policy_decision" text,
	"matched_policy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_explanation" jsonb,
	"credential_scope_summary" jsonb,
	"header_policy_summary" jsonb,
	"approval_state" text DEFAULT 'not_required' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"upstream_request_id" text,
	"result_hash" text,
	"result_summary" jsonb,
	"result_size_bytes" integer,
	"result_artifact_id" uuid,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_mcp_gateway_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text DEFAULT '' NOT NULL,
	"subject_type" text DEFAULT 'gateway_client' NOT NULL,
	"subject_id" text,
	"client_label" text DEFAULT '' NOT NULL,
	"owner_note" text DEFAULT '' NOT NULL,
	"allowed_actions" jsonb DEFAULT '["tools/list","tools/call"]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"expiry_override_reason" text,
	"expiry_override_by_user_id" text,
	"expiry_override_by_agent_id" uuid,
	"expiry_override_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_mcp_gateways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway_public_id" text DEFAULT 'gw_' || replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"display_slug" text DEFAULT '' NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"profile_id" uuid NOT NULL,
	"default_profile_mode" text DEFAULT 'gateway_only' NOT NULL,
	"context_scope_type" text DEFAULT 'none' NOT NULL,
	"context_scope_id" text,
	"agent_id" uuid,
	"project_id" uuid,
	"issue_id" uuid,
	"approval_issue_id" uuid,
	"auth_config" jsonb DEFAULT '{"version":1,"bearer":{"enabled":true,"tokenPrefix":"pilotgw","defaultTtlSeconds":7776000,"requireFiniteExpiry":true,"longLivedTokenRequiresOverride":true},"oauth":{"enabled":false,"reservedFor":"v1_5","dynamicClientRegistration":false,"authorizationCodePkce":false}}'::jsonb NOT NULL,
	"header_policy" jsonb DEFAULT '{"version":1,"callerPassthrough":{"enabled":false,"allowedHeaders":[]},"staticHeaders":[],"generatedMetadata":{"enabled":false,"allowedHeaders":[]},"responseHeaders":{"forwardMcpRequiredHeaders":true,"forwardSafeCacheHeaders":true}}'::jsonb NOT NULL,
	"metadata_policy" jsonb DEFAULT '{"version":1,"forwardCompanyId":false,"forwardGatewayId":false,"forwardProjectId":false,"forwardIssueId":false,"forwardAgentId":false,"forwardRunId":false,"forwardCorrelationId":true}'::jsonb NOT NULL,
	"on_demand_tools_config" jsonb DEFAULT '{"enabled":false,"searchToolName":"search_tools","runToolName":"run_tool"}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"code_verifier" text NOT NULL,
	"created_by_actor_type" text,
	"created_by_actor_id" text,
	"created_by_session_id" text,
	"subject_user_id" text,
	"requested_scopes" jsonb,
	"return_to" text,
	"issue_id" uuid,
	"interaction_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"policy_type" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"selectors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conditions" jsonb,
	"config" jsonb,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_profile_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_profile_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"selector_type" text NOT NULL,
	"effect" text DEFAULT 'include' NOT NULL,
	"application_id" uuid,
	"connection_id" uuid,
	"catalog_entry_id" uuid,
	"tool_name" text,
	"risk_level" text,
	"conditions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"default_action" text DEFAULT 'deny' NOT NULL,
	"new_tools_reviewed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_rate_limit_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"counter_key" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"window_kind" text NOT NULL,
	"window_start_at" timestamp with time zone NOT NULL,
	"limit" integer NOT NULL,
	"remaining" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_runtime_metric_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"bucket_start_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_runtime_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"application_id" uuid,
	"connection_id" uuid,
	"project_workspace_id" uuid,
	"execution_workspace_id" uuid,
	"issue_id" uuid,
	"owner_scope_type" text DEFAULT 'connection' NOT NULL,
	"owner_scope_id" text,
	"runtime_kind" text DEFAULT 'local_stdio' NOT NULL,
	"slot_key" text NOT NULL,
	"status" text DEFAULT 'stopped' NOT NULL,
	"reuse_key" text,
	"workspace_scope" text,
	"credential_scope_hash" text,
	"provider" text,
	"provider_ref" text,
	"process_id" integer,
	"command_template_key" text,
	"health_status" text DEFAULT 'unchecked' NOT NULL,
	"health_message" text,
	"last_health_check_at" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"idle_expires_at" timestamp with time zone,
	"idle_deadline_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_stdio_command_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"command" text NOT NULL,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_inbox_agent_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"mode" text DEFAULT 'open' NOT NULL,
	"allowed_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_inbox_agent_policies_mode_check" CHECK ("user_inbox_agent_policies"."mode" in ('open', 'allowlist', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "user_secret_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_secret_definition_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"config_path" text NOT NULL,
	"env_key" text NOT NULL,
	"version_selector" text DEFAULT 'latest' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"allow_missing_override" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_secret_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" text DEFAULT 'local_encrypted' NOT NULL,
	"managed_mode" text DEFAULT 'pilot_managed' NOT NULL,
	"provider_config_id" uuid,
	"provider_metadata" jsonb,
	"usage_guidance" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sidebar_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"execution_workspace_id" uuid,
	"heartbeat_run_id" uuid,
	"issue_id" uuid,
	"phase" text NOT NULL,
	"command" text,
	"cwd" text,
	"status" text DEFAULT 'running' NOT NULL,
	"exit_code" integer,
	"log_store" text,
	"log_ref" text,
	"log_bytes" bigint,
	"log_sha256" text,
	"log_compressed" boolean DEFAULT false NOT NULL,
	"stdout_excerpt" text,
	"stderr_excerpt" text,
	"metadata" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_runtime_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"project_workspace_id" uuid,
	"execution_workspace_id" uuid,
	"issue_id" uuid,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"service_name" text NOT NULL,
	"status" text NOT NULL,
	"lifecycle" text NOT NULL,
	"reuse_key" text,
	"command" text,
	"cwd" text,
	"port" integer,
	"url" text,
	"provider" text NOT NULL,
	"provider_ref" text,
	"owner_agent_id" uuid,
	"started_by_run_id" uuid,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"stop_policy" jsonb,
	"exposure" jsonb,
	"exposure_handle" text,
	"backend_url" text,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adapter_auth_sessions" ADD CONSTRAINT "adapter_auth_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adapter_auth_sessions" ADD CONSTRAINT "adapter_auth_sessions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_revisions" ADD CONSTRAINT "agent_config_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_revisions" ADD CONSTRAINT "agent_config_revisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_revisions" ADD CONSTRAINT "agent_config_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memberships" ADD CONSTRAINT "agent_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memberships" ADD CONSTRAINT "agent_memberships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_last_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_reports_to_agents_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_default_environment_id_environments_id_fk" FOREIGN KEY ("default_environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_api_keys" ADD CONSTRAINT "board_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_incidents" ADD CONSTRAINT "budget_incidents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_incidents" ADD CONSTRAINT "budget_incidents_policy_id_budget_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."budget_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_incidents" ADD CONSTRAINT "budget_incidents_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "built_in_managed_resources" ADD CONSTRAINT "built_in_managed_resources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_issue_links" ADD CONSTRAINT "case_issue_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_issue_links" ADD CONSTRAINT "case_issue_links_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_issue_links" ADD CONSTRAINT "case_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_labels" ADD CONSTRAINT "case_labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_labels" ADD CONSTRAINT "case_labels_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_labels" ADD CONSTRAINT "case_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_parent_case_id_cases_id_fk" FOREIGN KEY ("parent_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_auth_challenges" ADD CONSTRAINT "cli_auth_challenges_requested_company_id_companies_id_fk" FOREIGN KEY ("requested_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_auth_challenges" ADD CONSTRAINT "cli_auth_challenges_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_auth_challenges" ADD CONSTRAINT "cli_auth_challenges_board_api_key_id_board_api_keys_id_fk" FOREIGN KEY ("board_api_key_id") REFERENCES "public"."board_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_logos" ADD CONSTRAINT "company_logos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_logos" ADD CONSTRAINT "company_logos_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_onboarding_seeds" ADD CONSTRAINT "company_onboarding_seeds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_onboarding_seeds" ADD CONSTRAINT "company_onboarding_seeds_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_onboarding_seeds" ADD CONSTRAINT "company_onboarding_seeds_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_onboarding_seeds" ADD CONSTRAINT "company_onboarding_seeds_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_bindings" ADD CONSTRAINT "company_secret_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_bindings" ADD CONSTRAINT "company_secret_bindings_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_secret_proposal_id_company_secret_proposals_id_fk" FOREIGN KEY ("secret_proposal_id") REFERENCES "public"."company_secret_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_target_id_agents_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_proposed_by_agent_id_agents_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_origin_issue_id_issues_id_fk" FOREIGN KEY ("origin_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_origin_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("origin_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_interaction_id_issue_thread_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."issue_thread_interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_created_secret_id_company_secrets_id_fk" FOREIGN KEY ("created_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_provider_configs" ADD CONSTRAINT "company_secret_provider_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_provider_configs" ADD CONSTRAINT "company_secret_provider_configs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_versions" ADD CONSTRAINT "company_secret_versions_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_versions" ADD CONSTRAINT "company_secret_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD CONSTRAINT "company_secrets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD CONSTRAINT "company_secrets_user_secret_definition_id_user_secret_definitions_id_fk" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD CONSTRAINT "company_secrets_provider_config_id_company_secret_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."company_secret_provider_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD CONSTRAINT "company_secrets_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_policies" ADD CONSTRAINT "company_skill_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_comments" ADD CONSTRAINT "company_skill_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_comments" ADD CONSTRAINT "company_skill_comments_company_skill_id_company_skills_id_fk" FOREIGN KEY ("company_skill_id") REFERENCES "public"."company_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_comments" ADD CONSTRAINT "company_skill_comments_parent_comment_id_company_skill_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."company_skill_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_comments" ADD CONSTRAINT "company_skill_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_stars" ADD CONSTRAINT "company_skill_stars_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_stars" ADD CONSTRAINT "company_skill_stars_company_skill_id_company_skills_id_fk" FOREIGN KEY ("company_skill_id") REFERENCES "public"."company_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_stars" ADD CONSTRAINT "company_skill_stars_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_inputs" ADD CONSTRAINT "company_skill_test_inputs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_inputs" ADD CONSTRAINT "company_skill_test_inputs_skill_id_company_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."company_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_run_templates" ADD CONSTRAINT "company_skill_test_run_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_run_templates" ADD CONSTRAINT "company_skill_test_run_templates_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_run_templates" ADD CONSTRAINT "company_skill_test_run_templates_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_skill_id_company_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."company_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_input_id_company_skill_test_inputs_id_fk" FOREIGN KEY ("input_id") REFERENCES "public"."company_skill_test_inputs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_skill_version_id_company_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_versions" ADD CONSTRAINT "company_skill_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_versions" ADD CONSTRAINT "company_skill_versions_company_skill_id_company_skills_id_fk" FOREIGN KEY ("company_skill_id") REFERENCES "public"."company_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skill_versions" ADD CONSTRAINT "company_skill_versions_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_forked_from_skill_id_company_skills_id_fk" FOREIGN KEY ("forked_from_skill_id") REFERENCES "public"."company_skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_forked_from_company_id_companies_id_fk" FOREIGN KEY ("forked_from_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_skills" ADD CONSTRAINT "company_skills_current_version_id_company_skill_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_transfer_runs" ADD CONSTRAINT "company_transfer_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_user_sidebar_preferences" ADD CONSTRAINT "company_user_sidebar_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_archive_notification_outbox" ADD CONSTRAINT "decision_archive_notification_outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_archive_notification_outbox" ADD CONSTRAINT "decision_archive_notification_outbox_origin_agent_id_agents_id_fk" FOREIGN KEY ("origin_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queue_items" ADD CONSTRAINT "decision_queue_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queue_items" ADD CONSTRAINT "decision_queue_items_added_by_agent_id_agents_id_fk" FOREIGN KEY ("added_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queue_items" ADD CONSTRAINT "decision_queue_items_added_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("added_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queue_items" ADD CONSTRAINT "decision_queue_items_added_by_agent_api_key_id_agent_api_keys_id_fk" FOREIGN KEY ("added_by_agent_api_key_id") REFERENCES "public"."agent_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queue_items" ADD CONSTRAINT "decision_queue_items_queue_company_fk" FOREIGN KEY ("queue_id","company_id") REFERENCES "public"."decision_queues"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queues" ADD CONSTRAINT "decision_queues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queues" ADD CONSTRAINT "decision_queues_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queues" ADD CONSTRAINT "decision_queues_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_queues" ADD CONSTRAINT "decision_queues_created_by_agent_api_key_id_agent_api_keys_id_fk" FOREIGN KEY ("created_by_agent_api_key_id") REFERENCES "public"."agent_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_retention" ADD CONSTRAINT "decision_retention_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_retention" ADD CONSTRAINT "decision_retention_archived_by_agent_id_agents_id_fk" FOREIGN KEY ("archived_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_retention" ADD CONSTRAINT "decision_retention_archived_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("archived_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage" ADD CONSTRAINT "decision_triage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage" ADD CONSTRAINT "decision_triage_set_by_agent_id_agents_id_fk" FOREIGN KEY ("set_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage" ADD CONSTRAINT "decision_triage_set_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("set_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage" ADD CONSTRAINT "decision_triage_set_by_agent_api_key_id_agent_api_keys_id_fk" FOREIGN KEY ("set_by_agent_api_key_id") REFERENCES "public"."agent_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage_events" ADD CONSTRAINT "decision_triage_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage_events" ADD CONSTRAINT "decision_triage_events_queue_id_decision_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."decision_queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage_events" ADD CONSTRAINT "decision_triage_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage_events" ADD CONSTRAINT "decision_triage_events_actor_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("actor_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_triage_events" ADD CONSTRAINT "decision_triage_events_agent_api_key_id_agent_api_keys_id_fk" FOREIGN KEY ("agent_api_key_id") REFERENCES "public"."agent_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_training_examples" ADD CONSTRAINT "decision_training_examples_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_training_examples" ADD CONSTRAINT "decision_training_examples_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_bundles" ADD CONSTRAINT "decision_bundles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_bundles" ADD CONSTRAINT "decision_bundles_origin_agent_id_agents_id_fk" FOREIGN KEY ("origin_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_bundles" ADD CONSTRAINT "decision_bundles_origin_issue_id_issues_id_fk" FOREIGN KEY ("origin_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_bundles" ADD CONSTRAINT "decision_bundles_origin_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("origin_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_effect_executions" ADD CONSTRAINT "decision_effect_executions_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_effect_executions" ADD CONSTRAINT "decision_effect_executions_target_issue_id_issues_id_fk" FOREIGN KEY ("target_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_effect_executions" ADD CONSTRAINT "decision_effect_executions_activity_log_id_activity_log_id_fk" FOREIGN KEY ("activity_log_id") REFERENCES "public"."activity_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_target_issues" ADD CONSTRAINT "decision_target_issues_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_target_issues" ADD CONSTRAINT "decision_target_issues_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_target_issues" ADD CONSTRAINT "decision_target_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_bundle_id_decision_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."decision_bundles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_agent_id_agents_id_fk" FOREIGN KEY ("origin_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_issue_id_issues_id_fk" FOREIGN KEY ("origin_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("origin_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_thread_id_document_annotation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."document_annotation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_from_revision_id_document_revisions_id_fk" FOREIGN KEY ("from_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_to_revision_id_document_revisions_id_fk" FOREIGN KEY ("to_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_thread_id_document_annotation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."document_annotation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_issue_comment_id_issue_comments_id_fk" FOREIGN KEY ("issue_comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_original_revision_id_document_revisions_id_fk" FOREIGN KEY ("original_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_current_revision_id_document_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_memberships" ADD CONSTRAINT "document_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_memberships" ADD CONSTRAINT "document_memberships_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_locked_by_agent_id_agents_id_fk" FOREIGN KEY ("locked_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_template_id_environment_custom_image_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."environment_custom_image_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_promoted_template_id_environment_custom_image_templates_id_fk" FOREIGN KEY ("promoted_template_id") REFERENCES "public"."environment_custom_image_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_environment_lease_id_environment_leases_id_fk" FOREIGN KEY ("environment_lease_id") REFERENCES "public"."environment_leases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_started_by_agent_id_agents_id_fk" FOREIGN KEY ("started_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_templates" ADD CONSTRAINT "environment_custom_image_templates_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_templates" ADD CONSTRAINT "environment_custom_image_templates_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_templates" ADD CONSTRAINT "environment_custom_image_templates_superseded_by_template_id_environment_custom_image_templates_id_fk" FOREIGN KEY ("superseded_by_template_id") REFERENCES "public"."environment_custom_image_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspace_runtime_leases" ADD CONSTRAINT "execution_workspace_runtime_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspace_runtime_leases" ADD CONSTRAINT "execution_workspace_runtime_leases_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspace_runtime_leases" ADD CONSTRAINT "execution_workspace_runtime_leases_owner_issue_id_issues_id_fk" FOREIGN KEY ("owner_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspace_runtime_leases" ADD CONSTRAINT "execution_workspace_runtime_leases_owner_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("owner_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspace_runtime_leases" ADD CONSTRAINT "execution_workspace_runtime_leases_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_project_workspace_id_project_workspaces_id_fk" FOREIGN KEY ("project_workspace_id") REFERENCES "public"."project_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_derived_from_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("derived_from_execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_mentions" ADD CONSTRAINT "external_object_mentions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_mentions" ADD CONSTRAINT "external_object_mentions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_mentions" ADD CONSTRAINT "external_object_mentions_object_id_external_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."external_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_mentions" ADD CONSTRAINT "external_object_mentions_created_by_plugin_id_plugins_id_fk" FOREIGN KEY ("created_by_plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_objects" ADD CONSTRAINT "external_objects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_objects" ADD CONSTRAINT "external_objects_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_exports" ADD CONSTRAINT "feedback_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_exports" ADD CONSTRAINT "feedback_exports_feedback_vote_id_feedback_votes_id_fk" FOREIGN KEY ("feedback_vote_id") REFERENCES "public"."feedback_votes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_exports" ADD CONSTRAINT "feedback_exports_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_exports" ADD CONSTRAINT "feedback_exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_cost_event_id_cost_events_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_id_goals_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_events" ADD CONSTRAINT "heartbeat_run_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_events" ADD CONSTRAINT "heartbeat_run_events_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_events" ADD CONSTRAINT "heartbeat_run_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_evaluation_issue_id_issues_id_fk" FOREIGN KEY ("evaluation_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_wakeup_request_id_agent_wakeup_requests_id_fk" FOREIGN KEY ("wakeup_request_id") REFERENCES "public"."agent_wakeup_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_retry_of_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_dismissals" ADD CONSTRAINT "inbox_dismissals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_grants" ADD CONSTRAINT "connection_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_grants" ADD CONSTRAINT "connection_grants_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_grants" ADD CONSTRAINT "connection_grants_revoked_by_agent_id_agents_id_fk" FOREIGN KEY ("revoked_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_grants" ADD CONSTRAINT "connection_grants_company_connection_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."tool_connections"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_default_environment_id_environments_id_fk" FOREIGN KEY ("default_environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_approvals" ADD CONSTRAINT "issue_approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_approvals" ADD CONSTRAINT "issue_approvals_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_approvals" ADD CONSTRAINT "issue_approvals_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_approvals" ADD CONSTRAINT "issue_approvals_linked_by_agent_id_agents_id_fk" FOREIGN KEY ("linked_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD CONSTRAINT "issue_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD CONSTRAINT "issue_attachments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD CONSTRAINT "issue_attachments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD CONSTRAINT "issue_attachments_issue_comment_id_issue_comments_id_fk" FOREIGN KEY ("issue_comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_on_behalf_of_user_id_user_id_fk" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_derived_author_agent_id_agents_id_fk" FOREIGN KEY ("derived_author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_derived_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("derived_created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_deleted_by_agent_id_agents_id_fk" FOREIGN KEY ("deleted_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_deleted_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("deleted_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_create_idempotency_keys" ADD CONSTRAINT "issue_create_idempotency_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_create_idempotency_keys" ADD CONSTRAINT "issue_create_idempotency_keys_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_documents" ADD CONSTRAINT "issue_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_documents" ADD CONSTRAINT "issue_documents_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_documents" ADD CONSTRAINT "issue_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_execution_decisions" ADD CONSTRAINT "issue_execution_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_execution_decisions" ADD CONSTRAINT "issue_execution_decisions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_execution_decisions" ADD CONSTRAINT "issue_execution_decisions_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_execution_decisions" ADD CONSTRAINT "issue_execution_decisions_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_archived_by_agent_id_agents_id_fk" FOREIGN KEY ("archived_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_archived_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("archived_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_accepted_plan_revision_id_document_revisions_id_fk" FOREIGN KEY ("accepted_plan_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_accepted_interaction_id_issue_thread_interactions_id_fk" FOREIGN KEY ("accepted_interaction_id") REFERENCES "public"."issue_thread_interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_owner_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("owner_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_read_states" ADD CONSTRAINT "issue_read_states_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_read_states" ADD CONSTRAINT "issue_read_states_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_recovery_issue_id_issues_id_fk" FOREIGN KEY ("recovery_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_previous_owner_agent_id_agents_id_fk" FOREIGN KEY ("previous_owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_return_owner_agent_id_agents_id_fk" FOREIGN KEY ("return_owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference_mentions" ADD CONSTRAINT "issue_reference_mentions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference_mentions" ADD CONSTRAINT "issue_reference_mentions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference_mentions" ADD CONSTRAINT "issue_reference_mentions_target_issue_id_issues_id_fk" FOREIGN KEY ("target_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_related_issue_id_issues_id_fk" FOREIGN KEY ("related_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_source_comment_id_issue_comments_id_fk" FOREIGN KEY ("source_comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_source_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_addressee_agent_id_agents_id_fk" FOREIGN KEY ("addressee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_resolved_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("resolved_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_hold_id_issue_tree_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."issue_tree_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_parent_issue_id_issues_id_fk" FOREIGN KEY ("parent_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_active_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("active_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_root_issue_id_issues_id_fk" FOREIGN KEY ("root_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_released_by_agent_id_agents_id_fk" FOREIGN KEY ("released_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_released_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("released_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_watchdog_agent_id_agents_id_fk" FOREIGN KEY ("watchdog_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_watchdog_issue_id_issues_id_fk" FOREIGN KEY ("watchdog_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_updated_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("updated_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_products" ADD CONSTRAINT "issue_work_products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_products" ADD CONSTRAINT "issue_work_products_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_products" ADD CONSTRAINT "issue_work_products_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_products" ADD CONSTRAINT "issue_work_products_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_products" ADD CONSTRAINT "issue_work_products_runtime_service_id_workspace_runtime_services_id_fk" FOREIGN KEY ("runtime_service_id") REFERENCES "public"."workspace_runtime_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_products" ADD CONSTRAINT "issue_work_products_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_workspace_id_project_workspaces_id_fk" FOREIGN KEY ("project_workspace_id") REFERENCES "public"."project_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_id_issues_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_checkout_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("checkout_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_execution_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("execution_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_created_agent_id_agents_id_fk" FOREIGN KEY ("created_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions" ADD CONSTRAINT "pipeline_automation_executions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions" ADD CONSTRAINT "pipeline_automation_executions_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions" ADD CONSTRAINT "pipeline_automation_executions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions" ADD CONSTRAINT "pipeline_automation_executions_execution_issue_id_issues_id_fk" FOREIGN KEY ("execution_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_blockers" ADD CONSTRAINT "pipeline_case_blockers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_blockers" ADD CONSTRAINT "pipeline_case_blockers_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_blockers" ADD CONSTRAINT "pipeline_case_blockers_blocked_by_case_id_pipeline_cases_id_fk" FOREIGN KEY ("blocked_by_case_id") REFERENCES "public"."pipeline_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_documents" ADD CONSTRAINT "pipeline_case_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_documents" ADD CONSTRAINT "pipeline_case_documents_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_documents" ADD CONSTRAINT "pipeline_case_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_from_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_issue_links" ADD CONSTRAINT "pipeline_case_issue_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_issue_links" ADD CONSTRAINT "pipeline_case_issue_links_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_case_issue_links" ADD CONSTRAINT "pipeline_case_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_cases" ADD CONSTRAINT "pipeline_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_cases" ADD CONSTRAINT "pipeline_cases_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_cases" ADD CONSTRAINT "pipeline_cases_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_cases" ADD CONSTRAINT "pipeline_cases_parent_case_id_pipeline_cases_id_fk" FOREIGN KEY ("parent_case_id") REFERENCES "public"."pipeline_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_cases" ADD CONSTRAINT "pipeline_cases_lease_agent_id_agents_id_fk" FOREIGN KEY ("lease_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_cases" ADD CONSTRAINT "pipeline_cases_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_documents" ADD CONSTRAINT "pipeline_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_documents" ADD CONSTRAINT "pipeline_documents_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_documents" ADD CONSTRAINT "pipeline_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_from_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_company_settings" ADD CONSTRAINT "plugin_company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_company_settings" ADD CONSTRAINT "plugin_company_settings_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_config" ADD CONSTRAINT "plugin_config_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_config" ADD CONSTRAINT "plugin_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_database_namespaces" ADD CONSTRAINT "plugin_database_namespaces_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_entities" ADD CONSTRAINT "plugin_entities_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_entities" ADD CONSTRAINT "plugin_entities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_job_runs" ADD CONSTRAINT "plugin_job_runs_job_id_plugin_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."plugin_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_job_runs" ADD CONSTRAINT "plugin_job_runs_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_job_runs" ADD CONSTRAINT "plugin_job_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_jobs" ADD CONSTRAINT "plugin_jobs_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_logs" ADD CONSTRAINT "plugin_logs_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_logs" ADD CONSTRAINT "plugin_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_managed_resources" ADD CONSTRAINT "plugin_managed_resources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_managed_resources" ADD CONSTRAINT "plugin_managed_resources_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_migrations" ADD CONSTRAINT "plugin_migrations_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_state" ADD CONSTRAINT "plugin_state_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_webhook_deliveries" ADD CONSTRAINT "plugin_webhook_deliveries_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_webhook_deliveries" ADD CONSTRAINT "plugin_webhook_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_permission_grants" ADD CONSTRAINT "principal_permission_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_goals" ADD CONSTRAINT "project_goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_goals" ADD CONSTRAINT "project_goals_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_goals" ADD CONSTRAINT "project_goals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workspaces" ADD CONSTRAINT "project_workspaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workspaces" ADD CONSTRAINT "project_workspaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_agent_id_agents_id_fk" FOREIGN KEY ("lead_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_documents" ADD CONSTRAINT "routine_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_documents" ADD CONSTRAINT "routine_documents_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_documents" ADD CONSTRAINT "routine_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_revisions" ADD CONSTRAINT "routine_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_revisions" ADD CONSTRAINT "routine_revisions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_revisions" ADD CONSTRAINT "routine_revisions_restored_from_revision_id_routine_revisions_id_fk" FOREIGN KEY ("restored_from_revision_id") REFERENCES "public"."routine_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_revisions" ADD CONSTRAINT "routine_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_revisions" ADD CONSTRAINT "routine_revisions_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_trigger_id_routine_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."routine_triggers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_routine_revision_id_routine_revisions_id_fk" FOREIGN KEY ("routine_revision_id") REFERENCES "public"."routine_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_linked_issue_id_issues_id_fk" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD CONSTRAINT "routine_triggers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD CONSTRAINT "routine_triggers_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD CONSTRAINT "routine_triggers_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD CONSTRAINT "routine_triggers_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD CONSTRAINT "routine_triggers_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_parent_issue_id_issues_id_fk" FOREIGN KEY ("parent_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_user_secret_definition_id_user_secret_definitions_id_fk" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smoke_run_steps" ADD CONSTRAINT "smoke_run_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smoke_run_steps" ADD CONSTRAINT "smoke_run_steps_run_id_smoke_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."smoke_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smoke_runs" ADD CONSTRAINT "smoke_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_card_updates" ADD CONSTRAINT "status_card_updates_card_id_status_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."status_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_card_updates" ADD CONSTRAINT "status_card_updates_generation_issue_id_issues_id_fk" FOREIGN KEY ("generation_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_card_updates" ADD CONSTRAINT "status_card_updates_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cards" ADD CONSTRAINT "status_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cards" ADD CONSTRAINT "status_cards_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cards" ADD CONSTRAINT "status_cards_query_compiled_by_agent_id_agents_id_fk" FOREIGN KEY ("query_compiled_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cards" ADD CONSTRAINT "status_cards_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cards" ADD CONSTRAINT "status_cards_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cards" ADD CONSTRAINT "status_cards_generating_issue_id_issues_id_fk" FOREIGN KEY ("generating_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cards" ADD CONSTRAINT "status_cards_archived_by_agent_id_agents_id_fk" FOREIGN KEY ("archived_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_slots" ADD CONSTRAINT "summary_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_slots" ADD CONSTRAINT "summary_slots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_slots" ADD CONSTRAINT "summary_slots_generating_issue_id_issues_id_fk" FOREIGN KEY ("generating_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_slots" ADD CONSTRAINT "summary_slots_last_generated_by_agent_id_agents_id_fk" FOREIGN KEY ("last_generated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_gateway_token_id_tool_mcp_gateway_tokens_id_fk" FOREIGN KEY ("gateway_token_id") REFERENCES "public"."tool_mcp_gateway_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_catalog_entry_id_tool_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."tool_catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_requests" ADD CONSTRAINT "tool_action_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_requests" ADD CONSTRAINT "tool_action_requests_invocation_id_tool_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."tool_invocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_requests" ADD CONSTRAINT "tool_action_requests_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_requests" ADD CONSTRAINT "tool_action_requests_interaction_id_issue_thread_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."issue_thread_interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_requests" ADD CONSTRAINT "tool_action_requests_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_requests" ADD CONSTRAINT "tool_action_requests_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_requests" ADD CONSTRAINT "tool_action_requests_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_requests" ADD CONSTRAINT "tool_action_requests_decided_by_agent_id_agents_id_fk" FOREIGN KEY ("decided_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_applications" ADD CONSTRAINT "tool_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_applications" ADD CONSTRAINT "tool_applications_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_applications" ADD CONSTRAINT "tool_applications_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_gateway_token_id_tool_mcp_gateway_tokens_id_fk" FOREIGN KEY ("gateway_token_id") REFERENCES "public"."tool_mcp_gateway_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_catalog_entry_id_tool_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."tool_catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_invocation_id_tool_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."tool_invocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_action_request_id_tool_action_requests_id_fk" FOREIGN KEY ("action_request_id") REFERENCES "public"."tool_action_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_events" ADD CONSTRAINT "tool_call_events_runtime_slot_id_tool_runtime_slots_id_fk" FOREIGN KEY ("runtime_slot_id") REFERENCES "public"."tool_runtime_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_catalog_entries" ADD CONSTRAINT "tool_catalog_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_catalog_entries" ADD CONSTRAINT "tool_catalog_entries_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_catalog_entries" ADD CONSTRAINT "tool_catalog_entries_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_catalog_entries" ADD CONSTRAINT "tool_catalog_entries_reviewed_by_agent_id_agents_id_fk" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connection_installs" ADD CONSTRAINT "tool_connection_installs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connection_installs" ADD CONSTRAINT "tool_connection_installs_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connection_installs" ADD CONSTRAINT "tool_connection_installs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_gateway_rate_limit_counters" ADD CONSTRAINT "tool_gateway_rate_limit_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_gateway_token_id_tool_mcp_gateway_tokens_id_fk" FOREIGN KEY ("gateway_token_id") REFERENCES "public"."tool_mcp_gateway_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_gateway_token_id_tool_mcp_gateway_tokens_id_fk" FOREIGN KEY ("gateway_token_id") REFERENCES "public"."tool_mcp_gateway_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_catalog_entry_id_tool_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."tool_catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_expiry_override_by_agent_id_agents_id_fk" FOREIGN KEY ("expiry_override_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_profile_id_tool_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tool_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_approval_issue_id_issues_id_fk" FOREIGN KEY ("approval_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_oauth_states" ADD CONSTRAINT "tool_oauth_states_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_oauth_states" ADD CONSTRAINT "tool_oauth_states_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_policies" ADD CONSTRAINT "tool_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_policies" ADD CONSTRAINT "tool_policies_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profile_bindings" ADD CONSTRAINT "tool_profile_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profile_bindings" ADD CONSTRAINT "tool_profile_bindings_profile_id_tool_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tool_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profile_bindings" ADD CONSTRAINT "tool_profile_bindings_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_profile_id_tool_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tool_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_catalog_entry_id_tool_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."tool_catalog_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_profiles" ADD CONSTRAINT "tool_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_rate_limit_counters" ADD CONSTRAINT "tool_rate_limit_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_rate_limit_counters" ADD CONSTRAINT "tool_rate_limit_counters_policy_id_tool_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."tool_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runtime_metric_counters" ADD CONSTRAINT "tool_runtime_metric_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_project_workspace_id_project_workspaces_id_fk" FOREIGN KEY ("project_workspace_id") REFERENCES "public"."project_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_stdio_command_templates" ADD CONSTRAINT "tool_stdio_command_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_stdio_command_templates" ADD CONSTRAINT "tool_stdio_command_templates_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_inbox_agent_policies" ADD CONSTRAINT "user_inbox_agent_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_secret_declarations" ADD CONSTRAINT "user_secret_declarations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_secret_declarations" ADD CONSTRAINT "user_secret_declarations_user_secret_definition_id_user_secret_definitions_id_fk" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_provider_config_id_company_secret_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."company_secret_provider_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operations" ADD CONSTRAINT "workspace_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operations" ADD CONSTRAINT "workspace_operations_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operations" ADD CONSTRAINT "workspace_operations_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operations" ADD CONSTRAINT "workspace_operations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_project_workspace_id_project_workspaces_id_fk" FOREIGN KEY ("project_workspace_id") REFERENCES "public"."project_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_started_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("started_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "activity_log_company_created_idx" ON "activity_log" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "activity_log_company_agent_created_idx" ON "activity_log" USING btree ("company_id","agent_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "activity_log_company_responsible_user_created_idx" ON "activity_log" USING btree ("company_id","responsible_user_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "activity_log_run_id_idx" ON "activity_log" USING btree ("run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "activity_log_entity_type_id_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "adapter_auth_sessions_company_status_idx" ON "adapter_auth_sessions" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "adapter_auth_sessions_company_owner_adapter_active_uq" ON "adapter_auth_sessions" USING btree ("company_id","started_by_user_id","adapter_type") WHERE "adapter_auth_sessions"."status" IN ('starting', 'waiting_for_user', 'promoting', 'awaiting_code', 'submitting');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "adapter_auth_sessions_public_session_id_uq" ON "adapter_auth_sessions" USING btree ("public_session_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "adapter_auth_sessions_environment_idx" ON "adapter_auth_sessions" USING btree ("environment_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "adapter_auth_sessions_expires_idx" ON "adapter_auth_sessions" USING btree ("expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "adapter_auth_sessions_provider_lease_idx" ON "adapter_auth_sessions" USING btree ("provider_lease_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_api_keys_key_hash_idx" ON "agent_api_keys" USING btree ("key_hash");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_api_keys_company_agent_idx" ON "agent_api_keys" USING btree ("company_id","agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_config_revisions_company_agent_created_idx" ON "agent_config_revisions" USING btree ("company_id","agent_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_config_revisions_agent_created_idx" ON "agent_config_revisions" USING btree ("agent_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_memberships_company_user_idx" ON "agent_memberships" USING btree ("company_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_memberships_company_user_starred_idx" ON "agent_memberships" USING btree ("company_id","user_id","starred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_memberships_agent_idx" ON "agent_memberships" USING btree ("agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "agent_memberships_company_user_agent_uq" ON "agent_memberships" USING btree ("company_id","user_id","agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_runtime_state_company_agent_idx" ON "agent_runtime_state" USING btree ("company_id","agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_runtime_state_company_updated_idx" ON "agent_runtime_state" USING btree ("company_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "agent_task_sessions_company_agent_adapter_task_uniq" ON "agent_task_sessions" USING btree ("company_id","agent_id","adapter_type","task_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_task_sessions_company_agent_updated_idx" ON "agent_task_sessions" USING btree ("company_id","agent_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_task_sessions_company_task_updated_idx" ON "agent_task_sessions" USING btree ("company_id","task_key","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_wakeup_requests_company_agent_status_idx" ON "agent_wakeup_requests" USING btree ("company_id","agent_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_wakeup_requests_company_requested_idx" ON "agent_wakeup_requests" USING btree ("company_id","requested_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_wakeup_requests_agent_requested_idx" ON "agent_wakeup_requests" USING btree ("agent_id","requested_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "agent_wakeup_requests_review_path_recovery_idempotency_uq" ON "agent_wakeup_requests" USING btree ("company_id","idempotency_key") WHERE "agent_wakeup_requests"."idempotency_key" LIKE 'issue_review_path_lost:%' AND "agent_wakeup_requests"."status" <> 'skipped';--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "agent_wakeup_requests_disposition_repair_idempotency_uq" ON "agent_wakeup_requests" USING btree ("company_id","idempotency_key") WHERE "agent_wakeup_requests"."idempotency_key" LIKE 'issue_disposition_repair:%' AND "agent_wakeup_requests"."status" <> 'skipped';--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agent_wakeup_requests_company_payload_issue_idx" ON "agent_wakeup_requests" USING btree ("company_id",("payload" ->> 'issueId'));--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agents_company_status_idx" ON "agents" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agents_company_reports_to_idx" ON "agents" USING btree ("company_id","reports_to");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "agents_company_default_environment_idx" ON "agents" USING btree ("company_id","default_environment_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "approval_comments_company_idx" ON "approval_comments" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "approval_comments_approval_idx" ON "approval_comments" USING btree ("approval_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "approval_comments_approval_created_idx" ON "approval_comments" USING btree ("approval_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "approvals_company_status_type_idx" ON "approvals" USING btree ("company_id","status","type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "assets_company_created_idx" ON "assets" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "assets_company_provider_idx" ON "assets" USING btree ("company_id","provider");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "assets_company_object_key_uq" ON "assets" USING btree ("company_id","object_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "board_api_keys_key_hash_idx" ON "board_api_keys" USING btree ("key_hash");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "board_api_keys_user_idx" ON "board_api_keys" USING btree ("user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "budget_incidents_company_status_idx" ON "budget_incidents" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "budget_incidents_company_scope_idx" ON "budget_incidents" USING btree ("company_id","scope_type","scope_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "budget_incidents_policy_window_threshold_idx" ON "budget_incidents" USING btree ("policy_id","window_start","threshold_type") WHERE "budget_incidents"."status" <> 'dismissed';--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "budget_policies_company_scope_active_idx" ON "budget_policies" USING btree ("company_id","scope_type","scope_id","is_active");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "budget_policies_company_window_idx" ON "budget_policies" USING btree ("company_id","window_kind","metric");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "budget_policies_company_scope_metric_unique_idx" ON "budget_policies" USING btree ("company_id","scope_type","scope_id","metric","window_kind");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "built_in_managed_resources_company_idx" ON "built_in_managed_resources" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "built_in_managed_resources_resource_idx" ON "built_in_managed_resources" USING btree ("resource_kind","resource_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "built_in_managed_resources_company_bundle_resource_uq" ON "built_in_managed_resources" USING btree ("company_id","bundle_key","resource_kind","resource_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "case_attachments_company_case_idx" ON "case_attachments" USING btree ("company_id","case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "case_attachments_asset_uq" ON "case_attachments" USING btree ("asset_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "case_documents_company_case_key_uq" ON "case_documents" USING btree ("company_id","case_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "case_documents_document_uq" ON "case_documents" USING btree ("document_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "case_documents_company_case_updated_idx" ON "case_documents" USING btree ("company_id","case_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "case_events_case_created_idx" ON "case_events" USING btree ("case_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "case_events_company_case_idx" ON "case_events" USING btree ("company_id","case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "case_issue_links_case_issue_uq" ON "case_issue_links" USING btree ("case_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "case_issue_links_company_case_idx" ON "case_issue_links" USING btree ("company_id","case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "case_issue_links_issue_idx" ON "case_issue_links" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "case_labels_case_label_uq" ON "case_labels" USING btree ("case_id","label_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "case_labels_company_case_idx" ON "case_labels" USING btree ("company_id","case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "case_labels_label_idx" ON "case_labels" USING btree ("label_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "cases_company_case_number_uq" ON "cases" USING btree ("company_id","case_number");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "cases_identifier_uq" ON "cases" USING btree ("identifier");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "cases_company_type_key_uq" ON "cases" USING btree ("company_id","case_type","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cases_company_status_idx" ON "cases" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cases_company_type_idx" ON "cases" USING btree ("company_id","case_type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cases_company_project_idx" ON "cases" USING btree ("company_id","project_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cases_parent_idx" ON "cases" USING btree ("parent_case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cases_title_search_idx" ON "cases" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cases_identifier_search_idx" ON "cases" USING gin ("identifier" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cases_summary_search_idx" ON "cases" USING gin ("summary" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cli_auth_challenges_secret_hash_idx" ON "cli_auth_challenges" USING btree ("secret_hash");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cli_auth_challenges_approved_by_idx" ON "cli_auth_challenges" USING btree ("approved_by_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cli_auth_challenges_requested_company_idx" ON "cli_auth_challenges" USING btree ("requested_company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "companies_issue_prefix_idx" ON "companies" USING btree ("issue_prefix");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_logos_company_uq" ON "company_logos" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_logos_asset_uq" ON "company_logos" USING btree ("asset_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_memberships_company_principal_unique_idx" ON "company_memberships" USING btree ("company_id","principal_type","principal_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_memberships_principal_status_idx" ON "company_memberships" USING btree ("principal_type","principal_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_memberships_company_status_idx" ON "company_memberships" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_onboarding_seeds_company_uq" ON "company_onboarding_seeds" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_bindings_company_idx" ON "company_secret_bindings" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_bindings_secret_idx" ON "company_secret_bindings" USING btree ("secret_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_bindings_target_idx" ON "company_secret_bindings" USING btree ("company_id","target_type","target_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_secret_bindings_target_path_uq" ON "company_secret_bindings" USING btree ("company_id","target_type","target_id","config_path");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_proposals_company_status_idx" ON "company_secret_proposals" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_proposals_proposer_status_idx" ON "company_secret_proposals" USING btree ("proposed_by_agent_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_proposals_expiry_idx" ON "company_secret_proposals" USING btree ("status","expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_proposals_secret_proposal_idx" ON "company_secret_proposals" USING btree ("secret_proposal_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_proposals_interaction_idx" ON "company_secret_proposals" USING btree ("interaction_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_provider_configs_company_idx" ON "company_secret_provider_configs" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_provider_configs_company_provider_idx" ON "company_secret_provider_configs" USING btree ("company_id","provider");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_secret_provider_configs_default_uq" ON "company_secret_provider_configs" USING btree ("company_id","provider") WHERE "company_secret_provider_configs"."is_default" = true;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_versions_secret_idx" ON "company_secret_versions" USING btree ("secret_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_versions_value_sha256_idx" ON "company_secret_versions" USING btree ("value_sha256");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secret_versions_fingerprint_idx" ON "company_secret_versions" USING btree ("fingerprint_sha256");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_secret_versions_secret_version_uq" ON "company_secret_versions" USING btree ("secret_id","version");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secrets_company_idx" ON "company_secrets" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secrets_company_scope_idx" ON "company_secrets" USING btree ("company_id","scope");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secrets_company_owner_idx" ON "company_secrets" USING btree ("company_id","owner_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secrets_user_definition_owner_idx" ON "company_secrets" USING btree ("company_id","user_secret_definition_id","owner_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secrets_company_provider_idx" ON "company_secrets" USING btree ("company_id","provider");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_secrets_provider_config_idx" ON "company_secrets" USING btree ("provider_config_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_secrets_company_name_uq" ON "company_secrets" USING btree ("company_id","name") WHERE "company_secrets"."scope" = 'company' and "company_secrets"."deleted_at" is null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_secrets_company_key_uq" ON "company_secrets" USING btree ("company_id","key") WHERE "company_secrets"."scope" = 'company' and "company_secrets"."deleted_at" is null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_secrets_user_definition_owner_uq" ON "company_secrets" USING btree ("company_id","user_secret_definition_id","owner_user_id") WHERE "company_secrets"."scope" = 'user' and "company_secrets"."deleted_at" is null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_comments_company_skill_created_idx" ON "company_skill_comments" USING btree ("company_id","company_skill_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_comments_parent_idx" ON "company_skill_comments" USING btree ("parent_comment_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_skill_stars_skill_agent_idx" ON "company_skill_stars" USING btree ("company_skill_id","agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_skill_stars_skill_user_idx" ON "company_skill_stars" USING btree ("company_skill_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_stars_company_skill_created_idx" ON "company_skill_stars" USING btree ("company_id","company_skill_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_test_inputs_company_skill_name_idx" ON "company_skill_test_inputs" USING btree ("company_id","skill_id","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_test_inputs_company_skill_active_idx" ON "company_skill_test_inputs" USING btree ("company_id","skill_id","deleted_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_test_run_templates_company_active_idx" ON "company_skill_test_run_templates" USING btree ("company_id","deleted_at","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_test_runs_company_skill_created_idx" ON "company_skill_test_runs" USING btree ("company_id","skill_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_skill_test_runs_company_issue_idx" ON "company_skill_test_runs" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_test_runs_company_input_created_idx" ON "company_skill_test_runs" USING btree ("company_id","input_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_test_runs_company_status_idx" ON "company_skill_test_runs" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_test_runs_company_harness_expires_idx" ON "company_skill_test_runs" USING btree ("company_id","harness_issue_expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_skill_versions_skill_revision_idx" ON "company_skill_versions" USING btree ("company_skill_id","revision_number");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_skill_versions_skill_release_idx" ON "company_skill_versions" USING btree ("company_skill_id","release_id") WHERE "company_skill_versions"."release_id" is not null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skill_versions_company_skill_created_idx" ON "company_skill_versions" USING btree ("company_id","company_skill_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_skills_company_key_idx" ON "company_skills" USING btree ("company_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skills_company_name_idx" ON "company_skills" USING btree ("company_id","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skills_company_folder_idx" ON "company_skills" USING btree ("company_id","folder_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skills_company_categories_idx" ON "company_skills" USING gin ("categories");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skills_company_sharing_scope_idx" ON "company_skills" USING btree ("company_id","sharing_scope");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skills_company_current_version_idx" ON "company_skills" USING btree ("company_id","current_version_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_skills_company_forked_from_idx" ON "company_skills" USING btree ("company_id","forked_from_skill_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_transfer_runs_company_idx" ON "company_transfer_runs" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_transfer_runs_idempotency_direction_idx" ON "company_transfer_runs" USING btree ("idempotency_key","direction");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_transfer_runs_actor_status_idx" ON "company_transfer_runs" USING btree ("actor_key","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_user_sidebar_preferences_company_idx" ON "company_user_sidebar_preferences" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "company_user_sidebar_preferences_user_idx" ON "company_user_sidebar_preferences" USING btree ("user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "company_user_sidebar_preferences_company_user_uq" ON "company_user_sidebar_preferences" USING btree ("company_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cost_events_company_occurred_idx" ON "cost_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cost_events_company_agent_occurred_idx" ON "cost_events" USING btree ("company_id","agent_id","occurred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cost_events_company_provider_occurred_idx" ON "cost_events" USING btree ("company_id","provider","occurred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cost_events_company_biller_occurred_idx" ON "cost_events" USING btree ("company_id","biller","occurred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "cost_events_company_heartbeat_run_idx" ON "cost_events" USING btree ("company_id","heartbeat_run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "decision_archive_notification_outbox_uq" ON "decision_archive_notification_outbox" USING btree ("company_id","source_kind","source_id","archive_version","origin_agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_archive_notification_outbox_pending_idx" ON "decision_archive_notification_outbox" USING btree ("status","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "decision_queue_items_queue_source_uq" ON "decision_queue_items" USING btree ("queue_id","source_kind","source_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_queue_items_company_source_idx" ON "decision_queue_items" USING btree ("company_id","source_kind","source_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "decision_queues_company_key_uq" ON "decision_queues" USING btree ("company_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_queues_company_updated_idx" ON "decision_queues" USING btree ("company_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "decision_retention_company_source_uq" ON "decision_retention" USING btree ("company_id","source_kind","source_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_retention_company_archived_idx" ON "decision_retention" USING btree ("company_id","archived_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "decision_triage_company_source_uq" ON "decision_triage" USING btree ("company_id","source_kind","source_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_triage_company_decide_by_idx" ON "decision_triage" USING btree ("company_id","decide_by");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_triage_events_company_source_created_idx" ON "decision_triage_events" USING btree ("company_id","source_kind","source_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_triage_events_queue_created_idx" ON "decision_triage_events" USING btree ("queue_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_training_examples_company_created_at_idx" ON "decision_training_examples" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_training_examples_issue_idx" ON "decision_training_examples" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "decision_training_examples_source_author_uq" ON "decision_training_examples" USING btree ("source_kind","source_id","created_by_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_bundles_company_created_at_idx" ON "decision_bundles" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "decision_effect_executions_decision_effect_uq" ON "decision_effect_executions" USING btree ("decision_id","effect_index");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_effect_executions_target_issue_idx" ON "decision_effect_executions" USING btree ("target_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_target_issues_decision_idx" ON "decision_target_issues" USING btree ("decision_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decision_target_issues_issue_idx" ON "decision_target_issues" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decisions_company_status_expires_at_idx" ON "decisions" USING btree ("company_id","status","expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decisions_bundle_idx" ON "decisions" USING btree ("bundle_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "decisions_origin_issue_idx" ON "decisions" USING btree ("origin_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "decisions_company_idempotency_uq" ON "decisions" USING btree ("company_id","idempotency_key") WHERE "decisions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_anchor_snapshots_company_thread_created_at_idx" ON "document_annotation_anchor_snapshots" USING btree ("company_id","thread_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_anchor_snapshots_company_document_revision_idx" ON "document_annotation_anchor_snapshots" USING btree ("company_id","document_id","to_revision_number");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_comments_company_thread_created_at_idx" ON "document_annotation_comments" USING btree ("company_id","thread_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_comments_company_issue_created_at_idx" ON "document_annotation_comments" USING btree ("company_id","issue_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_comments_company_routine_created_at_idx" ON "document_annotation_comments" USING btree ("company_id","routine_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_comments_company_case_created_at_idx" ON "document_annotation_comments" USING btree ("company_id","case_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_comments_company_document_created_at_idx" ON "document_annotation_comments" USING btree ("company_id","document_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_comments_issue_comment_idx" ON "document_annotation_comments" USING btree ("issue_comment_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_comments_body_search_idx" ON "document_annotation_comments" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_threads_company_document_status_idx" ON "document_annotation_threads" USING btree ("company_id","document_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_threads_company_issue_status_idx" ON "document_annotation_threads" USING btree ("company_id","issue_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_threads_company_routine_status_idx" ON "document_annotation_threads" USING btree ("company_id","routine_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_threads_company_case_status_idx" ON "document_annotation_threads" USING btree ("company_id","case_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_threads_company_current_revision_open_idx" ON "document_annotation_threads" USING btree ("company_id","document_id","current_revision_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_annotation_threads_company_anchor_state_idx" ON "document_annotation_threads" USING btree ("company_id","anchor_state");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_memberships_company_user_starred_idx" ON "document_memberships" USING btree ("company_id","user_id","starred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "document_memberships_company_user_document_uq" ON "document_memberships" USING btree ("company_id","user_id","document_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "document_revisions_document_revision_uq" ON "document_revisions" USING btree ("document_id","revision_number");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "document_revisions_company_document_created_idx" ON "document_revisions" USING btree ("company_id","document_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "documents_company_updated_idx" ON "documents" USING btree ("company_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "documents_company_created_idx" ON "documents" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "documents_title_search_idx" ON "documents" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "documents_latest_body_search_idx" ON "documents" USING gin ("latest_body" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_setup_sessions_environment_status_idx" ON "environment_custom_image_setup_sessions" USING btree ("environment_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "environment_custom_image_setup_sessions_environment_active_uq" ON "environment_custom_image_setup_sessions" USING btree ("environment_id") WHERE "environment_custom_image_setup_sessions"."status" IN ('starting', 'waiting_for_user', 'capturing');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_setup_sessions_template_idx" ON "environment_custom_image_setup_sessions" USING btree ("template_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_setup_sessions_promoted_template_idx" ON "environment_custom_image_setup_sessions" USING btree ("promoted_template_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_setup_sessions_expires_idx" ON "environment_custom_image_setup_sessions" USING btree ("expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_setup_sessions_provider_lease_idx" ON "environment_custom_image_setup_sessions" USING btree ("provider","provider_lease_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_templates_environment_status_idx" ON "environment_custom_image_templates" USING btree ("environment_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_templates_environment_provider_status_idx" ON "environment_custom_image_templates" USING btree ("environment_id","provider","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "environment_custom_image_templates_environment_active_uq" ON "environment_custom_image_templates" USING btree ("environment_id") WHERE "environment_custom_image_templates"."status" = 'active';--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_templates_superseded_by_idx" ON "environment_custom_image_templates" USING btree ("superseded_by_template_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_custom_image_templates_last_used_idx" ON "environment_custom_image_templates" USING btree ("last_used_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_leases_company_environment_status_idx" ON "environment_leases" USING btree ("company_id","environment_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_leases_company_execution_workspace_idx" ON "environment_leases" USING btree ("company_id","execution_workspace_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_leases_company_issue_idx" ON "environment_leases" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_leases_heartbeat_run_idx" ON "environment_leases" USING btree ("heartbeat_run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_leases_company_last_used_idx" ON "environment_leases" USING btree ("company_id","last_used_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environment_leases_provider_lease_idx" ON "environment_leases" USING btree ("provider_lease_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "environments_status_idx" ON "environments" USING btree ("status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "environments_local_driver_idx" ON "environments" USING btree ("driver") WHERE "environments"."driver" = 'local';--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "environments_managed_sandbox_idx" ON "environments" USING btree ("driver") WHERE "environments"."driver" = 'sandbox' AND ("environments"."metadata" ->> 'managedByPilot')::boolean = true;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "environments_name_idx" ON "environments" USING btree ("name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "execution_workspace_runtime_leases_company_workspace_idx" ON "execution_workspace_runtime_leases" USING btree ("company_id","execution_workspace_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "execution_workspace_runtime_leases_company_owner_idx" ON "execution_workspace_runtime_leases" USING btree ("company_id","owner_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "execution_workspace_runtime_leases_expires_at_idx" ON "execution_workspace_runtime_leases" USING btree ("expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "execution_workspaces_company_project_status_idx" ON "execution_workspaces" USING btree ("company_id","project_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "execution_workspaces_company_project_workspace_status_idx" ON "execution_workspaces" USING btree ("company_id","project_workspace_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "execution_workspaces_company_source_issue_idx" ON "execution_workspaces" USING btree ("company_id","source_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "execution_workspaces_company_last_used_idx" ON "execution_workspaces" USING btree ("company_id","last_used_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "execution_workspaces_company_branch_idx" ON "execution_workspaces" USING btree ("company_id","branch_name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "external_object_mentions_company_source_issue_idx" ON "external_object_mentions" USING btree ("company_id","source_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "external_object_mentions_company_object_idx" ON "external_object_mentions" USING btree ("company_id","object_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "external_object_mentions_company_provider_idx" ON "external_object_mentions" USING btree ("company_id","provider_key","object_type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "external_object_mentions_company_source_record_uq" ON "external_object_mentions" USING btree ("company_id","source_issue_id","source_kind","source_record_id","document_key","property_key","canonical_identity_hash") WHERE "external_object_mentions"."source_record_id" is not null and "external_object_mentions"."canonical_identity_hash" is not null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "external_object_mentions_company_source_null_record_uq" ON "external_object_mentions" USING btree ("company_id","source_issue_id","source_kind","document_key","property_key","canonical_identity_hash") WHERE "external_object_mentions"."source_record_id" is null and "external_object_mentions"."canonical_identity_hash" is not null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "external_objects_company_provider_object_idx" ON "external_objects" USING btree ("company_id","provider_key","object_type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "external_objects_company_provider_status_idx" ON "external_objects" USING btree ("company_id","provider_key","status_category");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "external_objects_company_refresh_idx" ON "external_objects" USING btree ("company_id","next_refresh_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "external_objects_company_external_id_uq" ON "external_objects" USING btree ("company_id","provider_key","object_type","external_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "external_objects_company_identity_uq" ON "external_objects" USING btree ("company_id","provider_key","object_type","canonical_identity_hash");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "feedback_exports_feedback_vote_idx" ON "feedback_exports" USING btree ("feedback_vote_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "feedback_exports_company_created_idx" ON "feedback_exports" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "feedback_exports_company_status_idx" ON "feedback_exports" USING btree ("company_id","status","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "feedback_exports_company_issue_idx" ON "feedback_exports" USING btree ("company_id","issue_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "feedback_exports_company_project_idx" ON "feedback_exports" USING btree ("company_id","project_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "feedback_exports_company_author_idx" ON "feedback_exports" USING btree ("company_id","author_user_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "feedback_votes_company_issue_idx" ON "feedback_votes" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "feedback_votes_issue_target_idx" ON "feedback_votes" USING btree ("issue_id","target_type","target_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "feedback_votes_author_idx" ON "feedback_votes" USING btree ("author_user_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "feedback_votes_company_target_author_idx" ON "feedback_votes" USING btree ("company_id","target_type","target_id","author_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "finance_events_company_occurred_idx" ON "finance_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "finance_events_company_biller_occurred_idx" ON "finance_events" USING btree ("company_id","biller","occurred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "finance_events_company_kind_occurred_idx" ON "finance_events" USING btree ("company_id","event_kind","occurred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "finance_events_company_direction_occurred_idx" ON "finance_events" USING btree ("company_id","direction","occurred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "finance_events_company_heartbeat_run_idx" ON "finance_events" USING btree ("company_id","heartbeat_run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "finance_events_company_cost_event_idx" ON "finance_events" USING btree ("company_id","cost_event_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "folders_company_kind_position_idx" ON "folders" USING btree ("company_id","kind","position","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "folders_company_kind_root_slug_uq" ON "folders" USING btree ("company_id","kind","slug") WHERE "folders"."parent_id" is null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "folders_company_kind_parent_slug_uq" ON "folders" USING btree ("company_id","kind","parent_id","slug") WHERE "folders"."parent_id" is not null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "folders_company_kind_system_key_uq" ON "folders" USING btree ("company_id","kind","system_key") WHERE "folders"."system_key" is not null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "folders_company_kind_parent_position_idx" ON "folders" USING btree ("company_id","kind","parent_id","position","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "goals_company_idx" ON "goals" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_run_events_run_seq_idx" ON "heartbeat_run_events" USING btree ("run_id","seq");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_run_events_company_run_idx" ON "heartbeat_run_events" USING btree ("company_id","run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_run_events_company_created_idx" ON "heartbeat_run_events" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_run_watchdog_decisions_company_run_created_idx" ON "heartbeat_run_watchdog_decisions" USING btree ("company_id","run_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_run_watchdog_decisions_company_run_snooze_idx" ON "heartbeat_run_watchdog_decisions" USING btree ("company_id","run_id","snoozed_until");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_agent_started_idx" ON "heartbeat_runs" USING btree ("company_id","agent_id","started_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_responsible_user_idx" ON "heartbeat_runs" USING btree ("company_id","responsible_user_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_liveness_idx" ON "heartbeat_runs" USING btree ("company_id","liveness_state","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_status_last_output_idx" ON "heartbeat_runs" USING btree ("company_id","status","last_output_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_status_process_started_idx" ON "heartbeat_runs" USING btree ("company_id","status","process_started_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_created_at_desc_idx" ON "heartbeat_runs" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_ctx_issue_created_idx" ON "heartbeat_runs" USING btree ("company_id",("context_snapshot" ->> 'issueId'),"created_at" DESC NULLS LAST);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_ctx_task_created_idx" ON "heartbeat_runs" USING btree ("company_id",("context_snapshot" ->> 'taskId'),"created_at" DESC NULLS LAST);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "heartbeat_runs_company_ctx_taskkey_created_idx" ON "heartbeat_runs" USING btree ("company_id",("context_snapshot" ->> 'taskKey'),"created_at" DESC NULLS LAST);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "inbox_dismissals_company_user_idx" ON "inbox_dismissals" USING btree ("company_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "inbox_dismissals_company_item_idx" ON "inbox_dismissals" USING btree ("company_id","item_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "inbox_dismissals_company_user_item_idx" ON "inbox_dismissals" USING btree ("company_id","user_id","item_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "connection_grants_company_connection_idx" ON "connection_grants" USING btree ("company_id","connection_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "connection_grants_subject_user_idx" ON "connection_grants" USING btree ("company_id","subject_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "connection_grants_user_uq" ON "connection_grants" USING btree ("connection_id","subject_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "connection_grants_default_uq" ON "connection_grants" USING btree ("connection_id") WHERE "connection_grants"."is_default" = true and "connection_grants"."kind" = 'workspace';--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "connection_token_issuances_company_created_idx" ON "connection_token_issuances" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "connection_token_issuances_connection_created_idx" ON "connection_token_issuances" USING btree ("company_id","connection_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "connection_token_issuances_agent_connection_idx" ON "connection_token_issuances" USING btree ("company_id","agent_id","connection_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "connection_token_issuances_run_idx" ON "connection_token_issuances" USING btree ("company_id","run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "instance_settings_singleton_key_idx" ON "instance_settings" USING btree ("singleton_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "instance_user_roles_user_role_unique_idx" ON "instance_user_roles" USING btree ("user_id","role");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "instance_user_roles_role_idx" ON "instance_user_roles" USING btree ("role");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "invites_token_hash_unique_idx" ON "invites" USING btree ("token_hash");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "invites_company_invite_state_idx" ON "invites" USING btree ("company_id","invite_type","revoked_at","expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_approvals_issue_idx" ON "issue_approvals" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_approvals_approval_idx" ON "issue_approvals" USING btree ("approval_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_approvals_company_idx" ON "issue_approvals" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_attachments_company_issue_idx" ON "issue_attachments" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_attachments_issue_comment_idx" ON "issue_attachments" USING btree ("issue_comment_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_attachments_asset_uq" ON "issue_attachments" USING btree ("asset_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_comments_issue_idx" ON "issue_comments" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_comments_company_idx" ON "issue_comments" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_comments_company_issue_created_at_idx" ON "issue_comments" USING btree ("company_id","issue_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_comments_company_author_issue_created_at_idx" ON "issue_comments" USING btree ("company_id","author_user_id","issue_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_comments_body_search_idx" ON "issue_comments" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_create_idempotency_keys_company_key_uq" ON "issue_create_idempotency_keys" USING btree ("company_id","idempotency_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_create_idempotency_keys_issue_idx" ON "issue_create_idempotency_keys" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_create_idempotency_keys_company_created_at_idx" ON "issue_create_idempotency_keys" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_documents_company_issue_key_uq" ON "issue_documents" USING btree ("company_id","issue_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_documents_document_uq" ON "issue_documents" USING btree ("document_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_documents_company_issue_updated_idx" ON "issue_documents" USING btree ("company_id","issue_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_execution_decisions_company_issue_idx" ON "issue_execution_decisions" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_execution_decisions_stage_idx" ON "issue_execution_decisions" USING btree ("issue_id","stage_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_inbox_archives_company_issue_idx" ON "issue_inbox_archives" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_inbox_archives_company_user_idx" ON "issue_inbox_archives" USING btree ("company_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_inbox_archives_company_issue_user_idx" ON "issue_inbox_archives" USING btree ("company_id","issue_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_labels_issue_idx" ON "issue_labels" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_labels_label_idx" ON "issue_labels" USING btree ("label_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_labels_company_idx" ON "issue_labels" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_plan_decompositions_company_source_status_idx" ON "issue_plan_decompositions" USING btree ("company_id","source_issue_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_plan_decompositions_active_owner_idx" ON "issue_plan_decompositions" USING btree ("company_id","owner_agent_id") WHERE "issue_plan_decompositions"."status" = 'in_flight';--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_plan_decompositions_source_revision_uq" ON "issue_plan_decompositions" USING btree ("company_id","source_issue_id","accepted_plan_revision_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_read_states_company_issue_idx" ON "issue_read_states" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_read_states_company_user_idx" ON "issue_read_states" USING btree ("company_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_read_states_company_issue_user_idx" ON "issue_read_states" USING btree ("company_id","issue_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_recovery_actions_company_source_status_idx" ON "issue_recovery_actions" USING btree ("company_id","source_issue_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_recovery_actions_company_owner_status_idx" ON "issue_recovery_actions" USING btree ("company_id","owner_agent_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_recovery_actions_company_recovery_issue_idx" ON "issue_recovery_actions" USING btree ("company_id","recovery_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_recovery_actions_active_source_uq" ON "issue_recovery_actions" USING btree ("company_id","source_issue_id") WHERE "issue_recovery_actions"."status" in ('active', 'escalated');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_recovery_actions_active_fingerprint_uq" ON "issue_recovery_actions" USING btree ("company_id","source_issue_id","cause","fingerprint") WHERE "issue_recovery_actions"."status" in ('active', 'escalated');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline index
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_reference_mentions_company_source_issue_idx" ON "issue_reference_mentions" USING btree ("company_id","source_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline index
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_reference_mentions_company_target_issue_idx" ON "issue_reference_mentions" USING btree ("company_id","target_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline index
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_reference_mentions_company_issue_pair_idx" ON "issue_reference_mentions" USING btree ("company_id","source_issue_id","target_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: required for issue reference dedup
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_reference_mentions_company_source_mention_record_uq" ON "issue_reference_mentions" USING btree ("company_id","source_issue_id","target_issue_id","source_kind","source_record_id") WHERE "issue_reference_mentions"."source_record_id" is not null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: required for issue reference dedup
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_reference_mentions_company_source_mention_null_record_uq" ON "issue_reference_mentions" USING btree ("company_id","source_issue_id","target_issue_id","source_kind") WHERE "issue_reference_mentions"."source_record_id" is null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_relations_company_issue_idx" ON "issue_relations" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_relations_company_related_issue_idx" ON "issue_relations" USING btree ("company_id","related_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_relations_company_type_idx" ON "issue_relations" USING btree ("company_id","type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_relations_company_edge_uq" ON "issue_relations" USING btree ("company_id","issue_id","related_issue_id","type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_thread_interactions_issue_idx" ON "issue_thread_interactions" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_thread_interactions_company_issue_created_at_idx" ON "issue_thread_interactions" USING btree ("company_id","issue_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_thread_interactions_company_issue_status_idx" ON "issue_thread_interactions" USING btree ("company_id","issue_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_thread_interactions_company_issue_idempotency_uq" ON "issue_thread_interactions" USING btree ("company_id","issue_id","idempotency_key") WHERE "issue_thread_interactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_thread_interactions_source_comment_idx" ON "issue_thread_interactions" USING btree ("source_comment_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_thread_interactions_addressee_agent_idx" ON "issue_thread_interactions" USING btree ("addressee_agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_tree_hold_members_hold_issue_uq" ON "issue_tree_hold_members" USING btree ("hold_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_tree_hold_members_company_issue_idx" ON "issue_tree_hold_members" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_tree_hold_members_hold_depth_idx" ON "issue_tree_hold_members" USING btree ("hold_id","depth");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_tree_holds_company_root_status_idx" ON "issue_tree_holds" USING btree ("company_id","root_issue_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_tree_holds_company_status_mode_idx" ON "issue_tree_holds" USING btree ("company_id","status","mode");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_watchdogs_company_issue_uq" ON "issue_watchdogs" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_watchdogs_company_status_idx" ON "issue_watchdogs" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_watchdogs_company_agent_idx" ON "issue_watchdogs" USING btree ("company_id","watchdog_agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issue_watchdogs_company_watchdog_issue_uq" ON "issue_watchdogs" USING btree ("company_id","watchdog_issue_id") WHERE "issue_watchdogs"."watchdog_issue_id" is not null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_work_products_company_issue_type_idx" ON "issue_work_products" USING btree ("company_id","issue_id","type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_work_products_company_execution_workspace_type_idx" ON "issue_work_products" USING btree ("company_id","execution_workspace_id","type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_work_products_company_provider_external_id_idx" ON "issue_work_products" USING btree ("company_id","provider","external_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issue_work_products_company_updated_idx" ON "issue_work_products" USING btree ("company_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_status_idx" ON "issues" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_harness_kind_idx" ON "issues" USING btree ("company_id","harness_kind");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_assignee_status_idx" ON "issues" USING btree ("company_id","assignee_agent_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_assignee_user_status_idx" ON "issues" USING btree ("company_id","assignee_user_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_responsible_user_idx" ON "issues" USING btree ("company_id","responsible_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_parent_idx" ON "issues" USING btree ("company_id","parent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_project_idx" ON "issues" USING btree ("company_id","project_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_origin_idx" ON "issues" USING btree ("company_id","origin_kind","origin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_project_workspace_idx" ON "issues" USING btree ("company_id","project_workspace_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_execution_workspace_idx" ON "issues" USING btree ("company_id","execution_workspace_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_monitor_due_idx" ON "issues" USING btree ("company_id","monitor_next_check_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_updated_idx" ON "issues" USING btree ("company_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_created_idx" ON "issues" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_open_normalized_title_created_idx" ON "issues" USING btree ("company_id","parent_id",lower(regexp_replace(btrim("title"), '\s+', ' ', 'g')),"created_at") WHERE "issues"."hidden_at" is null and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_company_priority_idx" ON "issues" USING btree ("company_id","priority");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_identifier_idx" ON "issues" USING btree ("identifier");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_title_search_idx" ON "issues" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_identifier_search_idx" ON "issues" USING gin ("identifier" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "issues_description_search_idx" ON "issues" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_open_routine_execution_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id","origin_fingerprint") WHERE "issues"."origin_kind" = 'routine_execution'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."execution_run_id" is not null
          and "issues"."status" in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_active_liveness_recovery_incident_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'harness_liveness_escalation'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_active_liveness_recovery_leaf_uq" ON "issues" USING btree ("company_id","origin_kind","origin_fingerprint") WHERE "issues"."origin_kind" = 'harness_liveness_escalation'
          and "issues"."origin_fingerprint" <> 'default'
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_active_stale_run_evaluation_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'stale_active_run_evaluation'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_active_task_watchdog_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'task_watchdog'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_active_productivity_review_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'issue_productivity_review'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_active_stranded_issue_recovery_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'stranded_issue_recovery'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "issues_onboarding_first_task_uq" ON "issues" USING btree ("company_id") WHERE "issues"."origin_kind" = 'onboarding_first_task';--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "join_requests_invite_unique_idx" ON "join_requests" USING btree ("invite_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "join_requests_company_status_type_created_idx" ON "join_requests" USING btree ("company_id","status","request_type","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "join_requests_pending_human_user_uq" ON "join_requests" USING btree ("company_id","requesting_user_id") WHERE "join_requests"."request_type" = 'human' AND "join_requests"."status" = 'pending_approval' AND "join_requests"."requesting_user_id" IS NOT NULL;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "join_requests_pending_human_email_uq" ON "join_requests" USING btree ("company_id",lower("request_email_snapshot")) WHERE "join_requests"."request_type" = 'human' AND "join_requests"."status" = 'pending_approval' AND "join_requests"."request_email_snapshot" IS NOT NULL;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "labels_company_idx" ON "labels" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "labels_company_name_idx" ON "labels" USING btree ("company_id","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_automation_executions_idempotency_uq" ON "pipeline_automation_executions" USING btree ("case_id","automation_id","triggering_event_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_automation_executions_company_case_idx" ON "pipeline_automation_executions" USING btree ("company_id","case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_automation_executions_routine_idx" ON "pipeline_automation_executions" USING btree ("routine_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_automation_executions_execution_issue_idx" ON "pipeline_automation_executions" USING btree ("execution_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_automation_executions_retry_of_execution_idx" ON "pipeline_automation_executions" USING btree ("retry_of_execution_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_case_blockers_case_blocked_by_uq" ON "pipeline_case_blockers" USING btree ("case_id","blocked_by_case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_case_blockers_blocked_by_idx" ON "pipeline_case_blockers" USING btree ("blocked_by_case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_case_blockers_company_case_idx" ON "pipeline_case_blockers" USING btree ("company_id","case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_case_documents_company_case_key_uq" ON "pipeline_case_documents" USING btree ("company_id","case_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_case_documents_document_uq" ON "pipeline_case_documents" USING btree ("document_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_case_documents_company_case_updated_idx" ON "pipeline_case_documents" USING btree ("company_id","case_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_case_events_case_created_idx" ON "pipeline_case_events" USING btree ("case_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_case_events_company_case_idx" ON "pipeline_case_events" USING btree ("company_id","case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_case_issue_links_case_issue_uq" ON "pipeline_case_issue_links" USING btree ("case_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_case_issue_links_issue_idx" ON "pipeline_case_issue_links" USING btree ("issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_case_issue_links_company_case_idx" ON "pipeline_case_issue_links" USING btree ("company_id","case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_case_issue_links_automation_attempt_idx" ON "pipeline_case_issue_links" USING btree ("automation_attempt_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_cases_pipeline_case_key_uq" ON "pipeline_cases" USING btree ("pipeline_id","case_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_cases_parent_request_key_uq" ON "pipeline_cases" USING btree ("parent_case_id","request_key") WHERE "pipeline_cases"."request_key" is not null and "pipeline_cases"."retired_at" is null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_cases_company_idx" ON "pipeline_cases" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_cases_pipeline_stage_idx" ON "pipeline_cases" USING btree ("pipeline_id","stage_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_cases_parent_idx" ON "pipeline_cases" USING btree ("parent_case_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_cases_automation_attempt_idx" ON "pipeline_cases" USING btree ("automation_attempt_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_cases_retired_idx" ON "pipeline_cases" USING btree ("company_id","retired_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_cases_lease_expires_idx" ON "pipeline_cases" USING btree ("lease_expires_at") WHERE "pipeline_cases"."lease_expires_at" is not null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_documents_company_pipeline_key_uq" ON "pipeline_documents" USING btree ("company_id","pipeline_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_documents_document_uq" ON "pipeline_documents" USING btree ("document_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_documents_company_pipeline_updated_idx" ON "pipeline_documents" USING btree ("company_id","pipeline_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_stages_pipeline_key_uq" ON "pipeline_stages" USING btree ("pipeline_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_stages_pipeline_position_idx" ON "pipeline_stages" USING btree ("pipeline_id","position");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipeline_transitions_pipeline_edge_uq" ON "pipeline_transitions" USING btree ("pipeline_id","from_stage_id","to_stage_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_transitions_pipeline_from_idx" ON "pipeline_transitions" USING btree ("pipeline_id","from_stage_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipeline_transitions_pipeline_to_idx" ON "pipeline_transitions" USING btree ("pipeline_id","to_stage_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "pipelines_company_key_uq" ON "pipelines" USING btree ("company_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipelines_company_idx" ON "pipelines" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "pipelines_company_project_idx" ON "pipelines" USING btree ("company_id","project_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_company_settings_company_idx" ON "plugin_company_settings" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_company_settings_plugin_idx" ON "plugin_company_settings" USING btree ("plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "plugin_company_settings_company_plugin_uq" ON "plugin_company_settings" USING btree ("company_id","plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "plugin_config_plugin_company_idx" ON "plugin_config" USING btree ("plugin_id","company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "plugin_database_namespaces_plugin_idx" ON "plugin_database_namespaces" USING btree ("plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "plugin_database_namespaces_namespace_idx" ON "plugin_database_namespaces" USING btree ("namespace_name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_database_namespaces_status_idx" ON "plugin_database_namespaces" USING btree ("status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_entities_plugin_idx" ON "plugin_entities" USING btree ("plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_entities_company_idx" ON "plugin_entities" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_entities_type_idx" ON "plugin_entities" USING btree ("entity_type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_entities_scope_idx" ON "plugin_entities" USING btree ("scope_kind","scope_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_job_runs_job_idx" ON "plugin_job_runs" USING btree ("job_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_job_runs_plugin_idx" ON "plugin_job_runs" USING btree ("plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_job_runs_company_idx" ON "plugin_job_runs" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_job_runs_status_idx" ON "plugin_job_runs" USING btree ("status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_jobs_plugin_idx" ON "plugin_jobs" USING btree ("plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_jobs_next_run_idx" ON "plugin_jobs" USING btree ("next_run_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "plugin_jobs_unique_idx" ON "plugin_jobs" USING btree ("plugin_id","job_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_logs_plugin_time_idx" ON "plugin_logs" USING btree ("plugin_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_logs_company_idx" ON "plugin_logs" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_logs_level_idx" ON "plugin_logs" USING btree ("level");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_managed_resources_company_idx" ON "plugin_managed_resources" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_managed_resources_plugin_idx" ON "plugin_managed_resources" USING btree ("plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_managed_resources_resource_idx" ON "plugin_managed_resources" USING btree ("resource_kind","resource_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "plugin_managed_resources_company_plugin_resource_uq" ON "plugin_managed_resources" USING btree ("company_id","plugin_id","resource_kind","resource_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "plugin_migrations_plugin_key_idx" ON "plugin_migrations" USING btree ("plugin_id","migration_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_migrations_plugin_idx" ON "plugin_migrations" USING btree ("plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_migrations_status_idx" ON "plugin_migrations" USING btree ("status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_state_plugin_scope_idx" ON "plugin_state" USING btree ("plugin_id","scope_kind");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_webhook_deliveries_plugin_idx" ON "plugin_webhook_deliveries" USING btree ("plugin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_webhook_deliveries_company_idx" ON "plugin_webhook_deliveries" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_webhook_deliveries_status_idx" ON "plugin_webhook_deliveries" USING btree ("status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugin_webhook_deliveries_key_idx" ON "plugin_webhook_deliveries" USING btree ("webhook_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "plugins_plugin_key_idx" ON "plugins" USING btree ("plugin_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "plugins_status_idx" ON "plugins" USING btree ("status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "principal_permission_grants_unique_idx" ON "principal_permission_grants" USING btree ("company_id","principal_type","principal_id","permission_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "principal_permission_grants_company_permission_idx" ON "principal_permission_grants" USING btree ("company_id","permission_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_goals_project_idx" ON "project_goals" USING btree ("project_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_goals_goal_idx" ON "project_goals" USING btree ("goal_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_goals_company_idx" ON "project_goals" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_memberships_company_user_idx" ON "project_memberships" USING btree ("company_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_memberships_company_user_starred_idx" ON "project_memberships" USING btree ("company_id","user_id","starred_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_memberships_project_idx" ON "project_memberships" USING btree ("project_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "project_memberships_company_user_project_uq" ON "project_memberships" USING btree ("company_id","user_id","project_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_workspaces_company_project_idx" ON "project_workspaces" USING btree ("company_id","project_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_workspaces_project_primary_idx" ON "project_workspaces" USING btree ("project_id","is_primary");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_workspaces_project_source_type_idx" ON "project_workspaces" USING btree ("project_id","source_type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "project_workspaces_company_shared_key_idx" ON "project_workspaces" USING btree ("company_id","shared_workspace_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "project_workspaces_project_remote_ref_idx" ON "project_workspaces" USING btree ("project_id","remote_provider","remote_workspace_ref");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "projects_company_idx" ON "projects" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "routine_documents_company_routine_key_uq" ON "routine_documents" USING btree ("company_id","routine_id","key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "routine_documents_document_uq" ON "routine_documents" USING btree ("document_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_documents_company_routine_updated_idx" ON "routine_documents" USING btree ("company_id","routine_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "routine_revisions_routine_revision_uq" ON "routine_revisions" USING btree ("routine_id","revision_number");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_revisions_company_routine_created_idx" ON "routine_revisions" USING btree ("company_id","routine_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_revisions_company_responsible_user_idx" ON "routine_revisions" USING btree ("company_id","responsible_user_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_runs_company_routine_idx" ON "routine_runs" USING btree ("company_id","routine_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_runs_revision_idx" ON "routine_runs" USING btree ("routine_revision_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_runs_company_responsible_user_idx" ON "routine_runs" USING btree ("company_id","responsible_user_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_runs_trigger_idx" ON "routine_runs" USING btree ("trigger_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_runs_dispatch_fingerprint_idx" ON "routine_runs" USING btree ("routine_id","dispatch_fingerprint");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_runs_linked_issue_idx" ON "routine_runs" USING btree ("linked_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_runs_trigger_idempotency_idx" ON "routine_runs" USING btree ("trigger_id","idempotency_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_triggers_company_routine_idx" ON "routine_triggers" USING btree ("company_id","routine_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_triggers_company_kind_idx" ON "routine_triggers" USING btree ("company_id","kind");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_triggers_next_run_idx" ON "routine_triggers" USING btree ("next_run_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routine_triggers_public_id_idx" ON "routine_triggers" USING btree ("public_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "routine_triggers_public_id_uq" ON "routine_triggers" USING btree ("public_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routines_company_status_idx" ON "routines" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routines_company_assignee_idx" ON "routines" USING btree ("company_id","assignee_agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routines_company_project_idx" ON "routines" USING btree ("company_id","project_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routines_company_folder_idx" ON "routines" USING btree ("company_id","folder_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routines_company_responsible_user_idx" ON "routines" USING btree ("company_id","responsible_user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "routines_company_origin_idx" ON "routines" USING btree ("company_id","origin_kind","origin_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "secret_access_events_company_created_idx" ON "secret_access_events" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "secret_access_events_secret_created_idx" ON "secret_access_events" USING btree ("secret_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "secret_access_events_user_definition_created_idx" ON "secret_access_events" USING btree ("user_secret_definition_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "secret_access_events_company_credential_owner_idx" ON "secret_access_events" USING btree ("company_id","credential_owner_user_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "secret_access_events_consumer_idx" ON "secret_access_events" USING btree ("company_id","consumer_type","consumer_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "secret_access_events_run_idx" ON "secret_access_events" USING btree ("heartbeat_run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "smoke_run_steps_company_run_idx" ON "smoke_run_steps" USING btree ("company_id","run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "smoke_run_steps_company_path_idx" ON "smoke_run_steps" USING btree ("company_id","path");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "smoke_runs_company_started_idx" ON "smoke_runs" USING btree ("company_id","started_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "smoke_runs_company_status_idx" ON "smoke_runs" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "status_card_updates_card_started_idx" ON "status_card_updates" USING btree ("card_id","started_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "status_card_updates_generation_issue_idx" ON "status_card_updates" USING btree ("generation_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "status_cards_company_archived_idx" ON "status_cards" USING btree ("company_id","archived_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "status_cards_company_next_eval_idx" ON "status_cards" USING btree ("company_id","next_eval_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "summary_slots_document_uq" ON "summary_slots" USING btree ("document_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "summary_slots_company_scope_idx" ON "summary_slots" USING btree ("company_id","scope_kind","scope_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "summary_slots_company_generating_issue_idx" ON "summary_slots" USING btree ("company_id","generating_issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "summary_slots_company_updated_idx" ON "summary_slots" USING btree ("company_id","updated_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_access_audit_company_created_idx" ON "tool_access_audit_events" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_access_audit_connection_idx" ON "tool_access_audit_events" USING btree ("connection_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_access_audit_gateway_idx" ON "tool_access_audit_events" USING btree ("company_id","gateway_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_action_requests_company_status_idx" ON "tool_action_requests" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_action_requests_invocation_idx" ON "tool_action_requests" USING btree ("invocation_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_action_requests_issue_idx" ON "tool_action_requests" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_applications_company_idx" ON "tool_applications" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_applications_company_status_idx" ON "tool_applications" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_applications_company_name_uq" ON "tool_applications" USING btree ("company_id","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_applications_company_key_uq" ON "tool_applications" USING btree ("company_id","application_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_call_events_company_created_idx" ON "tool_call_events" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_call_events_run_idx" ON "tool_call_events" USING btree ("company_id","run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_call_events_issue_idx" ON "tool_call_events" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_call_events_invocation_idx" ON "tool_call_events" USING btree ("invocation_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_call_events_gateway_idx" ON "tool_call_events" USING btree ("company_id","gateway_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_catalog_entries_company_idx" ON "tool_catalog_entries" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_catalog_entries_application_idx" ON "tool_catalog_entries" USING btree ("application_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_catalog_entries_connection_idx" ON "tool_catalog_entries" USING btree ("connection_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_catalog_entries_company_status_idx" ON "tool_catalog_entries" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_catalog_entries_connection_name_uq" ON "tool_catalog_entries" USING btree ("connection_id","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_connection_installs_company_target_idx" ON "tool_connection_installs" USING btree ("company_id","target_type","target_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_connection_installs_connection_idx" ON "tool_connection_installs" USING btree ("company_id","connection_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_connection_installs_target_uq" ON "tool_connection_installs" USING btree ("company_id","connection_id","target_type","target_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_connections_company_idx" ON "tool_connections" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_connections_application_idx" ON "tool_connections" USING btree ("application_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_connections_company_enabled_idx" ON "tool_connections" USING btree ("company_id","enabled");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_connections_company_uid_uq" ON "tool_connections" USING btree ("company_id","uid");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_gateway_rate_limit_counters_company_idx" ON "tool_gateway_rate_limit_counters" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_gateway_rate_limit_counters_window_uq" ON "tool_gateway_rate_limit_counters" USING btree ("company_id","counter_key","window_start_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_gateway_sessions_token_hash_uq" ON "tool_gateway_sessions" USING btree ("token_hash");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_gateway_sessions_company_agent_idx" ON "tool_gateway_sessions" USING btree ("company_id","agent_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_gateway_sessions_company_expires_idx" ON "tool_gateway_sessions" USING btree ("company_id","expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_gateway_sessions_run_idx" ON "tool_gateway_sessions" USING btree ("company_id","run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_gateway_sessions_issue_idx" ON "tool_gateway_sessions" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_gateway_sessions_gateway_idx" ON "tool_gateway_sessions" USING btree ("company_id","gateway_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_invocations_company_created_idx" ON "tool_invocations" USING btree ("company_id","created_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_invocations_run_idx" ON "tool_invocations" USING btree ("company_id","run_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_invocations_issue_idx" ON "tool_invocations" USING btree ("company_id","issue_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_invocations_gateway_idx" ON "tool_invocations" USING btree ("company_id","gateway_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_invocations_company_idempotency_uq" ON "tool_invocations" USING btree ("company_id","idempotency_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_mcp_gateway_tokens_token_hash_uq" ON "tool_mcp_gateway_tokens" USING btree ("token_hash");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_mcp_gateway_tokens_gateway_idx" ON "tool_mcp_gateway_tokens" USING btree ("company_id","gateway_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_mcp_gateway_tokens_subject_idx" ON "tool_mcp_gateway_tokens" USING btree ("company_id","subject_type","subject_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_mcp_gateway_tokens_company_expires_idx" ON "tool_mcp_gateway_tokens" USING btree ("company_id","expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_mcp_gateways_company_idx" ON "tool_mcp_gateways" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_mcp_gateways_company_status_idx" ON "tool_mcp_gateways" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_mcp_gateways_profile_idx" ON "tool_mcp_gateways" USING btree ("company_id","profile_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_mcp_gateways_public_id_uq" ON "tool_mcp_gateways" USING btree ("gateway_public_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_mcp_gateways_company_slug_uq" ON "tool_mcp_gateways" USING btree ("company_id","slug");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_mcp_gateways_company_name_uq" ON "tool_mcp_gateways" USING btree ("company_id","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_oauth_states_company_idx" ON "tool_oauth_states" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_oauth_states_connection_idx" ON "tool_oauth_states" USING btree ("connection_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_oauth_states_actor_idx" ON "tool_oauth_states" USING btree ("created_by_actor_type","created_by_actor_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_oauth_states_expires_at_idx" ON "tool_oauth_states" USING btree ("expires_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_policies_company_enabled_idx" ON "tool_policies" USING btree ("company_id","enabled");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_policies_company_type_idx" ON "tool_policies" USING btree ("company_id","policy_type");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_policies_company_name_uq" ON "tool_policies" USING btree ("company_id","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_profile_bindings_company_target_idx" ON "tool_profile_bindings" USING btree ("company_id","target_type","target_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_profile_bindings_target_profile_uq" ON "tool_profile_bindings" USING btree ("company_id","target_type","target_id","profile_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_profile_entries_company_profile_idx" ON "tool_profile_entries" USING btree ("company_id","profile_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_profile_entries_application_idx" ON "tool_profile_entries" USING btree ("company_id","application_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_profile_entries_connection_idx" ON "tool_profile_entries" USING btree ("company_id","connection_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_profile_entries_catalog_entry_idx" ON "tool_profile_entries" USING btree ("company_id","catalog_entry_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_profiles_company_status_idx" ON "tool_profiles" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_profiles_company_key_uq" ON "tool_profiles" USING btree ("company_id","profile_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_profiles_company_name_uq" ON "tool_profiles" USING btree ("company_id","name");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_rate_limit_counters_company_idx" ON "tool_rate_limit_counters" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_rate_limit_counters_window_uq" ON "tool_rate_limit_counters" USING btree ("company_id","policy_id","counter_key","window_kind","window_start_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_runtime_metric_counters_company_metric_idx" ON "tool_runtime_metric_counters" USING btree ("company_id","metric","bucket_start_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_runtime_metric_counters_bucket_uq" ON "tool_runtime_metric_counters" USING btree ("company_id","metric","bucket_start_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_runtime_slots_company_idx" ON "tool_runtime_slots" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_runtime_slots_connection_idx" ON "tool_runtime_slots" USING btree ("connection_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_runtime_slots_execution_workspace_idx" ON "tool_runtime_slots" USING btree ("company_id","execution_workspace_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_runtime_slots_slot_key_uq" ON "tool_runtime_slots" USING btree ("company_id","slot_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_stdio_command_templates_company_idx" ON "tool_stdio_command_templates" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "tool_stdio_command_templates_company_status_idx" ON "tool_stdio_command_templates" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "tool_stdio_command_templates_company_key_uq" ON "tool_stdio_command_templates" USING btree ("company_id","template_key");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "user_inbox_agent_policies_company_user_uq" ON "user_inbox_agent_policies" USING btree ("company_id","user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_inbox_agent_policies_allowed_agent_ids_idx" ON "user_inbox_agent_policies" USING gin ("allowed_agent_ids");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_secret_declarations_company_idx" ON "user_secret_declarations" USING btree ("company_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_secret_declarations_definition_idx" ON "user_secret_declarations" USING btree ("user_secret_definition_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_secret_declarations_target_idx" ON "user_secret_declarations" USING btree ("company_id","target_type","target_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_secret_declarations_company_required_idx" ON "user_secret_declarations" USING btree ("company_id","required");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "user_secret_declarations_target_path_uq" ON "user_secret_declarations" USING btree ("company_id","target_type","target_id","config_path");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_secret_declarations_required_override_idx" ON "user_secret_declarations" USING btree ("company_id","allow_missing_override") WHERE "user_secret_declarations"."allow_missing_override" = true;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_secret_definitions_company_status_idx" ON "user_secret_definitions" USING btree ("company_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_secret_definitions_company_provider_idx" ON "user_secret_definitions" USING btree ("company_id","provider");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "user_secret_definitions_provider_config_idx" ON "user_secret_definitions" USING btree ("provider_config_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "user_secret_definitions_company_key_uq" ON "user_secret_definitions" USING btree ("company_id","key") WHERE "user_secret_definitions"."deleted_at" is null;--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE UNIQUE INDEX "user_sidebar_preferences_user_uq" ON "user_sidebar_preferences" USING btree ("user_id");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "workspace_operations_company_run_started_idx" ON "workspace_operations" USING btree ("company_id","heartbeat_run_id","started_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "workspace_operations_company_workspace_started_idx" ON "workspace_operations" USING btree ("company_id","execution_workspace_id","started_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "workspace_operations_company_workspace_issue_started_idx" ON "workspace_operations" USING btree ("company_id","execution_workspace_id","issue_id","started_at");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "workspace_runtime_services_company_workspace_status_idx" ON "workspace_runtime_services" USING btree ("company_id","project_workspace_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "workspace_runtime_services_company_execution_workspace_status_idx" ON "workspace_runtime_services" USING btree ("company_id","execution_workspace_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "workspace_runtime_services_company_project_status_idx" ON "workspace_runtime_services" USING btree ("company_id","project_id","status");--> statement-breakpoint
-- pilot:migration-safety-ignore large-create-index-not-concurrently: initial baseline
CREATE INDEX "workspace_runtime_services_run_idx" ON "workspace_runtime_services" USING btree ("started_by_run_id");--> statement-breakpoint
CREATE TRIGGER agents_cleanup_inbox_policy_allowlists AFTER DELETE ON "agents" FOR EACH ROW EXECUTE FUNCTION public.remove_deleted_agent_from_inbox_policy_allowlists();
--> statement-breakpoint
