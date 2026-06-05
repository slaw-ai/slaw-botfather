CREATE TABLE "activity_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_fk" uuid NOT NULL,
	"local_id" text NOT NULL,
	"squad_local_id" text,
	"action" text NOT NULL,
	"entity_ref" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_fk" uuid NOT NULL,
	"squad_fk" uuid,
	"local_id" text NOT NULL,
	"squad_local_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"adapter_type" text NOT NULL,
	"budget_monthly_cents" integer,
	"spent_monthly_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"instance_fk" uuid,
	"squad_local_id" text,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auto_approve_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"field" text DEFAULT 'hostname' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_fk" uuid NOT NULL,
	"local_id" text NOT NULL,
	"squad_local_id" text NOT NULL,
	"agent_local_id" text,
	"issue_local_id" text,
	"project_local_id" text,
	"provider" text NOT NULL,
	"biller" text,
	"billing_type" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" bigint NOT NULL,
	"cached_input_tokens" bigint NOT NULL,
	"output_tokens" bigint NOT NULL,
	"cost_cents" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"instance_fk" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"matched_rule" text
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_fk" uuid NOT NULL,
	"instance_id" text NOT NULL,
	"slaw_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"api_key_hash" text,
	"api_key_fingerprint" text,
	"user_principal" text,
	"report_issue_titles" boolean DEFAULT true NOT NULL,
	"enrolled_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"last_sync_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_fk" uuid NOT NULL,
	"squad_fk" uuid,
	"local_id" text NOT NULL,
	"squad_local_id" text NOT NULL,
	"project_local_id" text,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"assignee_agent_local_id" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" text NOT NULL,
	"hostname" text NOT NULL,
	"os" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_fk" uuid NOT NULL,
	"squad_fk" uuid,
	"local_id" text NOT NULL,
	"squad_local_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollups_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" text NOT NULL,
	"instance_fk" uuid,
	"squad_local_id" text,
	"agent_local_id" text,
	"model" text,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_fk" uuid NOT NULL,
	"local_id" text NOT NULL,
	"agent_local_id" text NOT NULL,
	"squad_local_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_fk" uuid NOT NULL,
	"local_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"budget_monthly_cents" integer,
	"spent_monthly_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_facts" ADD CONSTRAINT "activity_facts_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_squad_fk_squads_id_fk" FOREIGN KEY ("squad_fk") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_facts" ADD CONSTRAINT "cost_facts_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_machine_fk_machines_id_fk" FOREIGN KEY ("machine_fk") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_squad_fk_squads_id_fk" FOREIGN KEY ("squad_fk") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_squad_fk_squads_id_fk" FOREIGN KEY ("squad_fk") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollups_daily" ADD CONSTRAINT "rollups_daily_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_facts" ADD CONSTRAINT "run_facts_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squads" ADD CONSTRAINT "squads_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_facts_instance_local_uq" ON "activity_facts" USING btree ("instance_fk","local_id");--> statement-breakpoint
CREATE INDEX "activity_facts_action_idx" ON "activity_facts" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_instance_local_uq" ON "agents" USING btree ("instance_fk","local_id");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_facts_instance_local_uq" ON "cost_facts" USING btree ("instance_fk","local_id");--> statement-breakpoint
CREATE INDEX "cost_facts_occurred_idx" ON "cost_facts" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "cost_facts_squad_idx" ON "cost_facts" USING btree ("instance_fk","squad_local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_enrollment_id_uq" ON "enrollments" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "enrollments_state_idx" ON "enrollments" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_machine_instance_uq" ON "instances" USING btree ("machine_fk","instance_id");--> statement-breakpoint
CREATE INDEX "instances_api_key_fp_idx" ON "instances" USING btree ("api_key_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_instance_local_uq" ON "issues" USING btree ("instance_fk","local_id");--> statement-breakpoint
CREATE INDEX "issues_status_idx" ON "issues" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_machine_id_uq" ON "machines" USING btree ("machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_instance_local_uq" ON "projects" USING btree ("instance_fk","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rollups_daily_uq" ON "rollups_daily" USING btree ("day","instance_fk","squad_local_id","agent_local_id","model");--> statement-breakpoint
CREATE UNIQUE INDEX "run_facts_dedupe_uq" ON "run_facts" USING btree ("instance_fk","local_id","status","occurred_at");--> statement-breakpoint
CREATE INDEX "run_facts_occurred_idx" ON "run_facts" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "squads_instance_local_uq" ON "squads" USING btree ("instance_fk","local_id");