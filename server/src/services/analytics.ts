import { sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { rows } from "./sql-util.js";

export interface NetworkSummary {
  spendTodayCents: number;
  spendMtdCents: number;
  forecastEomCents: number;
  inputTokensMtd: number;
  cachedInputTokensMtd: number;
  outputTokensMtd: number;
  issuesClosedMtd: number;
  costPerIssueCents: number;
}

export async function networkSummary(db: BotfatherDb): Promise<NetworkSummary> {
  const [row] = rows<{
    spend_today: number;
    spend_mtd: number;
    in_mtd: number;
    cached_mtd: number;
    out_mtd: number;
    forecast_eom: number;
  }>(await db.execute(sql`
    WITH mtd AS (
      SELECT
        coalesce(sum(cost_cents), 0)::int AS spend_mtd,
        coalesce(sum(input_tokens), 0)::bigint AS in_mtd,
        coalesce(sum(cached_input_tokens), 0)::bigint AS cached_mtd,
        coalesce(sum(output_tokens), 0)::bigint AS out_mtd
      FROM cost_facts
      WHERE occurred_at >= date_trunc('month', now() at time zone 'utc')
    ),
    today AS (
      SELECT coalesce(sum(cost_cents), 0)::int AS spend_today
      FROM cost_facts
      WHERE occurred_at >= date_trunc('day', now() at time zone 'utc')
    )
    SELECT
      today.spend_today,
      mtd.spend_mtd, mtd.in_mtd, mtd.cached_mtd, mtd.out_mtd,
      -- linear forecast: mtd / day_of_month * days_in_month
      (mtd.spend_mtd::numeric
        / greatest(extract(day from now() at time zone 'utc')::int, 1)
        * extract(day from (date_trunc('month', now() at time zone 'utc') + interval '1 month - 1 day'))::int
      )::int AS forecast_eom
    FROM today, mtd
  `));

  // closed issues MTD = issues currently in a done/closed status updated this month
  const [closedRow] = rows<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n FROM issues
    WHERE lower(status) IN ('done', 'closed', 'completed')
      AND updated_at >= date_trunc('month', now() at time zone 'utc')
  `));

  const issuesClosedMtd = closedRow?.n ?? 0;
  const spendMtd = row?.spend_mtd ?? 0;

  return {
    spendTodayCents: row?.spend_today ?? 0,
    spendMtdCents: spendMtd,
    forecastEomCents: row?.forecast_eom ?? 0,
    inputTokensMtd: Number(row?.in_mtd ?? 0),
    cachedInputTokensMtd: Number(row?.cached_mtd ?? 0),
    outputTokensMtd: Number(row?.out_mtd ?? 0),
    issuesClosedMtd,
    costPerIssueCents: issuesClosedMtd > 0 ? Math.round(spendMtd / issuesClosedMtd) : 0,
  };
}

export async function spendByDay(db: BotfatherDb, days = 14) {
  return rows<{ day: string; cost_cents: number; input_tokens: number; output_tokens: number }>(
    await db.execute(sql`
      SELECT day, sum(cost_cents)::int AS cost_cents,
             sum(input_tokens)::bigint AS input_tokens,
             sum(output_tokens)::bigint AS output_tokens
      FROM rollups_daily
      WHERE day >= to_char((now() at time zone 'utc')::date - ${days}::int, 'YYYY-MM-DD')
      GROUP BY day ORDER BY day
    `),
  );
}

export async function costByModelMtd(db: BotfatherDb) {
  return rows<{ model: string; cost_cents: number; input_tokens: number; output_tokens: number }>(
    await db.execute(sql`
      SELECT model, sum(cost_cents)::int AS cost_cents,
             sum(input_tokens)::bigint AS input_tokens,
             sum(output_tokens)::bigint AS output_tokens
      FROM cost_facts
      WHERE occurred_at >= date_trunc('month', now() at time zone 'utc')
      GROUP BY model ORDER BY cost_cents DESC
    `),
  );
}

export async function costByBillingTypeMtd(db: BotfatherDb) {
  return rows<{ billing_type: string; cost_cents: number }>(
    await db.execute(sql`
      SELECT billing_type, sum(cost_cents)::int AS cost_cents
      FROM cost_facts
      WHERE occurred_at >= date_trunc('month', now() at time zone 'utc')
      GROUP BY billing_type ORDER BY cost_cents DESC
    `),
  );
}

export async function topBurnerInstancesMtd(db: BotfatherDb, limit = 10) {
  return rows<{ hostname: string; instance_id: string; instance_id_fk: string; cost_cents: number; tokens: number }>(
    await db.execute(sql`
      SELECT m.hostname, i.instance_id, i.id AS instance_id_fk,
             sum(cf.cost_cents)::int AS cost_cents,
             sum(cf.input_tokens + cf.output_tokens)::bigint AS tokens
      FROM cost_facts cf
      JOIN instances i ON i.id = cf.instance_fk
      JOIN machines m ON m.id = i.machine_fk
      WHERE cf.occurred_at >= date_trunc('month', now() at time zone 'utc')
      GROUP BY m.hostname, i.instance_id, i.id
      ORDER BY cost_cents DESC LIMIT ${limit}
    `),
  );
}

export async function topBurnerSquadsMtd(db: BotfatherDb, limit = 10) {
  return rows<{
    squad_local_id: string;
    squad_name: string | null;
    hostname: string;
    cost_cents: number;
    budget_monthly_cents: number | null;
    spent_monthly_cents: number | null;
  }>(
    await db.execute(sql`
      SELECT cf.squad_local_id, s.name AS squad_name, m.hostname,
             sum(cf.cost_cents)::int AS cost_cents,
             s.budget_monthly_cents, s.spent_monthly_cents
      FROM cost_facts cf
      JOIN instances i ON i.id = cf.instance_fk
      JOIN machines m ON m.id = i.machine_fk
      LEFT JOIN squads s ON s.instance_fk = cf.instance_fk AND s.local_id = cf.squad_local_id
      WHERE cf.occurred_at >= date_trunc('month', now() at time zone 'utc')
      GROUP BY cf.squad_local_id, s.name, m.hostname, s.budget_monthly_cents, s.spent_monthly_cents
      ORDER BY cost_cents DESC LIMIT ${limit}
    `),
  );
}
