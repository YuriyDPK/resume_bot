import { NextResponse } from "next/server";
import { dashboardData } from "@/lib/dashboard-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await dashboardData();
  return NextResponse.json({ ...data, recentLogs: data.activity.logs });
}
