import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Public endpoint (via middleware `/api/auth` prefix? No — add /api/setup).
// This tells the UI whether the app is in first-run setup mode (no users yet).
export const dynamic = "force-dynamic";

export async function GET() {
  const userCount = await prisma.user.count();
  return NextResponse.json({ setupMode: userCount === 0 });
}
