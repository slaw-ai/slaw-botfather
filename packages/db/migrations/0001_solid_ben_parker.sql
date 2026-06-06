CREATE TABLE "squad_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_fk" uuid NOT NULL,
	"squad_fk" uuid,
	"local_id" text NOT NULL,
	"squad_local_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_type" text NOT NULL,
	"trust_level" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "capabilities" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "reports_to_local_id" text;--> statement-breakpoint
ALTER TABLE "squad_skills" ADD CONSTRAINT "squad_skills_instance_fk_instances_id_fk" FOREIGN KEY ("instance_fk") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_skills" ADD CONSTRAINT "squad_skills_squad_fk_squads_id_fk" FOREIGN KEY ("squad_fk") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "squad_skills_instance_local_uq" ON "squad_skills" USING btree ("instance_fk","local_id");