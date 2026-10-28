import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { resolveDatabaseUrl } from "@/lib/database-url";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaRevision?: string };

export const prisma =
  (globalForPrisma.prismaRevision === "inbox-ownership-v1" ? globalForPrisma.prisma : undefined) ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: resolveDatabaseUrl() }, { timestampFormat: "unixepoch-ms" }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

globalForPrisma.prisma = prisma;
globalForPrisma.prismaRevision = "inbox-ownership-v1";
