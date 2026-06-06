CREATE TABLE "enterprise_limits" (
	"key" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"cost_limit_cents" integer,
	"token_limit" bigint,
	"warn_percent" integer DEFAULT 80 NOT NULL,
	"mode" text DEFAULT 'soft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_limit_overrides" (
	"instance_fk" uuid PRIMARY KEY NOT NULL,
	"cost_limit_cents" integer,
	"token_limit" bigint,
	"warn_percent" integer,
	"mode" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "limit_version_acked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_limit_overrides" ADD CONSTRAINT "instance_limit_overrides_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;