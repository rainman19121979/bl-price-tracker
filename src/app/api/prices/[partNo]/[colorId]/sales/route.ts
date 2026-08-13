import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCountryFilters } from "@/lib/user-settings";
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
  const page = Math.max(parseInt(searchParams.get("page") ?? "1") || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") ?? "50") || 50, 1),
    200
  );
  const condition = searchParams.get("condition");

  const userId = parseInt(session.user.id);

  // findPart + getCountryFilters in parallel
  const [part, filters] = await Promise.all([
    findPart(partNo, colorId),
    getCountryFilters(userId),
  ]);
  if (!part) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }
  const { shippingCountries, sellerCountries } = filters;

  const where: Record<string, unknown> = { partId: part.id };
  if (condition === "N" || condition === "U") {
    where.newOrUsed = condition;
  }
  if (shippingCountries) {
    where.buyerCountry = { in: shippingCountries };
  }
  if (sellerCountries) {
    where.sellerCountry = { in: sellerCountries };
  }

  // Sales + count + mySales all in parallel
  const [sales, total, mySales] = await Promise.all([
    prisma.priceSale.findMany({
      where,
      select: {
        id: true,
        dateOrdered: true,
        unitPrice: true,
        quantity: true,
        buyerCountry: true,
        newOrUsed: true,
        sellerCountry: true,
      },
      orderBy: { dateOrdered: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.priceSale.count({ where }),
    prisma.mySale.findMany({
      where: { userId, partId: part.id },
      select: { unitPrice: true, quantity: true, soldAt: true, newOrUsed: true },
    }),
  ]);

  const serializedSales = sales.map((s) => {
    const price = Number(s.unitPrice);
    const isMine = mySales.some(ms => {
      if (ms.newOrUsed !== s.newOrUsed) return false;
      if (Number(ms.unitPrice).toFixed(4) !== price.toFixed(4)) return false;
      if (ms.quantity !== s.quantity) return false;
      const diff = Math.abs(ms.soldAt.getTime() - s.dateOrdered.getTime());
      return diff < 2 * 86400000;
    });

    return {
      ...s,
      id: String(s.id),
      unitPrice: String(s.unitPrice),
      isMine,
    };
  });

  return NextResponse.json({
    partNo: part.partNo,
    colorId: part.colorId,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    sales: serializedSales,
  });
}
