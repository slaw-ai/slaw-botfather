import { runMigrations } from "./bootstrap.js";

const url = process.env.BOTFATHER_DATABASE_URL;
if (!url) {
  console.error("BOTFATHER_DATABASE_URL is required for standalone migrate");
  process.exit(1);
}
runMigrations(url)
  .then(() => {
    console.log("migrations applied");
    process.exit(0);
  })
  .catch((err) => {
    console.error("migration failed:", err);
    process.exit(1);
  });
