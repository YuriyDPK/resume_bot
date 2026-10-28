import path from "node:path";

// Keep legacy DATABASE_URL=file:./dev.db relative to prisma/schema.prisma.
// Both the CLI and the driver must resolve to the same existing database.
export function resolveDatabaseUrl(value = process.env.DATABASE_URL ?? "file:./dev.db") {
  if (!value.startsWith("file:")) throw new Error("DATABASE_URL должен указывать на SQLite (file:...)");
  const filename = value.slice(5);
  return "file:" + (path.isAbsolute(filename) ? filename : path.resolve(process.cwd(), "prisma", filename));
}
