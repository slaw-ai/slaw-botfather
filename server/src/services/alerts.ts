import { and, eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { alerts, instances, machines } from "@slaw-botfather/db";
import type { BotfatherConfig } from "../config.js";
import { rows } from "./sql-util.js";
import { resolveLimits } from "./limits.js";
import { getCatalogVersion } from "./skill-registry.js";

export type Severity = "critical" | "warning" | "info";

export interface AlertCandidate {
  rule: string;
  severity: Severity;
  instanceFk: string | null;
  squadLocalId: string | null;
  title: string;
  detail: string;
  /** stable key so re-evaluation doesn't create duplicates */
  dedupeKey: string;
}

/**
 * Upsert an active alert keyed by (rule + dedupeKey). If an identical active
 * alert already exists, do nothing; otherwise insert.
 */
async function raise(db: BotfatherDb, c: AlertCandidate): Promise<void> {
  const existing = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.rule, c.rule),
        eq(alerts.status, "active"),
        c.instanceFk ? eq(alerts.instanceFk, c.instanceFk) : sql`${alerts.instanceFk} is null`,
        c.squadLocalId ? eq(alerts.squadLocalId, c.squadLocalId) : sql`${alerts.squadLocalId} is null`,
      ),
    )
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(alerts).values({
    rule: c.rule,
    severity: c.severity,
    status: "active",
    instanceFk: c.instanceFk,
    squadLocalId: c.squadLocalId,
    title: c.title,
    detail: c.detail,
  });
}

