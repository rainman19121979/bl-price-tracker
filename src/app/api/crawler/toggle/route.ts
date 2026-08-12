import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isCrawlerActive, setCrawlerActive } from "@/lib/crawler-control";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const active = await isCrawlerActive();
  return NextResponse.json({ active });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user.isAdmin) {
    return NextResponse.json({ error: "Nur fuer Administratoren" }, { status: 403 });
  }

  let body: { active?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active must be boolean" }, { status: 400 });
  }

  await setCrawlerActive(body.active);
  console.log(`[Crawler] ${body.active ? "AKTIVIERT" : "DEAKTIVIERT"} von User ${session.user.id}`);

  return NextResponse.json({ active: body.active });
}
