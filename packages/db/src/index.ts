import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export * from "./schema/index.js";
export { schema };
export { ensureDatabase, runMigrations, MIGRATIONS_FOLDER } from "./bootstrap.js";

export type BotfatherDb = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}
