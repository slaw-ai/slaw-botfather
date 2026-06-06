import { eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { enterpriseLimits, instanceLimitOverrides, instances } from "@slaw-botfather/db";
import type { Directive, LimitSpec } from "@slaw/botfather-protocol";

const ENTERPRISE_KEY = "default";

export type LimitMode = "off" | "soft" | "hard";

export interface EnterpriseLimitsRow {
  costLimitCents: number | null;
  tokenLimit: number | null;
  warnPercent: number;
  mode: LimitMode;
  version: number;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface InstanceOverrideRow {
  costLimitCents: number | null;
  tokenLimit: number | null;
  warnPercent: number | null;
  mode: LimitMode | null;
  version: number;
  updatedBy: string | null;
  updatedAt: Date;
}

/** The "no tower limit" spec — used when nothing is configured. */
function offSpec(version: number): LimitSpec {
  return {
    costLimitCents: null,
    tokenLimit: null,
    window: "calendar_month_utc",
    warnPercent: 80,
    mode: "off",
    version,
  };
}

export async function getEnterpriseLimits(db: BotfatherDb): Promise<EnterpriseLimitsRow | null> {
  const [row] = await db.select().from(enterpriseLimits).where(eq(enterpriseLimits.key, ENTERPRISE_KEY));
  if (!row) return null;
  return {
    costLimitCents: row.costLimitCents,
    tokenLimit: row.tokenLimit,
    warnPercent: row.warnPercent,
    mode: row.mode as LimitMode,
    version: row.version,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export interface UpsertEnterpriseInput {
  costLimitCents: number | null;
  tokenLimit: number | null;
  warnPercent?: number;
  mode?: LimitMode;
  updatedBy?: string;
}

/** Insert/update the singleton enterprise default and bump its version. */
export async function upsertEnterpriseLimits(
  db: BotfatherDb,
  input: UpsertEnterpriseInput,
): Promise<EnterpriseLimitsRow> {
  const values = {
    key: ENTERPRISE_KEY,
    costLimitCents: input.costLimitCents,
    tokenLimit: input.tokenLimit,
    warnPercent: input.warnPercent ?? 80,
    mode: input.mode ?? "soft",
    updatedBy: input.updatedBy ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(enterpriseLimits)
    .values({ ...values, version: 1 })
    .onConflictDoUpdate({
      target: enterpriseLimits.key,
      set: {
        costLimitCents: values.costLimitCents,
        tokenLimit: values.tokenLimit,
        warnPercent: values.warnPercent,
        mode: values.mode,
        updatedBy: values.updatedBy,
        updatedAt: values.updatedAt,
        // monotonic bump so every instance re-applies
        version: sql`${enterpriseLimits.version} + 1`,
      },
    });
  return (await getEnterpriseLimits(db))!;
}

export async function getOverride(
  db: BotfatherDb,
  instanceFk: string,
): Promise<InstanceOverrideRow | null> {
  const [row] = await db
    .select()
    .from(instanceLimitOverrides)
    .where(eq(instanceLimitOverrides.instanceFk, instanceFk));
  if (!row) return null;
  return {
    costLimitCents: row.costLimitCents,
    tokenLimit: row.tokenLimit,
    warnPercent: row.warnPercent,
    mode: row.mode as LimitMode | null,
    version: row.version,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export interface UpsertOverrideInput {
  costLimitCents: number | null;
  tokenLimit: number | null;
  warnPercent?: number | null;
  mode?: LimitMode | null;
  updatedBy?: string;
}

export async function upsertOverride(
  db: BotfatherDb,
  instanceFk: string,
  input: UpsertOverrideInput,
): Promise<InstanceOverrideRow> {
  await db
    .insert(instanceLimitOverrides)
    .values({
      instanceFk,
      costLimitCents: input.costLimitCents,
      tokenLimit: input.tokenLimit,
      warnPercent: input.warnPercent ?? null,
      mode: input.mode ?? null,
      updatedBy: input.updatedBy ?? null,
      updatedAt: new Date(),
      version: 1,
    })
    .onConflictDoUpdate({
      target: instanceLimitOverrides.instanceFk,
      set: {
        costLimitCents: input.costLimitCents,
        tokenLimit: input.tokenLimit,
        warnPercent: input.warnPercent ?? null,
        mode: input.mode ?? null,
        updatedBy: input.updatedBy ?? null,
        updatedAt: new Date(),
        version: sql`${instanceLimitOverrides.version} + 1`,
      },
    });
  return (await getOverride(db, instanceFk))!;
}

/** Remove a per-instance override; the instance reverts to the enterprise default. */
export async function clearOverride(db: BotfatherDb, instanceFk: string): Promise<void> {
  await db.delete(instanceLimitOverrides).where(eq(instanceLimitOverrides.instanceFk, instanceFk));
}

/**
 * Resolve the EFFECTIVE limit for an instance.
 * Cascade: a per-instance override's non-null fields win, falling back to the
 * enterprise value for any null field. `version` combines both so an edit to
 * either re-propagates. With nothing configured, returns an "off" spec.
 */
export async function resolveLimits(db: BotfatherDb, instanceFk: string): Promise<LimitSpec> {
  const ent = await getEnterpriseLimits(db);
  const ovr = await getOverride(db, instanceFk);

  if (!ent && !ovr) return offSpec(0);

  // version: sum so either edit moves it forward (both monotonic per row)
  const version = (ent?.version ?? 0) + (ovr?.version ?? 0);

  if (!ovr) {
    return {
      costLimitCents: ent!.costLimitCents,
      tokenLimit: ent!.tokenLimit,
      window: "calendar_month_utc",
      warnPercent: ent!.warnPercent,
      mode: ent!.mode,
      version,
    };
  }

  // override present: non-null override fields win; null inherits enterprise
  return {
    costLimitCents: ovr.costLimitCents ?? ent?.costLimitCents ?? null,
    tokenLimit: ovr.tokenLimit ?? ent?.tokenLimit ?? null,
    window: "calendar_month_utc",
    warnPercent: ovr.warnPercent ?? ent?.warnPercent ?? 80,
    mode: ovr.mode ?? ent?.mode ?? "soft",
    version,
  };
}

/**
 * Build the directive array to attach to a heartbeat/sync response for one
 * instance. We push `set_limits` when the resolved version is ahead of what the
 * instance has acked, OR while a limit is actively in force (mode != off) — the
 * instance de-dupes cheaply by version, so an occasional re-send is harmless and
 * self-heals a missed application. Returns [] when nothing needs sending.
 */
export async function buildLimitDirectives(
  db: BotfatherDb,
  instanceFk: string,
  ackedVersion: number,
): Promise<Directive[]> {
  const spec = await resolveLimits(db, instanceFk);
  // Push only when the resolved version is ahead of what the instance has
  // applied. The instance echoes its applied version in the heartbeat, so once
  // it acks we stop re-sending. (Clearing a limit bumps the version too, so a
  // mode:"off" spec also propagates exactly once.)
  if (spec.version <= ackedVersion) return [];
  return [{ kind: "set_limits", limit: spec }];
}

/** Record the limit version an instance reports it has applied (de-dupe). */
export async function recordAppliedLimitVersion(
  db: BotfatherDb,
  instanceFk: string,
  appliedVersion: number | undefined,
): Promise<void> {
  if (appliedVersion === undefined) return;
  await db
    .update(instances)
    .set({ limitVersionAcked: appliedVersion, updatedAt: new Date() })
    .where(eq(instances.id, instanceFk));
}
