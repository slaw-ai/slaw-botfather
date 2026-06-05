import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { ensureDatabase, runMigrations, createDb, type BotfatherDb } from "@slaw-botfather/db";

export interface DbHandle {
  db: BotfatherDb;
  connectionString: string;
  /** call on shutdown to stop the embedded server (no-op for external PG) */
  stop: () => Promise<void>;
}

const DB_NAME = "botfather";
const EMBEDDED_USER = "postgres";
const EMBEDDED_PASSWORD = "postgres";

function embeddedDataDir(): string {
  return (
    process.env.BOTFATHER_EMBEDDED_PG_DIR ??
    path.join(os.homedir(), ".slaw-botfather", "db")
  );
}

/**
 * Provision the database with zero manual steps (mirrors SLAW's index.ts):
 *  - external: if BOTFATHER_DATABASE_URL is set, just migrate + connect
 *  - embedded: otherwise start embedded-postgres, create the DB, migrate, connect
 * Migrations always auto-apply — botfather is infrastructure, not interactive.
 */
export async function bootstrapDatabase(externalUrl: string | undefined, port: number): Promise<DbHandle> {
  if (externalUrl) {
    await runMigrations(externalUrl);
    return { db: createDb(externalUrl), connectionString: externalUrl, stop: async () => {} };
  }

  const dataDir = embeddedDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const alreadyInitialised = fs.existsSync(path.join(dataDir, "PG_VERSION"));

  // dynamic import keeps the native dep out of the way for external-PG deployments
  const mod = await import("embedded-postgres");
  const EmbeddedPostgres = (mod.default ?? mod) as unknown as new (opts: {
    databaseDir: string;
    user: string;
    password: string;
    port: number;
    persistent: boolean;
  }) => {
    initialise: () => Promise<void>;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  };

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: EMBEDDED_USER,
    password: EMBEDDED_PASSWORD,
    port,
    persistent: true,
  });

  if (!alreadyInitialised) await pg.initialise();
  await pg.start();

  const adminUrl = `postgres://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@127.0.0.1:${port}/postgres`;
  const dbUrl = `postgres://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@127.0.0.1:${port}/${DB_NAME}`;

  await ensureDatabase(adminUrl, DB_NAME);
  await runMigrations(dbUrl);

  return {
    db: createDb(dbUrl),
    connectionString: dbUrl,
    stop: async () => {
      await pg.stop();
    },
  };
}
