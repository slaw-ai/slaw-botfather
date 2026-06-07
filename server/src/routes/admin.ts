import { Router, json } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import {
  machines,
  instances,
  enrollments,
  autoApproveRules,
  squads,
  agents,
  squadSkills,
  costFacts,
  alerts,
  issues,
} from "@slaw-botfather/db";
import { decideEnrollment, revokeInstance } from "../services/enrollment.js";
import {
  getEnterpriseLimits,
  upsertEnterpriseLimits,
  getOverride,
  upsertOverride,
  clearOverride,
  resolveLimits,
  type LimitMode,
} from "../services/limits.js";
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  publishSkill,
  deprecateSkill,
  getCatalogVersion,
} from "../services/skill-registry.js";
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

    // agents per squad: total + a status breakdown (e.g. {running:2, idle:4})
    const agentRows = await db
      .select({ squadLocalId: agents.squadLocalId, status: agents.status })
      .from(agents)
      .where(eq(agents.instanceFk, inst.id));
    const agentsBySquad: Record<string, { total: number; byStatus: Record<string, number> }> = {};
    for (const a of agentRows) {
      const e = (agentsBySquad[a.squadLocalId] ??= { total: 0, byStatus: {} });
      e.total += 1;
      e.byStatus[a.status] = (e.byStatus[a.status] ?? 0) + 1;
    }
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

    res.json({ instance: inst, squads: squadRows, agentsBySquad, costByModelMtd: costByModel, tokensMtd });
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

  /* ── issues for one instance (drill-down) ── */
  r.get("/instances/:id/issues", async (req, res) => {
    const rows = await db
      .select({
        localId: issues.localId,
        title: issues.title,
        status: issues.status,
        squadLocalId: issues.squadLocalId,
        assigneeAgentLocalId: issues.assigneeAgentLocalId,
        updatedAt: issues.updatedAt,
        squadName: squads.name,
      })
      .from(issues)
      .leftJoin(squads, eq(issues.squadFk, squads.id))
      .where(eq(issues.instanceFk, req.params.id))
      .orderBy(desc(issues.updatedAt))
      .limit(500);
    res.json({ issues: rows });
  });

  /* ── agents for one instance (drill-down, read-only metadata) ── */
  r.get("/instances/:id/agents", async (req, res) => {
    const rows = await db
      .select({
        localId: agents.localId,
        squadLocalId: agents.squadLocalId,
        name: agents.name,
        role: agents.role,
        title: agents.title,
        status: agents.status,
        adapterType: agents.adapterType,
        capabilities: agents.capabilities,
        reportsToLocalId: agents.reportsToLocalId,
        budgetMonthlyCents: agents.budgetMonthlyCents,
        spentMonthlyCents: agents.spentMonthlyCents,
        updatedAt: agents.updatedAt,
        squadName: squads.name,
      })
      .from(agents)
      .leftJoin(squads, eq(agents.squadFk, squads.id))
      .where(eq(agents.instanceFk, req.params.id))
      .orderBy(agents.squadLocalId, agents.name)
      .limit(2000);
    res.json({ agents: rows });
  });

  /* ── squad skills for one instance (squad-scoped, read-only metadata) ── */
  r.get("/instances/:id/skills", async (req, res) => {
    const rows = await db
      .select({
        localId: squadSkills.localId,
        squadLocalId: squadSkills.squadLocalId,
        key: squadSkills.key,
        name: squadSkills.name,
        description: squadSkills.description,
        sourceType: squadSkills.sourceType,
        trustLevel: squadSkills.trustLevel,
        updatedAt: squadSkills.updatedAt,
        squadName: squads.name,
      })
      .from(squadSkills)
      .leftJoin(squads, eq(squadSkills.squadFk, squads.id))
      .where(eq(squadSkills.instanceFk, req.params.id))
      .orderBy(squadSkills.squadLocalId, squadSkills.name)
      .limit(2000);
    res.json({ skills: rows });
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

  /* ── budget limits (tower-governed) ── */

  // Parse a nullable nonnegative integer ceiling from the request body.
  const ceiling = (v: unknown): number | null | undefined => {
    if (v === null) return null;
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const parseMode = (v: unknown): LimitMode | undefined =>
    v === "off" || v === "soft" || v === "hard" ? v : undefined;

  r.get("/enterprise-limits", async (_req, res) => {
    res.json({ enterprise: await getEnterpriseLimits(db) });
  });

  r.put("/enterprise-limits", async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const cost = ceiling(b.costLimitCents);
    const tok = ceiling(b.tokenLimit);
    if (cost === undefined && b.costLimitCents !== undefined) {
      res.status(400).json({ error: "invalid costLimitCents" });
      return;
    }
    const row = await upsertEnterpriseLimits(db, {
      costLimitCents: cost ?? null,
      tokenLimit: tok ?? null,
      warnPercent: typeof b.warnPercent === "number" ? b.warnPercent : undefined,
      mode: parseMode(b.mode),
      updatedBy: typeof b.updatedBy === "string" ? b.updatedBy : "admin",
    });
    res.json({ enterprise: row });
  });

  // Effective + override + enterprise for one instance.
  r.get("/instances/:id/limits", async (req, res) => {
    const [inst] = await db.select().from(instances).where(eq(instances.id, req.params.id));
    if (!inst) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({
      effective: await resolveLimits(db, inst.id),
      override: await getOverride(db, inst.id),
      enterprise: await getEnterpriseLimits(db),
      appliedVersion: inst.limitVersionAcked,
    });
  });

  r.put("/instances/:id/limits", async (req, res) => {
    const [inst] = await db.select().from(instances).where(eq(instances.id, req.params.id));
    if (!inst) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const row = await upsertOverride(db, inst.id, {
      costLimitCents: ceiling(b.costLimitCents) ?? null,
      tokenLimit: ceiling(b.tokenLimit) ?? null,
      // warnPercent/mode null = inherit enterprise
      warnPercent: b.warnPercent === null ? null : typeof b.warnPercent === "number" ? b.warnPercent : null,
      mode: b.mode === null ? null : parseMode(b.mode) ?? null,
      updatedBy: typeof b.updatedBy === "string" ? b.updatedBy : "admin",
    });
    res.json({ override: row, effective: await resolveLimits(db, inst.id) });
  });

  r.delete("/instances/:id/limits", async (req, res) => {
    const [inst] = await db.select().from(instances).where(eq(instances.id, req.params.id));
    if (!inst) {
      res.status(404).json({ error: "not found" });
      return;
    }
    await clearOverride(db, inst.id);
    res.json({ ok: true, effective: await resolveLimits(db, inst.id) });
  });

  /* ── skill registry (tower-mastered) ──
   * Author/curate the canonical skill library. CRUD + publish/deprecate
   * lifecycle. Each list row carries fleet "adoption" = how many squad_skills
   * descriptors across the fleet were installed from this library key. */
  const trimStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const nullableStr = (v: unknown): string | null | undefined =>
    v === null ? null : typeof v === "string" ? v : undefined;

  // adoption counts keyed by skill_library.key, via the reported descriptors
  // (squad_skills rows whose sourceType="botfather" carry key = library key).
  async function adoptionByKey(): Promise<Map<string, { squads: number; instances: number }>> {
    const out = new Map<string, { squads: number; instances: number }>();
    const r2 = rows<{ key: string; squads: number; instances: number }>(
      await db.execute(sql`
        SELECT key,
               COUNT(*)::int AS squads,
               COUNT(DISTINCT instance_fk)::int AS instances
        FROM squad_skills
        WHERE source_type = 'botfather'
        GROUP BY key
      `),
    );
    for (const row of r2) out.set(row.key, { squads: row.squads, instances: row.instances });
    return out;
  }

  r.get("/skills", async (req, res) => {
    const status = trimStr(req.query.status);
    const all = await listSkills(
      db,
      status === "draft" || status === "published" || status === "deprecated" ? { status } : {},
    );
    const adoption = await adoptionByKey();
    res.json({
      catalogVersion: await getCatalogVersion(db),
      skills: all.map((s) => ({
        ...s,
        adoption: adoption.get(s.key) ?? { squads: 0, instances: 0 },
      })),
    });
  });

  r.get("/skills/:key", async (req, res) => {
    const s = await getSkill(db, req.params.key);
    if (!s) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const adoption = await adoptionByKey();
    res.json({ skill: { ...s, adoption: adoption.get(s.key) ?? { squads: 0, instances: 0 } } });
  });

  r.post("/skills", async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const key = trimStr(b.key)?.trim();
    const name = trimStr(b.name);
    if (!key || !name) {
      res.status(400).json({ error: "key and name are required" });
      return;
    }
    if (await getSkill(db, key)) {
      res.status(409).json({ error: "a skill with this key already exists", code: "skill_key_exists" });
      return;
    }
    const s = await createSkill(db, {
      key,
      name,
      description: nullableStr(b.description) ?? null,
      category: nullableStr(b.category) ?? null,
      markdown: trimStr(b.markdown) ?? "",
      sourceType: trimStr(b.sourceType),
      sourceLocator: nullableStr(b.sourceLocator) ?? null,
      sourceRef: nullableStr(b.sourceRef) ?? null,
      trustLevel: trimStr(b.trustLevel),
      files: b.files,
      createdBy: trimStr(b.createdBy) ?? "admin",
    });
    res.status(201).json({ skill: s });
  });

  r.put("/skills/:key", async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const s = await updateSkill(db, req.params.key, {
      name: trimStr(b.name),
      description: nullableStr(b.description),
      category: nullableStr(b.category),
      markdown: trimStr(b.markdown),
      trustLevel: trimStr(b.trustLevel),
      sourceLocator: nullableStr(b.sourceLocator),
      sourceRef: nullableStr(b.sourceRef),
      files: b.files,
    });
    if (!s) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ skill: s });
  });

  r.post("/skills/:key/publish", async (req, res) => {
    const result = await publishSkill(db, req.params.key);
    if (!result) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({
      skill: result.skill,
      contentChanged: result.contentChanged,
      catalogVersion: result.catalogVersion,
    });
  });

  r.post("/skills/:key/deprecate", async (req, res) => {
    const result = await deprecateSkill(db, req.params.key);
    if (!result) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ skill: result.skill, catalogVersion: result.catalogVersion });
  });

  return r;
}
