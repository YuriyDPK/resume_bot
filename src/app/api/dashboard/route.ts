import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function GET() {
  const today = startOfToday();
  const [vacanciesFound, appliedToday, pending, skipped, failed, recentLogs] = await Promise.all([
    prisma.vacancy.count(),
    prisma.application.count({ where: { status: "applied", appliedAt: { gte: today } } }),
    prisma.vacancy.count({ where: { status: "pending" } }),
    prisma.vacancy.count({ where: { status: "skipped" } }),
    prisma.vacancy.count({ where: { status: "failed" } }),
    prisma.log.findMany({ orderBy: { createdAt: "desc" }, take: 6 })
  ]);

  return NextResponse.json({ vacanciesFound, appliedToday, pending, skipped, failed, recentLogs });
}
