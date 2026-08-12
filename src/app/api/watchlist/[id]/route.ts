import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { recomputeLotPricing } from "@/lib/lot-pricing";

const updateWatchlistSchema = z.object({
  priority: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional(),
  alertBelow: z.number().positive().nullable().optional(),
  alertAbove: z.number().positive().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  saleRate: z.number().int().min(0).max(99).optional(),
  priceLocked: z.boolean().optional(),
});

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const itemId = parseInt(params.id);
  if (isNaN(itemId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = updateWatchlistSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (result.data.priority !== undefined) data.priority = result.data.priority;
  if (result.data.alertBelow !== undefined) data.alertBelow = result.data.alertBelow;
  if (result.data.alertAbove !== undefined) data.alertAbove = result.data.alertAbove;
  if (result.data.notes !== undefined) data.notes = result.data.notes;
  if (result.data.saleRate !== undefined) data.saleRate = result.data.saleRate;
  if (result.data.priceLocked !== undefined) data.priceLocked = result.data.priceLocked;

  // Single-shot ownership-gated update — no TOCTOU window.
  const updateResult = await prisma.userWatchlist.updateMany({
    where: { id: itemId, userId: parseInt(session.user.id) },
    data,
  });

  if (updateResult.count === 0) {
    return NextResponse.json({ error: "Eintrag nicht gefunden" }, { status: 404 });
  }

  // Recompute pricing cache if saleRate / priceLocked changed
  if (result.data.saleRate !== undefined || result.data.priceLocked !== undefined) {
    try {
      await recomputeLotPricing(itemId);
    } catch (err) {
      console.error("[watchlist PUT] Recompute-Fehler:", err instanceof Error ? err.message : err);
    }
  }

  const updated = await prisma.userWatchlist.findUnique({ where: { id: itemId } });
  return NextResponse.json({ watchlistItem: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const itemId = parseInt(params.id);
  if (isNaN(itemId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const deleteResult = await prisma.userWatchlist.deleteMany({
    where: { id: itemId, userId: parseInt(session.user.id) },
  });

  if (deleteResult.count === 0) {
    return NextResponse.json({ error: "Eintrag nicht gefunden" }, { status: 404 });
  }

  return NextResponse.json({ message: "Aus Inventar entfernt" });
}
