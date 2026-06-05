import { createDb } from "@slaw-botfather/db";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { startStatusSweeper } from "./services/status-sweeper.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = createApp(db, config);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`botfather listening on :${config.port}`);
});

startStatusSweeper(db, config);
