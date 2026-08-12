import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validatePartParams } from "@/lib/validate-params";
import { findPart } from "@/lib/find-part";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { partNo: string; colorId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let validParams;
  try {
    validParams = validatePartParams(params);
  } catch {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }
  const { partNo, colorId } = validParams;
  const { searchParams } = new URL(request.url);
  const condition = searchParams.get("condition") || "U";

  const part = await findPart(partNo, colorId);
  if (!part) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }

  const userId = parseInt(session.user.id);

  // Stock items + own lots in parallel
  interface StockRow { unit_price: number; quantity: number; fetched_at: Date; }

  const [items, myLots] = await Promise.all([
    prisma.$queryRawUnsafe<StockRow[]>(
      `WITH latest AS (
        SELECT MAX(fetched_at) as max_ts FROM price_stock WHERE part_id = $1 AND new_or_used = $2
      )
      SELECT unit_price::float, quantity, fetched_at
      FROM price_stock, latest
      WHERE part_id = $1 AND new_or_used = $2 AND fetched_at = latest.max_ts
      ORDER BY unit_price ASC`,
      part.id,
      condition
    ),
    prisma.userWatchlist.findMany({
      where: { userId, partId: part.id, newOrUsed: condition },
      select: { myPrice: true, myQuantity: true },
    }),
  ]);

  return NextResponse.json({
    items: items.map((i) => {
      const isMine = myLots.some(l =>
        l.myPrice && l.myQuantity &&
        Number(l.myPrice).toFixed(4) === i.unit_price.toFixed(4) &&
        l.myQuantity === i.quantity
      );
      return {
        unitPrice: i.unit_price,
        quantity: i.quantity,
        fetchedAt: i.fetched_at,
        isMine,
      };
    }),
  });
}
