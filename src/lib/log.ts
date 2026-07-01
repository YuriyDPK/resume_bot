import { prisma } from "@/lib/prisma";

export type LogLevel = "info" | "warn" | "error";

export async function writeLog(level: LogLevel, message: string, meta?: unknown) {
  try {
    await prisma.log.create({
      data: {
        level,
        message,
        meta: meta === undefined ? undefined : JSON.stringify(meta).slice(0, 8000)
      }
    });
  } catch (error) {
    console.error("Failed to write log", error);
  }
}
