import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadUserHbtoolSource, normalizeHbtoolUrl, testHbtool } from "@/lib/hbtool-source";

export const dynamic = "force-dynamic";

// Verbindung zu hb-tool testen, BEVOR gespeichert wird. Ohne Token im Body
// wird der gespeicherte genommen. Nichts wird geschrieben.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!me?.isAdmin) return NextResponse.json({ error: "Nur Admin" }, { status: 403 });

  let body: { url?: string; token?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const url = normalizeHbtoolUrl(body.url ?? "");
  if (!url) return NextResponse.json({ error: "Ungültige URL" }, { status: 400 });
  let token = (body.token ?? "").trim();
  if (!token) token = (await loadUserHbtoolSource(userId))?.token ?? "";
  if (!token) return NextResponse.json({ error: "Kein Schlüssel angegeben oder gespeichert" }, { status: 400 });

  const result = await testHbtool({ url, token });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, lots: result.lots });
}
