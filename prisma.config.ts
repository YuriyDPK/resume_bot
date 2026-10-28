import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./src/lib/database-url";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

const databaseUrl = resolveDatabaseUrl();
// Prisma 7's schema engine checks existence before migrate deploy on SQLite.
// Create an empty file on first install without truncating an existing database.
mkdirSync(path.dirname(databaseUrl.slice(5)), { recursive: true });
closeSync(openSync(databaseUrl.slice(5), "a"));

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl }
});
