import { createDb } from "@slaw-botfather/db";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { startStatusSweeper } from "./services/status-sweeper.js";
import { startRollupJob } from "./services/rollups.js";
import { startAlertEvaluator } from "./services/alerts.js";
import { startRetentionJob } from "./services/retention.js";
import { LiveHub, attachLiveStream } from "./services/live-stream.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
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
