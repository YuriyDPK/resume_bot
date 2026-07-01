import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const logs = await prisma.log.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json({ logs });
}
