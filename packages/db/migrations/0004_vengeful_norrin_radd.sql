CREATE TABLE "skill_catalog_state" (
	"key" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"catalog_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"markdown" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT 'authored' NOT NULL,
	"source_locator" text,
	"source_ref" text,
	"trust_level" text DEFAULT 'markdown_only' NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_hash" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "skill_catalog_version_acked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_library_key_uq" ON "skill_library" USING btree ("key");--> statement-breakpoint
CREATE INDEX "skill_library_status_idx" ON "skill_library" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skill_library_category_idx" ON "skill_library" USING btree ("category");