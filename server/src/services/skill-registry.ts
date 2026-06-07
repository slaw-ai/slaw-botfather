/**
 * Skill registry — the tower-MASTERED skill library.
 *
 * Botfather is the single source of truth for skills. They are authored/curated
 * here and pulled DOWN by instances (the body flows tower→instance). This
 * service owns CRUD + publish lifecycle + the catalog the ingest API serves.
 *
 * Versioning discipline (mirrors the budget-limit lesson — see HANDOVER
 * "Monotonic versions never sum two rows"):
 *  - each skill's `version` is a monotonic per-skill counter, bumped ONLY when
 *    its PUBLISHED content hash changes. Editing a draft never bumps; publishing
 *    a changed body does. A deprecate→republish re-issues above the last served
 *    version. Never derived by summing anything.
 *  - `skill_catalog_state.catalogVersion` is a singleton monotonic counter
 *    advanced on ANY publish/deprecate, so an instance can cheaply detect "the
 *    catalog changed" from the heartbeat hint without diffing the whole list.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { skillLibrary, skillCatalogState } from "@slaw-botfather/db";
import type { SkillCatalogEntry, SkillContentResponse } from "@slaw/botfather-protocol";

const CATALOG_KEY = "default";

export type SkillStatus = "draft" | "published" | "deprecated";

export interface SkillFileEntry {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
}

export interface SkillRow {
  id: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  markdown: string;
  sourceType: string;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: string;
  files: SkillFileEntry[];
  status: SkillStatus;
  version: number;
  contentHash: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

/* ───────────────────────── helpers ───────────────────────── */

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255) || "skill";
}

function normalizeFiles(files: unknown): SkillFileEntry[] {
  if (!Array.isArray(files)) return [];
  const out: SkillFileEntry[] = [];
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const rec = f as Record<string, unknown>;
    if (typeof rec.path !== "string" || typeof rec.content !== "string") continue;
    out.push({
      path: rec.path,
      content: rec.content,
      encoding: rec.encoding === "base64" ? "base64" : "utf8",
    });
  }
  return out;
}

/** The jsonb column is typed as Array<Record<string, unknown>>; SkillFileEntry
 * is structurally compatible but lacks an index signature, so cast at the
 * persistence boundary. */
function filesForDb(files: SkillFileEntry[]): Array<Record<string, unknown>> {
  return files as unknown as Array<Record<string, unknown>>;
}

/** Stable content hash over the body + files (order-independent for files). */
export function computeContentHash(markdown: string, files: SkillFileEntry[]): string {
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const h = createHash("sha256");
  h.update("md\0");
  h.update(markdown);
  for (const f of sortedFiles) {
    h.update("\0file\0");
    h.update(f.path);
    h.update("\0");
    h.update(f.encoding);
    h.update("\0");
    h.update(f.content);
  }
  return h.digest("hex");
}

