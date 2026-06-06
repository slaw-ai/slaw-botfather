import { Router, json } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import {
  machines,
  instances,
  enrollments,
  autoApproveRules,
  squads,
  costFacts,
  alerts,
  issues,
} from "@slaw-botfather/db";
import { decideEnrollment, revokeInstance } from "../services/enrollment.js";
import { rows } from "../services/sql-util.js";
import {
  networkSummary,
  spendByDay,
  costByModelMtd,
  costByBillingTypeMtd,
  topBurnerInstancesMtd,
  topBurnerSquadsMtd,
} from "../services/analytics.js";

/**
 * Admin API (v1: single local admin, no auth — bind to localhost / put behind
 * the corp reverse proxy; Entra SSO arrives in B5).
 */
export function adminRouter(db: BotfatherDb): Router {
  const r = Router();
  r.use(json());

  /* ── approval queue ── */
  r.get("/approvals", async (_req, res) => {
    const rows = await db
      .select({
        enrollmentId: enrollments.enrollmentId,
        requestedAt: enrollments.requestedAt,
        instanceId: instances.instanceId,
        slawVersion: instances.slawVersion,
        machineId: machines.machineId,
        hostname: machines.hostname,
        os: machines.os,
      })
      .from(enrollments)
      .innerJoin(instances, eq(enrollments.instanceFk, instances.id))
      .innerJoin(machines, eq(instances.machineFk, machines.id))
      .where(eq(enrollments.state, "pending"))
      .orderBy(desc(enrollments.requestedAt));
    res.json({ pending: rows });
  });

  r.post("/approvals/:enrollmentId/approve", async (req, res) => {
    const ok = await decideEnrollment(db, req.params.enrollmentId, "approve", "admin");
    res.status(ok ? 200 : 404).json({ ok });
  });

  r.post("/approvals/:enrollmentId/reject", async (req, res) => {
    const ok = await decideEnrollment(db, req.params.enrollmentId, "reject", "admin");
    res.status(ok ? 200 : 404).json({ ok });
  });

  /* ── auto-approve rules ── */
  r.get("/auto-approve-rules", async (_req, res) => {
    res.json({ rules: await db.select().from(autoApproveRules) });
  });

  r.post("/auto-approve-rules", async (req, res) => {
    const { pattern, field = "hostname" } = req.body ?? {};
    if (typeof pattern !== "string" || !pattern || !["hostname", "machineId"].includes(field)) {
      res.status(400).json({ error: "pattern (string) and field (hostname|machineId) required" });
      return;
    }
    const [rule] = await db
      .insert(autoApproveRules)
      .values({ pattern, field, createdBy: "admin" })
      .returning();
    res.status(201).json({ rule });
  });

  /* ── fleet ── */
  r.get("/fleet", async (_req, res) => {
    const rows = await db
      .select({
        id: instances.id,
        instanceId: instances.instanceId,
        status: instances.status,
        slawVersion: instances.slawVersion,
        lastHeartbeatAt: instances.lastHeartbeatAt,
        enrolledAt: instances.enrolledAt,
        machineId: machines.machineId,
        hostname: machines.hostname,
        os: machines.os,
        squadCount: sql<number>`(select count(*)::int from squads s where s.instance_fk = ${instances.id})`,
        spendTodayCents: sql<number>`coalesce((select sum(cf.cost_cents)::int from cost_facts cf where cf.instance_fk = ${instances.id} and cf.occurred_at >= date_trunc('day', now() at time zone 'utc')), 0)`,
        spendMtdCents: sql<number>`coalesce((select sum(cf.cost_cents)::int from cost_facts cf where cf.instance_fk = ${instances.id} and cf.occurred_at >= date_trunc('month', now() at time zone 'utc')), 0)`,
      })
      .from(instances)
      .innerJoin(machines, eq(instances.machineFk, machines.id))
      .orderBy(desc(instances.lastHeartbeatAt));
    res.json({ instances: rows });
  });

  r.get("/instances/:id", async (req, res) => {
    const [inst] = await db
      .select({
        id: instances.id,
        instanceId: instances.instanceId,
        status: instances.status,
        slawVersion: instances.slawVersion,
        lastHeartbeatAt: instances.lastHeartbeatAt,
        enrolledAt: instances.enrolledAt,
        reportIssueTitles: instances.reportIssueTitles,
        machineId: machines.machineId,
        hostname: machines.hostname,
        os: machines.os,
        spendTodayCents: sql<number>`coalesce((select sum(cf.cost_cents)::int from cost_facts cf where cf.instance_fk = ${instances.id} and cf.occurred_at >= date_trunc('day', now() at time zone 'utc')), 0)`,
        spendMtdCents: sql<number>`coalesce((select sum(cf.cost_cents)::int from cost_facts cf where cf.instance_fk = ${instances.id} and cf.occurred_at >= date_trunc('month', now() at time zone 'utc')), 0)`,
      })
      .from(instances)
      .innerJoin(machines, eq(instances.machineFk, machines.id))
      .where(eq(instances.id, req.params.id));
    if (!inst) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const squadRows = await db
      .select()
      .from(squads)
      .where(eq(squads.instanceFk, inst.id));
    const costByModel = await db
      .select({
        model: costFacts.model,
        costCents: sql<number>`sum(${costFacts.costCents})::int`,
        inputTokens: sql<number>`sum(${costFacts.inputTokens})::bigint`,
        cachedInputTokens: sql<number>`sum(${costFacts.cachedInputTokens})::bigint`,
        outputTokens: sql<number>`sum(${costFacts.outputTokens})::bigint`,
      })
      .from(costFacts)
      .where(
        and(
          eq(costFacts.instanceFk, inst.id),
          sql`${costFacts.occurredAt} >= date_trunc('month', now() at time zone 'utc')`,
        ),
      )
      .groupBy(costFacts.model);

    // Token + billing-mix totals MTD — the meaningful signal when cost is $0
    // under a subscription plan.
    const [tok] = rows<{
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      events: number;
      metered_cents: number;
      subscription_events: number;
    }>(
      await db.execute(sql`
        SELECT
          coalesce(sum(input_tokens), 0)::bigint        AS input_tokens,
          coalesce(sum(cached_input_tokens), 0)::bigint AS cached_input_tokens,
          coalesce(sum(output_tokens), 0)::bigint       AS output_tokens,
          count(*)::int                                 AS events,
          coalesce(sum(cost_cents) filter (where billing_type = 'metered_api'), 0)::int AS metered_cents,
          count(*) filter (where billing_type in ('subscription_included','subscription_overage'))::int AS subscription_events
        FROM cost_facts
        WHERE instance_fk = ${inst.id}
          AND occurred_at >= date_trunc('month', now() at time zone 'utc')
      `),
    );

    const inputTokens = Number(tok?.input_tokens ?? 0);
    const cachedInputTokens = Number(tok?.cached_input_tokens ?? 0);
    const outputTokens = Number(tok?.output_tokens ?? 0);
    const tokensMtd = {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: inputTokens + cachedInputTokens + outputTokens,
      events: Number(tok?.events ?? 0),
      // subscription-dominant when most events carry no metered cost
      subscriptionDominant:
        Number(tok?.subscription_events ?? 0) > 0 && Number(tok?.metered_cents ?? 0) === 0,
    };

    res.json({ instance: inst, squads: squadRows, costByModelMtd: costByModel, tokensMtd });
  });

  r.post("/instances/:id/revoke", async (req, res) => {
    const ok = await revokeInstance(db, req.params.id, "admin");
    res.status(ok ? 200 : 404).json({ ok });
  });

  /* ── cost analytics ── */
  r.get("/analytics/summary", async (_req, res) => {
    res.json(await networkSummary(db));
  });

  r.get("/analytics/cost", async (req, res) => {
    const days = Math.min(Number(req.query.days ?? 14), 365);
    const [byDay, byModel, byBilling, topInstances, topSquads] = await Promise.all([
      spendByDay(db, days),
      costByModelMtd(db),
      costByBillingTypeMtd(db),
      topBurnerInstancesMtd(db),
      topBurnerSquadsMtd(db),
    ]);
    res.json({ byDay, byModel, byBilling, topInstances, topSquads });
  });

  /* ── issues in flight ── */
  r.get("/issues", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "in_progress";
    const rows = await db
      .select({
        localId: issues.localId,
        title: issues.title,
        status: issues.status,
        squadLocalId: issues.squadLocalId,
        assigneeAgentLocalId: issues.assigneeAgentLocalId,
        updatedAt: issues.updatedAt,
        hostname: machines.hostname,
        instanceFk: issues.instanceFk,
        squadName: squads.name,
      })
      .from(issues)
      .innerJoin(instances, eq(issues.instanceFk, instances.id))
      .innerJoin(machines, eq(instances.machineFk, machines.id))
      .leftJoin(squads, eq(issues.squadFk, squads.id))
      .where(eq(issues.status, status))
      .orderBy(desc(issues.updatedAt))
      .limit(200);
    res.json({ issues: rows });
  });

  /* ── alerts ── */
  r.get("/alerts", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "active";
    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.status, status))
      .orderBy(desc(alerts.firstSeenAt));
    res.json({ alerts: rows });
  });

  r.post("/alerts/:id/acknowledge", async (req, res) => {
    const updated = await db
      .update(alerts)
      .set({ status: "acknowledged" })
      .where(and(eq(alerts.id, req.params.id), eq(alerts.status, "active")))
      .returning({ id: alerts.id });
    res.status(updated.length ? 200 : 404).json({ ok: updated.length > 0 });
  });

  return r;
}
