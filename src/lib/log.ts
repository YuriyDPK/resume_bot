import { activeProfileId } from "@/lib/profiles";
import { prisma } from "@/lib/prisma";

export type LogLevel = "info" | "warn" | "error";

export async function writeLog(level: LogLevel, message: string, meta?: unknown, profileId?: number) {
  try {
    await prisma.log.create({
      data: {
        profileId: profileId ?? await activeProfileId(),
        level,
        message,
        meta: meta === undefined ? undefined : JSON.stringify(meta).slice(0, 8000)
      }
    });
  } catch (error) {
    console.error("Failed to write log", error);
  }
}
