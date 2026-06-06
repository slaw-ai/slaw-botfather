ALTER TABLE "instances" ADD COLUMN "limit_version_issued" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "limit_issued_content" text;--> statement-breakpoint
-- Seed the new monotonic issued-version from the old acked version so already-
-- enrolled instances re-issue ABOVE what they previously applied. Content stays
-- NULL, so the next directive build detects a change and bumps issued = acked+1
-- (> acked), guaranteeing a cleared/changed limit propagates after this upgrade.
UPDATE "instances" SET "limit_version_issued" = "limit_version_acked";
