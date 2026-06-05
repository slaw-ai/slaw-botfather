import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { bootstrapDatabase } from "./services/bootstrap-db.js";
import { startStatusSweeper } from "./services/status-sweeper.js";
import { startRollupJob } from "./services/rollups.js";
import { startAlertEvaluator } from "./services/alerts.js";
import { startRetentionJob } from "./services/retention.js";
import { LiveHub, attachLiveStream } from "./services/live-stream.js";

async function main() {
  const config = loadConfig();

  // zero-config DB: external URL if provided, otherwise embedded Postgres.
  // creates the database and applies migrations before we listen.
  const mode = config.databaseUrl ? "external Postgres" : "embedded Postgres";
  // eslint-disable-next-line no-console
  console.log(`botfather: provisioning database (${mode})…`);
  const { db, stop } = await bootstrapDatabase(config.databaseUrl, config.embeddedPgPort);

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
