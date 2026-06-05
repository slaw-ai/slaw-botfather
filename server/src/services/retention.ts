import { sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";

/**
 * Retention (ARCHITECTURE §7.1): raw cost facts 13 months, run facts 90 days,
 * activity facts 12 months, resolved alerts 90 days. Rollups kept indefinitely.
 * Runs daily.
 */
export async function runRetention(db: BotfatherDb): Promise<void> {
  await db.execute(sql`DELETE FROM cost_facts WHERE occurred_at < now() - interval '13 months'`);
  await db.execute(sql`DELETE FROM run_facts WHERE occurred_at < now() - interval '90 days'`);
  await db.execute(sql`DELETE FROM activity_facts WHERE occurred_at < now() - interval '12 months'`);
  await db.execute(
    sql`DELETE FROM alerts WHERE status = 'resolved' AND resolved_at < now() - interval '90 days'`,
  );
}

export function startRetentionJob(db: BotfatherDb): NodeJS.Timeout {
  const run = () => runRetention(db).catch((err) => console.error("retention job failed", err));
  const timer = setInterval(run, 24 * 3600_000);
  timer.unref();
  return timer;
}
