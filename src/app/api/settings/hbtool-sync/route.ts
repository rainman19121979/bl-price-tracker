import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runHbtoolSync } from "@/lib/hbtool-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Jetzt abrufen": Inventar + Bestellungen sofort von hb-tool holen.
// force=true uebergeht ETag und die Bremse gegen Massenloeschung.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!me?.isAdmin) return NextResponse.json({ error: "Nur Admin" }, { status: 403 });

  let body: { force?: boolean } = {};
  try { body = await request.json(); } catch { /* leerer Body ok */ }

  const t0 = Date.now();
  const result = await runHbtoolSync(userId, { force: body.force === true });
  return NextResponse.json({ ...result, durationMs: Date.now() - t0 }, { status: result.inventory || result.orders ? 200 : 400 });
}
