import { sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";

/**
 * Materialize rollups_daily from cost_facts. Idempotent: recomputes the
 * affected days and upserts. ARCHITECTURE §7.1 — rollups power dashboards;
 * raw facts stay the source of truth.
 *
 * Granularity: one row per (day, instance, squad, agent, model). Higher-level
 * aggregates (network/day, by-model) are SUMs over this table at query time.
 */
export async function materializeRollups(db: BotfatherDb, sinceDays = 2): Promise<number> {
  const res = await db.execute(sql`
    INSERT INTO rollups_daily
      (day, instance_fk, squad_local_id, agent_local_id, model,
       input_tokens, cached_input_tokens, output_tokens, cost_cents)
    SELECT
      to_char(cf.occurred_at AT TIME ZONE 'utc', 'YYYY-MM-DD') AS day,
      cf.instance_fk,
      cf.squad_local_id,
      cf.agent_local_id,
      cf.model,
      sum(cf.input_tokens)::bigint,
      sum(cf.cached_input_tokens)::bigint,
      sum(cf.output_tokens)::bigint,
      sum(cf.cost_cents)::int
    FROM cost_facts cf
    WHERE cf.occurred_at >= (now() AT TIME ZONE 'utc')::date - ${sinceDays}::int
    GROUP BY 1, 2, 3, 4, 5
    ON CONFLICT (day, instance_fk, squad_local_id, agent_local_id, model)
    DO UPDATE SET
      input_tokens = EXCLUDED.input_tokens,
      cached_input_tokens = EXCLUDED.cached_input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      cost_cents = EXCLUDED.cost_cents
  `);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export function startRollupJob(db: BotfatherDb): NodeJS.Timeout {
  const run = () =>
    materializeRollups(db).catch((err) => console.error("rollup job failed", err));
  run();
  const timer = setInterval(run, 3600_000); // hourly
  timer.unref();
  return timer;
}
