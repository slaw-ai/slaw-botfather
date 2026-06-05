/**
 * Botfather core schema — ARCHITECTURE.md §7.1.
 * Child entities are keyed (instanceFk, localId): localIds are only unique
 * within one reporting instance's database.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ───────────── fleet registry ───────────── */

export const machines = pgTable(
  "machines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    machineId: text("machine_id").notNull(),
    hostname: text("hostname").notNull(),
    os: text("os").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("machines_machine_id_uq").on(t.machineId)],
);

export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    machineFk: uuid("machine_fk").notNull().references(() => machines.id),
    instanceId: text("instance_id").notNull(),
    slawVersion: text("slaw_version").notNull(),
    /** ok | offline | stale | pending | rejected | revoked */
    status: text("status").notNull().default("pending"),
    apiKeyHash: text("api_key_hash"),
    /** sha256-prefix lookup key so auth doesn't argon2-verify every row */
    apiKeyFingerprint: text("api_key_fingerprint"),
    userPrincipal: text("user_principal"),
    reportIssueTitles: boolean("report_issue_titles").notNull().default(true),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastSyncCursor: text("last_sync_cursor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instances_machine_instance_uq").on(t.machineFk, t.instanceId),
    index("instances_api_key_fp_idx").on(t.apiKeyFingerprint),
  ],
);

/* ───────────── enrollment (approval queue + audit) ───────────── */

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollmentId: uuid("enrollment_id").notNull(),
    instanceFk: uuid("instance_fk").notNull().references(() => instances.id),
    /** pending | active | rejected | revoked */
    state: text("state").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    matchedRule: text("matched_rule"),
  },
  (t) => [
    uniqueIndex("enrollments_enrollment_id_uq").on(t.enrollmentId),
    index("enrollments_state_idx").on(t.state),
  ],
);

export const autoApproveRules = pgTable("auto_approve_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** glob pattern, e.g. *-ENG-* */
  pattern: text("pattern").notNull(),
  /** hostname | machineId */
  field: text("field").notNull().default("hostname"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────── mirrored entities (metadata only) ───────────── */

export const squads = pgTable(
  "squads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceFk: uuid("instance_fk").notNull().references(() => instances.id),
    localId: text("local_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    budgetMonthlyCents: integer("budget_monthly_cents"),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("squads_instance_local_uq").on(t.instanceFk, t.localId)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceFk: uuid("instance_fk").notNull().references(() => instances.id),
    squadFk: uuid("squad_fk").references(() => squads.id),
    localId: text("local_id").notNull(),
    squadLocalId: text("squad_local_id").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    adapterType: text("adapter_type").notNull(),
    budgetMonthlyCents: integer("budget_monthly_cents"),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("agents_instance_local_uq").on(t.instanceFk, t.localId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceFk: uuid("instance_fk").notNull().references(() => instances.id),
    squadFk: uuid("squad_fk").references(() => squads.id),
    localId: text("local_id").notNull(),
    squadLocalId: text("squad_local_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("projects_instance_local_uq").on(t.instanceFk, t.localId)],
);

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceFk: uuid("instance_fk").notNull().references(() => instances.id),
    squadFk: uuid("squad_fk").references(() => squads.id),
    localId: text("local_id").notNull(),
    squadLocalId: text("squad_local_id").notNull(),
    projectLocalId: text("project_local_id"),
    title: text("title").notNull(),
    status: text("status").notNull(),
    assigneeAgentLocalId: text("assignee_agent_local_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("issues_instance_local_uq").on(t.instanceFk, t.localId),
    index("issues_status_idx").on(t.status),
  ],
);

/* ───────────── append-only facts ───────────── */

export const costFacts = pgTable(
  "cost_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceFk: uuid("instance_fk").notNull().references(() => instances.id),
    localId: text("local_id").notNull(),
    squadLocalId: text("squad_local_id").notNull(),
    agentLocalId: text("agent_local_id"),
    issueLocalId: text("issue_local_id"),
    projectLocalId: text("project_local_id"),
    provider: text("provider").notNull(),
    biller: text("biller"),
    billingType: text("billing_type").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull(),
    cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull(),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull(),
    costCents: integer("cost_cents").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cost_facts_instance_local_uq").on(t.instanceFk, t.localId),
    index("cost_facts_occurred_idx").on(t.occurredAt),
    index("cost_facts_squad_idx").on(t.instanceFk, t.squadLocalId),
  ],
);

export const runFacts = pgTable(
  "run_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceFk: uuid("instance_fk").notNull().references(() => instances.id),
    localId: text("local_id").notNull(),
    agentLocalId: text("agent_local_id").notNull(),
    squadLocalId: text("squad_local_id").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // run status transitions share a localId; dedupe on (instance, localId, status, occurredAt)
    uniqueIndex("run_facts_dedupe_uq").on(t.instanceFk, t.localId, t.status, t.occurredAt),
    index("run_facts_occurred_idx").on(t.occurredAt),
  ],
);

export const activityFacts = pgTable(
  "activity_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceFk: uuid("instance_fk").notNull().references(() => instances.id),
    localId: text("local_id").notNull(),
    squadLocalId: text("squad_local_id"),
    action: text("action").notNull(),
    entityRef: text("entity_ref"),
    details: jsonb("details").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("activity_facts_instance_local_uq").on(t.instanceFk, t.localId),
    index("activity_facts_action_idx").on(t.action),
  ],
);

/* ───────────── rollups + alerts ───────────── */

export const rollupsDaily = pgTable(
  "rollups_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: text("day").notNull(), // YYYY-MM-DD (UTC)
    instanceFk: uuid("instance_fk").references(() => instances.id),
    squadLocalId: text("squad_local_id"),
    agentLocalId: text("agent_local_id"),
    model: text("model"),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
  },
  (t) => [
    uniqueIndex("rollups_daily_uq").on(t.day, t.instanceFk, t.squadLocalId, t.agentLocalId, t.model),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rule: text("rule").notNull(),
    severity: text("severity").notNull(), // critical | warning | info
    status: text("status").notNull().default("active"), // active | acknowledged | resolved
    instanceFk: uuid("instance_fk").references(() => instances.id),
    squadLocalId: text("squad_local_id"),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("alerts_status_idx").on(t.status)],
);