/** Resolve active alerts for a rule whose condition no longer holds. */
async function resolveWhere(db: BotfatherDb, rule: string, keepInstanceFks: string[]): Promise<void> {
  if (keepInstanceFks.length === 0) {
    await db
      .update(alerts)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(and(eq(alerts.rule, rule), eq(alerts.status, "active")));
    return;
  }
  await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(
      and(
        eq(alerts.rule, rule),
        eq(alerts.status, "active"),
        sql`${alerts.instanceFk} is null or ${alerts.instanceFk} not in (${sql.join(
          keepInstanceFks.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
}

/* ─────────── individual rules ─────────── */

/** Budget breaches come straight from instance activity facts. */
async function evalBudgetAlerts(db: BotfatherDb): Promise<void> {
  const candidates = rows<{
    instance_fk: string;
    squad_local_id: string | null;
    action: string;
    squad_name: string | null;
    spent_monthly_cents: number | null;
    budget_monthly_cents: number | null;
    hostname: string;
    instance_id: string;
  }>(
    await db.execute(sql`
      SELECT af.instance_fk, af.squad_local_id, af.action,
             s.name AS squad_name, s.spent_monthly_cents, s.budget_monthly_cents,
             m.hostname, i.instance_id
      FROM activity_facts af
      JOIN instances i ON i.id = af.instance_fk
      JOIN machines m ON m.id = i.machine_fk
      LEFT JOIN squads s ON s.instance_fk = af.instance_fk AND s.local_id = af.squad_local_id
      WHERE af.action IN ('budget_hard_threshold_crossed', 'budget_soft_threshold_crossed')
        AND af.occurred_at >= now() - interval '35 days'
        AND (s.status IS NULL OR s.status = 'active')
    `),
  );

  for (const r of candidates) {
    const hard = r.action === "budget_hard_threshold_crossed";
    await raise(db, {
      rule: hard ? "budget_hard_breach" : "budget_soft_threshold",
      severity: hard ? "critical" : "warning",
      instanceFk: r.instance_fk,
      squadLocalId: r.squad_local_id,
      title: `${hard ? "Hard budget breach" : "Soft threshold 80%"} — ${r.squad_name ?? r.squad_local_id}`,
      detail: `${r.hostname} · ${r.instance_id} · spend ${(r.spent_monthly_cents ?? 0) / 100} of ${(r.budget_monthly_cents ?? 0) / 100}`,
      dedupeKey: `${r.instance_fk}:${r.squad_local_id}`,
    });
  }
}

async function evalInstanceHealth(db: BotfatherDb): Promise<void> {
  const offline = (await db
    .select({ id: instances.id, instanceId: instances.instanceId, hostname: machines.hostname, status: instances.status })
    .from(instances)
    .innerJoin(machines, eq(instances.machineFk, machines.id))
    .where(eq(instances.status, "offline"))) as Array<{ id: string; instanceId: string; hostname: string; status: string }>;
  for (const o of offline) {
    await raise(db, {
      rule: "instance_offline",
      severity: "warning",
      instanceFk: o.id,
      squadLocalId: null,
      title: `Instance offline — ${o.hostname}`,
      detail: `${o.hostname} · ${o.instanceId} missed 3 heartbeats`,
      dedupeKey: o.id,
    });
  }
  await resolveWhere(db, "instance_offline", offline.map((o) => o.id));

  const stale = (await db
    .select({ id: instances.id, instanceId: instances.instanceId, hostname: machines.hostname })
    .from(instances)
    .innerJoin(machines, eq(instances.machineFk, machines.id))
    .where(eq(instances.status, "stale"))) as Array<{ id: string; instanceId: string; hostname: string }>;
  for (const s of stale) {
    await raise(db, {
      rule: "instance_stale",
      severity: "info",
      instanceFk: s.id,
      squadLocalId: null,
      title: `Instance stale — ${s.hostname}`,
      detail: `${s.hostname} · ${s.instanceId} silent > 24h`,
      dedupeKey: s.id,
    });
  }
  await resolveWhere(db, "instance_stale", stale.map((s) => s.id));
}

/** Day spend > 3× trailing-7-day average (per instance), from rollups. */
async function evalSpendSpike(db: BotfatherDb): Promise<void> {
  const spikes = rows<{
    instance_fk: string;
    today_cost: number;
    avg_cost: number;
    hostname: string;
    instance_id: string;
  }>(
    await db.execute(sql`
      WITH per_day AS (
        SELECT instance_fk, day, sum(cost_cents)::int AS cost
        FROM rollups_daily
        WHERE day >= to_char((now() at time zone 'utc')::date - 8, 'YYYY-MM-DD')
        GROUP BY instance_fk, day
      ),
      today AS (
        SELECT instance_fk, cost FROM per_day
        WHERE day = to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD')
      ),
      prior AS (
        SELECT instance_fk, avg(cost) AS avg_cost FROM per_day
        WHERE day < to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD')
        GROUP BY instance_fk
      )
      SELECT t.instance_fk, t.cost AS today_cost, tr.avg_cost, m.hostname, i.instance_id
      FROM today t
      JOIN prior tr ON tr.instance_fk = t.instance_fk
      JOIN instances i ON i.id = t.instance_fk
      JOIN machines m ON m.id = i.machine_fk
      WHERE tr.avg_cost > 0 AND t.cost > tr.avg_cost * 3
    `),
  );
  const flagged: string[] = [];
  for (const r of spikes) {
    flagged.push(r.instance_fk);
    await raise(db, {
      rule: "spend_spike",
      severity: "warning",
      instanceFk: r.instance_fk,
      squadLocalId: null,
      title: `Spend spike — ${r.hostname}`,
      detail: `${r.hostname} · today $${(r.today_cost / 100).toFixed(2)} vs 7-day avg $${(r.avg_cost / 100).toFixed(2)}`,
      dedupeKey: r.instance_fk,
    });
  }
  await resolveWhere(db, "spend_spike", flagged);
}

/** Version drift: instances below the highest seen slawVersion. */
async function evalVersionDrift(db: BotfatherDb, fleetTarget: string | null): Promise<void> {
  if (!fleetTarget) return;
  const rows = (await db
    .select({ id: instances.id, slawVersion: instances.slawVersion, hostname: machines.hostname })
    .from(instances)
    .innerJoin(machines, eq(instances.machineFk, machines.id))) as Array<{
    id: string;
    slawVersion: string;
    hostname: string;
  }>;
  const drifted = rows.filter((r) => cmpSemver(r.slawVersion, fleetTarget) < 0);
  if (drifted.length > 0) {
    await raise(db, {
      rule: "version_drift",
      severity: "info",
      instanceFk: null,
      squadLocalId: null,
      title: `Version drift — ${drifted.length} instance(s) below ${fleetTarget}`,
      detail: drifted.map((d) => `${d.hostname}@${d.slawVersion}`).join(", ").slice(0, 480),
      dedupeKey: "fleet",
    });
  } else {
    await resolveWhere(db, "version_drift", []);
  }
}

/**
 * Skill catalog drift — flag active instances stuck below the current published
 * catalog version (they haven't pulled the latest skills). Info-level; resolves
 * once every active instance has acked the current catalog version. Only fires
 * when there's a published catalog (catalogVersion > 0).
 */
async function evalSkillVersionDrift(db: BotfatherDb): Promise<void> {
  const catalogVersion = await getCatalogVersion(db);
  if (catalogVersion <= 0) {
    await resolveWhere(db, "skill_version_drift", []);
    return;
  }
  const driftRows = rows<{ hostname: string; acked: number }>(
    await db.execute(sql`
      SELECT m.hostname AS hostname, i.skill_catalog_version_acked AS acked
      FROM instances i
      JOIN machines m ON m.id = i.machine_fk
      WHERE i.status IN ('ok','offline','stale')
        AND i.skill_catalog_version_acked < ${catalogVersion}
    `),
  );
  if (driftRows.length > 0) {
    await raise(db, {
      rule: "skill_version_drift",
      severity: "info",
      instanceFk: null,
      squadLocalId: null,
      title: `Skill catalog drift — ${driftRows.length} instance(s) below v${catalogVersion}`,
      detail: driftRows.map((d) => `${d.hostname}@v${Number(d.acked)}`).join(", ").slice(0, 480),
      dedupeKey: "fleet",
    });
  } else {
    await resolveWhere(db, "skill_version_drift", []);
  }
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

async function fleetTargetVersion(db: BotfatherDb): Promise<string | null> {
  const rows = (await db
    .select({ v: instances.slawVersion })
    .from(instances)) as Array<{ v: string }>;
  if (rows.length === 0) return null;
  return rows.map((r) => r.v).sort(cmpSemver).at(-1) ?? null;
}

/** Run all rules once. Exported for tests. */
/**
 * Tower-side defence in depth: independently of the instance reporting a breach
 * fact, compare each instance's MTD usage (from cost_facts we already store)
 * against its resolved limit. Cost is checked for metered rows, tokens for
 * subscription rows — matching the plan-aware enforcement on the instance.
 */
async function evalTowerLimitBreach(db: BotfatherDb): Promise<void> {
  const active = await db
    .select({ id: instances.id, instanceId: instances.instanceId })
    .from(instances)
    .where(sql`${instances.status} in ('ok','offline','stale')`);

  const breached: string[] = [];
  for (const inst of active) {
    const limit = await resolveLimits(db, inst.id);
    if (limit.mode === "off") continue;
    if (limit.costLimitCents == null && limit.tokenLimit == null) continue;

    const [u] = rows<{ metered_cents: number; sub_tokens: number; hostname: string }>(
      await db.execute(sql`
        SELECT
          coalesce(sum(case when cf.billing_type = 'metered_api' then cf.cost_cents else 0 end), 0)::int AS metered_cents,
          coalesce(sum(case when cf.billing_type in ('subscription_included','subscription_overage')
            then cf.input_tokens + cf.cached_input_tokens + cf.output_tokens else 0 end), 0)::bigint AS sub_tokens,
          (select m.hostname from machines m join instances i on i.machine_fk = m.id where i.id = ${inst.id}) AS hostname
        FROM cost_facts cf
        WHERE cf.instance_fk = ${inst.id}
          AND cf.occurred_at >= date_trunc('month', now() at time zone 'utc')
      `),
    );
    const meteredCents = Number(u?.metered_cents ?? 0);
    const subTokens = Number(u?.sub_tokens ?? 0);
    const host = u?.hostname ?? inst.instanceId;

    const checks: Array<{ metric: string; observed: number; ceiling: number | null; human: string }> = [
      { metric: "cost", observed: meteredCents, ceiling: limit.costLimitCents, human: `$${(meteredCents / 100).toFixed(2)} of $${((limit.costLimitCents ?? 0) / 100).toFixed(2)}` },
      { metric: "tokens", observed: subTokens, ceiling: limit.tokenLimit, human: `${subTokens.toLocaleString()} of ${(limit.tokenLimit ?? 0).toLocaleString()} tokens` },
    ];
    let raised = false;
    for (const c of checks) {
      if (c.ceiling == null || c.ceiling <= 0) continue;
      const pct = (c.observed / c.ceiling) * 100;
      if (pct < limit.warnPercent) continue;
      const hard = c.observed >= c.ceiling;
      await raise(db, {
        rule: hard ? "tower_limit_breach" : "tower_limit_warning",
        severity: hard ? "critical" : "warning",
        instanceFk: inst.id,
        squadLocalId: null,
        title: `${hard ? "Budget limit reached" : "Budget limit warning"} — ${host}`,
        detail: `Control-tower ${c.metric} limit ${hard ? "reached" : `at ${Math.round(pct)}%`}: ${c.human}`,
        dedupeKey: `${inst.id}:${c.metric}`,
      });
      raised = true;
    }
    if (raised) breached.push(inst.id);
  }
  // resolve stale alerts for instances no longer breaching
  await resolveWhere(db, "tower_limit_breach", breached);
  await resolveWhere(db, "tower_limit_warning", breached);
}

export async function evaluateAlerts(db: BotfatherDb): Promise<void> {
  await evalBudgetAlerts(db);
  await evalInstanceHealth(db);
  await evalSpendSpike(db);
  await evalVersionDrift(db, await fleetTargetVersion(db));
  await evalSkillVersionDrift(db);
  await evalTowerLimitBreach(db);
}

export function startAlertEvaluator(db: BotfatherDb, _config: BotfatherConfig): NodeJS.Timeout {
  const run = () => evaluateAlerts(db).catch((err) => console.error("alert eval failed", err));
  run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  return timer;
}
