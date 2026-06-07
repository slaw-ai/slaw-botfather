import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { bootstrapDatabase } from "./services/bootstrap-db.js";
import { startStatusSweeper } from "./services/status-sweeper.js";
import { startRollupJob } from "./services/rollups.js";
import { startAlertEvaluator } from "./services/alerts.js";
import { startRetentionJob } from "./services/retention.js";
import { LiveHub, attachLiveStream } from "./services/live-stream.js";
import { seedStandardSkills } from "./services/skill-registry-seed.js";

async function main() {
  const config = loadConfig();

  // zero-config DB: external URL if provided, otherwise embedded Postgres.
  // creates the database and applies migrations before we listen.
  const mode = config.databaseUrl ? "external Postgres" : "embedded Postgres";
  // eslint-disable-next-line no-console
  console.log(`botfather: provisioning database (${mode})…`);
  const { db, stop } = await bootstrapDatabase(config.databaseUrl, config.embeddedPgPort);

  // Seed the standard skills catalog (idempotent; env-gated via SEED_STANDARD_SKILLS).
  // Runs once per tower DB after migrations, before we accept traffic.
  try {
    const seeded = await seedStandardSkills(db);
    if (seeded.created > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `botfather: seeded standard skills (created ${seeded.created}, skipped ${seeded.skipped} of ${seeded.total})`,
      );
    }
  } catch (err) {
    // Seeding is best-effort: a failure here must not stop the tower from serving.
    // eslint-disable-next-line no-console
    console.error("botfather: standard-skills seed failed (continuing):", err);
  }

  const app = createApp(db, config);
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`botfather listening on :${config.port}`);
  });

  const liveHub = new LiveHub();
  attachLiveStream(server, db, liveHub);

  startStatusSweeper(db, config);
  startRollupJob(db);
  startAlertEvaluator(db, config);
  startRetentionJob(db);

  const shutdown = async () => {
    server.close();
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("botfather failed to start:", err);
  process.exit(1);
});
