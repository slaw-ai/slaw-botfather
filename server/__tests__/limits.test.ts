import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { schema } from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
import { enroll, pollEnrollment, decideEnrollment } from "../src/services/enrollment.js";
import {
  getEnterpriseLimits,
  upsertEnterpriseLimits,
  getOverride,
  upsertOverride,
  clearOverride,
  resolveLimits,
} from "../src/services/limits.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../packages/db/migrations");
let db: BotfatherDb;
let instanceFk: string;

async function applyMigrations(client: PGlite) {
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(migrationsDir, f), "utf8").split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await client.exec(s);
    }
  }
}

beforeEach(async () => {
  const client = new PGlite();
  await applyMigrations(client);
  db = drizzle(client, { schema }) as unknown as BotfatherDb;
  const e = await enroll(
    db,
    { machineId: "limits-test-1", instanceId: "default", hostname: "LIM-1", os: "linux", slawVersion: "0.4.2" },
    true,
  );
  await decideEnrollment(db, e.enrollmentId, "approve", "admin");
  await pollEnrollment(db, e.enrollmentId);
  const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.instanceId, "default"));
  instanceFk = inst.id;
});

describe("limit resolution cascade", () => {
  it("returns an off spec when nothing is configured", async () => {
    const spec = await resolveLimits(db, instanceFk);
    expect(spec.mode).toBe("off");
    expect(spec.costLimitCents).toBeNull();
    expect(spec.tokenLimit).toBeNull();
    expect(spec.version).toBe(0);
  });

  it("an enterprise default applies to an instance with no override", async () => {
    await upsertEnterpriseLimits(db, {
      costLimitCents: 50_000,
      tokenLimit: 10_000_000,
      warnPercent: 75,
      mode: "soft",
      updatedBy: "admin",
    });
    const spec = await resolveLimits(db, instanceFk);
    expect(spec.costLimitCents).toBe(50_000);
    expect(spec.tokenLimit).toBe(10_000_000);
    expect(spec.warnPercent).toBe(75);
    expect(spec.mode).toBe("soft");
    expect(spec.version).toBeGreaterThan(0);
  });

  it("a per-instance override wins; null fields inherit the enterprise default", async () => {
    await upsertEnterpriseLimits(db, {
      costLimitCents: 50_000,
      tokenLimit: 10_000_000,
      warnPercent: 80,
      mode: "soft",
    });
    // override only the cost ceiling + hard mode; leave tokenLimit/warn null → inherit
    await upsertOverride(db, instanceFk, {
      costLimitCents: 20_000,
      tokenLimit: null,
      warnPercent: null,
      mode: "hard",
    });
    const spec = await resolveLimits(db, instanceFk);
    expect(spec.costLimitCents).toBe(20_000); // overridden
    expect(spec.tokenLimit).toBe(10_000_000); // inherited
    expect(spec.warnPercent).toBe(80); // inherited
    expect(spec.mode).toBe("hard"); // overridden
  });

  it("bumps version on every edit so instances re-apply", async () => {
    const v1 = (await upsertEnterpriseLimits(db, { costLimitCents: 100, tokenLimit: null })).version;
    const v2 = (await upsertEnterpriseLimits(db, { costLimitCents: 200, tokenLimit: null })).version;
    expect(v2).toBeGreaterThan(v1);
    // an override edit also moves the resolved version forward
    const before = (await resolveLimits(db, instanceFk)).version;
    await upsertOverride(db, instanceFk, { costLimitCents: 50, tokenLimit: null });
    const after = (await resolveLimits(db, instanceFk)).version;
    expect(after).toBeGreaterThan(before);
  });

  it("clearing an override reverts the instance to the enterprise default", async () => {
    await upsertEnterpriseLimits(db, { costLimitCents: 50_000, tokenLimit: null, mode: "soft" });
    await upsertOverride(db, instanceFk, { costLimitCents: 10_000, tokenLimit: null, mode: "hard" });
    expect((await resolveLimits(db, instanceFk)).costLimitCents).toBe(10_000);
    await clearOverride(db, instanceFk);
    expect(await getOverride(db, instanceFk)).toBeNull();
    const spec = await resolveLimits(db, instanceFk);
    expect(spec.costLimitCents).toBe(50_000);
    expect(spec.mode).toBe("soft");
  });

  it("persists the enterprise singleton (single row, upsert not insert)", async () => {
    await upsertEnterpriseLimits(db, { costLimitCents: 1, tokenLimit: null });
    await upsertEnterpriseLimits(db, { costLimitCents: 2, tokenLimit: null });
    const all = await db.select().from(schema.enterpriseLimits);
    expect(all).toHaveLength(1);
    expect((await getEnterpriseLimits(db))?.costLimitCents).toBe(2);
  });
});