function rowToSkill(row: typeof skillLibrary.$inferSelect): SkillRow {
  return {
    id: row.id,
    key: row.key,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    markdown: row.markdown,
    sourceType: row.sourceType,
    sourceLocator: row.sourceLocator,
    sourceRef: row.sourceRef,
    trustLevel: row.trustLevel,
    files: normalizeFiles(row.files),
    status: row.status as SkillStatus,
    version: row.version,
    contentHash: row.contentHash,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

/* ───────────────────────── catalog version ───────────────────────── */

/** Read the singleton catalog version (0 if never advanced). */
export async function getCatalogVersion(db: BotfatherDb): Promise<number> {
  const [row] = await db
    .select({ v: skillCatalogState.catalogVersion })
    .from(skillCatalogState)
    .where(eq(skillCatalogState.key, CATALOG_KEY));
  return row?.v ?? 0;
}

/** Advance the singleton catalog version and return the new value. */
export async function bumpCatalogVersion(db: BotfatherDb): Promise<number> {
  const [row] = await db
    .insert(skillCatalogState)
    .values({ key: CATALOG_KEY, catalogVersion: 1, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: skillCatalogState.key,
      set: {
        catalogVersion: sql`${skillCatalogState.catalogVersion} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ v: skillCatalogState.catalogVersion });
  return row?.v ?? 1;
}

/* ───────────────────────── CRUD ───────────────────────── */

export interface CreateSkillInput {
  key: string;
  name: string;
  description?: string | null;
  category?: string | null;
  markdown?: string;
  sourceType?: string;
  sourceLocator?: string | null;
  sourceRef?: string | null;
  trustLevel?: string;
  files?: unknown;
  createdBy?: string | null;
}

export async function createSkill(db: BotfatherDb, input: CreateSkillInput): Promise<SkillRow> {
  const key = input.key.trim();
  const [row] = await db
    .insert(skillLibrary)
    .values({
      key,
      slug: slugify(input.name || key),
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      markdown: input.markdown ?? "",
      sourceType: input.sourceType ?? "authored",
      sourceLocator: input.sourceLocator ?? null,
      sourceRef: input.sourceRef ?? null,
      trustLevel: input.trustLevel ?? "markdown_only",
      files: filesForDb(normalizeFiles(input.files)),
      status: "draft",
      version: 1,
      contentHash: null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rowToSkill(row);
}

export interface UpdateSkillInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  markdown?: string;
  trustLevel?: string;
  sourceLocator?: string | null;
  sourceRef?: string | null;
  files?: unknown;
}

/**
 * Edit a skill's draft content/metadata. Does NOT bump the published version or
 * the catalog — that only happens on publish(). A published skill can still be
 * edited; the changes stay "pending" until re-published.
 */
export async function updateSkill(
  db: BotfatherDb,
  key: string,
  input: UpdateSkillInput,
): Promise<SkillRow | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    set.name = input.name;
    set.slug = slugify(input.name);
  }
  if (input.description !== undefined) set.description = input.description;
  if (input.category !== undefined) set.category = input.category;
  if (input.markdown !== undefined) set.markdown = input.markdown;
  if (input.trustLevel !== undefined) set.trustLevel = input.trustLevel;
  if (input.sourceLocator !== undefined) set.sourceLocator = input.sourceLocator;
  if (input.sourceRef !== undefined) set.sourceRef = input.sourceRef;
  if (input.files !== undefined) set.files = filesForDb(normalizeFiles(input.files));

  const [row] = await db
    .update(skillLibrary)
    .set(set)
    .where(eq(skillLibrary.key, key))
    .returning();
  return row ? rowToSkill(row) : null;
}

export async function getSkill(db: BotfatherDb, key: string): Promise<SkillRow | null> {
  const [row] = await db.select().from(skillLibrary).where(eq(skillLibrary.key, key));
  return row ? rowToSkill(row) : null;
}

export async function listSkills(
  db: BotfatherDb,
  opts: { status?: SkillStatus } = {},
): Promise<SkillRow[]> {
  const rows = opts.status
    ? await db.select().from(skillLibrary).where(eq(skillLibrary.status, opts.status)).orderBy(desc(skillLibrary.updatedAt))
    : await db.select().from(skillLibrary).orderBy(desc(skillLibrary.updatedAt));
  return rows.map(rowToSkill);
}

/**
 * Publish a skill. Bumps the per-skill `version` ONLY if the published content
 * (markdown + files) actually changed vs the last published hash. Always
 * advances the catalog version on a state transition into `published` (so a
 * draft→published transition is visible even if a same-hash skill was
 * previously published then deprecated). Returns {skill, contentChanged}.
 */
export async function publishSkill(
  db: BotfatherDb,
  key: string,
): Promise<{ skill: SkillRow; contentChanged: boolean; catalogVersion: number } | null> {
  const existing = await getSkill(db, key);
  if (!existing) return null;

  const hash = computeContentHash(existing.markdown, existing.files);
  const wasPublished = existing.status === "published";
  const contentChanged = existing.contentHash !== hash;
  // Per-skill version bump rule: a never-published skill keeps its current
  // version (starts at 1) on first publish; an already-published skill whose
  // content changed increments by 1. A pure re-publish of unchanged,
  // already-published content is a no-op for the version. Monotonic, never summed.
  const finalVersion = wasPublished && contentChanged ? existing.version + 1 : existing.version;

  const [row] = await db
    .update(skillLibrary)
    .set({
      status: "published",
      contentHash: hash,
      version: finalVersion,
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(skillLibrary.key, key))
    .returning();

  // Advance catalog version on any publish transition or content change.
  const catalogChanged = !wasPublished || contentChanged;
  const catalogVersion = catalogChanged ? await bumpCatalogVersion(db) : await getCatalogVersion(db);
  return { skill: rowToSkill(row), contentChanged, catalogVersion };
}

/** Deprecate a published/draft skill — drops it from the served catalog. */
export async function deprecateSkill(
  db: BotfatherDb,
  key: string,
): Promise<{ skill: SkillRow; catalogVersion: number } | null> {
  const existing = await getSkill(db, key);
  if (!existing) return null;
  const wasPublished = existing.status === "published";
  const [row] = await db
    .update(skillLibrary)
    .set({ status: "deprecated", updatedAt: new Date() })
    .where(eq(skillLibrary.key, key))
    .returning();
  // Only a previously-served (published) skill changes what instances see.
  const catalogVersion = wasPublished ? await bumpCatalogVersion(db) : await getCatalogVersion(db);
  return { skill: rowToSkill(row), catalogVersion };
}

/* ───────────────────────── catalog serving (ingest) ───────────────────────── */

/** The published catalog as lightweight descriptors (no markdown body). */
export async function getPublishedCatalog(
  db: BotfatherDb,
): Promise<{ catalogVersion: number; skills: SkillCatalogEntry[] }> {
  const rows = await db
    .select()
    .from(skillLibrary)
    .where(eq(skillLibrary.status, "published"))
    .orderBy(skillLibrary.name);
  const catalogVersion = await getCatalogVersion(db);
  const skills: SkillCatalogEntry[] = rows.map((row) => {
    const files = normalizeFiles(row.files);
    return {
      key: row.key,
      slug: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      trustLevel: row.trustLevel,
      version: row.version,
      contentHash: row.contentHash ?? computeContentHash(row.markdown, files),
      hasFiles: files.length > 0,
      updatedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
    };
  });
  return { catalogVersion, skills };
}

/** Full content for one published skill (pulled on install/update). */
export async function getPublishedSkillContent(
  db: BotfatherDb,
  key: string,
): Promise<SkillContentResponse | null> {
  const [row] = await db
    .select()
    .from(skillLibrary)
    .where(and(eq(skillLibrary.key, key), eq(skillLibrary.status, "published")));
  if (!row) return null;
  const files = normalizeFiles(row.files);
  return {
    key: row.key,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    trustLevel: row.trustLevel,
    version: row.version,
    contentHash: row.contentHash ?? computeContentHash(row.markdown, files),
    markdown: row.markdown,
    files,
  };
}
