import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const here = path.dirname(fileURLToPath(import.meta.url));
// migrations live next to the package (src in dev, dist after build — both have ../migrations)
export const MIGRATIONS_FOLDER = path.resolve(here, "../migrations");

/** Create the target database if it doesn't exist (connects to the admin `postgres` db). */
export async function ensureDatabase(adminUrl: string, dbName: string): Promise<"created" | "exists"> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rowCount && rowCount > 0) return "exists";
    // identifier can't be parameterized; dbName is app-controlled, but quote defensively
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    return "created";
  } finally {
    await client.end();
  }
}

/** Apply all pending Drizzle migrations against the given database URL. Idempotent. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
