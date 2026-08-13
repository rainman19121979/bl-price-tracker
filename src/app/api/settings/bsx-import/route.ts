import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { importBsxSource } from "@/lib/bsx-orders";
import { loadUserBsxSource } from "@/lib/bsx-source";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!user?.isAdmin) return NextResponse.json({ error: "Nur Admin" }, { status: 403 });

  const source = await loadUserBsxSource(userId);
  if (!source) {
    return NextResponse.json({ error: "Keine BSX-Quelle konfiguriert" }, { status: 400 });
  }

  const t0 = Date.now();
  try {
    const result = await importBsxSource(source, userId);
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      ordersProcessed: result.ordersProcessed,
      itemsImported: result.itemsImported,
      itemsSkipped: result.itemsSkipped,
      partsCreated: result.partsCreated,
      errors: result.errors.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import fehlgeschlagen" },
      { status: 500 },
    );
  }
}
