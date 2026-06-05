import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.BOTFATHER_DATABASE_URL ??
      "postgres://postgres:postgres@127.0.0.1:54330/botfather",
  },
});
