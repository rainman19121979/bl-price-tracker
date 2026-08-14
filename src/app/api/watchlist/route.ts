import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { watchlistAddSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const { searchParams } = new URL(request.url);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")));
  const search = searchParams.get("q")?.trim() || "";
  const sort = searchParams.get("sort") || "partNo";
  const dir = searchParams.get("dir") || "asc";
  const conditionFilter = searchParams.get("condition") || "";
  const itemTypeFilter = searchParams.get("itemType") || "";
  const hasDataFilter = searchParams.get("hasData") || "";
  const hasDescFilter = searchParams.get("hasDesc") || "";
  const hasSaleFilter = searchParams.get("hasSale") || "";
  const lockedFilter = searchParams.get("locked") || "";
  const completenessFilter = searchParams.get("completeness") || "";
  const diffFilter = searchParams.get("diff") || "";
  const trendFilter = searchParams.get("trend") || "";
  const skip = (page - 1) * limit;
  const prismaDir = dir === "desc" ? "desc" as const : "asc" as const;

  // Build where clause
  const where: Record<string, unknown> = { userId };
  if (conditionFilter) {
    where.newOrUsed = conditionFilter;
  }

  const partWhere: Record<string, unknown> = {};
  if (search) {
    partWhere.OR = [
      { partNo: { contains: search, mode: "insensitive" } },
      { partName: { contains: search, mode: "insensitive" } },
      { colorName: { contains: search, mode: "insensitive" } },
    ];
  }
  if (itemTypeFilter) {
    partWhere.itemType = itemTypeFilter;
  }
  // hasDataFilter: pre-filter watchlist IDs using condition-specific timestamps
  if (hasDataFilter === "with" || hasDataFilter === "without") {
    const op = hasDataFilter === "with" ? "IS NOT NULL" : "IS NULL";
    const ids = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT w.id FROM user_watchlists w JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = $1 AND (
         CASE WHEN w.new_or_used = 'N'
           THEN COALESCE(p.last_sold_crawl_n, p.last_stock_crawl_n)
           ELSE COALESCE(p.last_sold_crawl_u, p.last_stock_crawl_u)
         END
       ) ${op}`,
      userId
    );
    where.id = { in: ids.map(i => i.id) };
  }
  // Description filter
  if (hasDescFilter === "with") {
    where.description = { not: null };
  } else if (hasDescFilter === "without") {
    where.description = null;
  }
  // Sale rate filter
  if (hasSaleFilter === "with") {
    where.saleRate = { gt: 0 };
  } else if (hasSaleFilter === "without") {
    where.saleRate = 0;
  }
  // Price locked filter
  if (lockedFilter === "yes") {
    where.priceLocked = true;
  } else if (lockedFilter === "no") {
    where.priceLocked = false;
  }
  // Completeness filter (nur bei SETs relevant; Non-SETs haben NULL und werden
  // durch einen expliziten C/I/S-Filter automatisch ausgeschlossen)
  if (completenessFilter === "C" || completenessFilter === "I" || completenessFilter === "S") {
    where.completeness = completenessFilter;
  }
  // Trend filter (cached column)
  if (trendFilter === "up" || trendFilter === "down" || trendFilter === "stable") {
    where.trend = trendFilter;
  }
  // Diff filter: myPrice vs suggestedPrice (now server-side via cached suggestedPrice)
  if (diffFilter === "over" || diffFilter === "under") {
    const op = diffFilter === "over" ? "GREATER" : "LESS";
    const ids = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM user_watchlists
       WHERE user_id = $1 AND my_price IS NOT NULL AND suggested_price IS NOT NULL
       AND my_price ${op === "GREATER" ? ">" : "<"} suggested_price`,
      userId
    );
    const allowedIds = new Set(ids.map(i => i.id));
    if (where.id && typeof where.id === "object" && "in" in where.id && Array.isArray((where.id as { in: number[] }).in)) {
      // Intersect with existing ID filter (e.g. from hasData)
      where.id = { in: (where.id as { in: number[] }).in.filter((x: number) => allowedIds.has(x)) };
    } else {
      where.id = { in: Array.from(allowedIds) };
    }
  }
  if (Object.keys(partWhere).length > 0) {
    where.part = partWhere;
  }

  // Build orderBy
  type OrderBy = Record<string, unknown>;
  let orderBy: OrderBy[] = [{ part: { partNo: prismaDir } }];
  switch (sort) {
    case "partNo":
      orderBy = [{ part: { partNo: prismaDir } }];
      break;
    case "name":
      orderBy = [{ part: { partName: prismaDir } }];
      break;
    case "condition":
      orderBy = [{ newOrUsed: prismaDir }];
      break;
    case "myPrice":
      orderBy = [{ myPrice: { sort: prismaDir, nulls: "last" } }];
      break;
    case "quantity":
      orderBy = [{ myQuantity: { sort: prismaDir, nulls: "last" } }];
      break;
    case "age":
      orderBy = [{ part: { lastPriceUpdate: { sort: prismaDir, nulls: dir === "asc" ? "first" : "last" } } }];
      break;
    default:
      orderBy = [{ part: { partNo: "asc" } }];
  }

  // Count + paginated fetch in parallel
  const [total, watchlist] = await Promise.all([
    prisma.userWatchlist.count({ where }),
    prisma.userWatchlist.findMany({
      where,
      include: {
        part: {
          select: {
            id: true,
            partNo: true,
            colorId: true,
            itemType: true,
            partName: true,
            colorName: true,
            categoryId: true,
            lastPriceUpdate: true,
            lastSoldCrawlN: true,
            lastSoldCrawlU: true,
            lastStockCrawlN: true,
            lastStockCrawlU: true,
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  // All pricing data is now read directly from user_watchlists (precomputed cache)
  const items = watchlist.map((w) => {
    return {
      id: w.id,
      priority: w.priority,
      newOrUsed: w.newOrUsed,
      completeness: w.completeness,   // C|I|S bei SETs, sonst null
      myPrice: w.myPrice,
      myQuantity: w.myQuantity,
      saleRate: w.saleRate ?? 0,
      priceLocked: w.priceLocked ?? false,
      description: w.description,
      part: {
        id: w.part.id,
        partNo: w.part.partNo,
        colorId: w.part.colorId,
        itemType: w.part.itemType,
        partName: w.part.partName,
        colorName: w.part.colorName,
        lastPriceUpdate: (() => {
          const sold = w.newOrUsed === "N" ? w.part.lastSoldCrawlN : w.part.lastSoldCrawlU;
          const stock = w.newOrUsed === "N" ? w.part.lastStockCrawlN : w.part.lastStockCrawlU;
          if (sold && stock) return sold > stock ? sold : stock;
          return sold || stock || null;
        })(),
      },
      marketMedian: w.marketSoldMedian ? Number(w.marketSoldMedian) : null,
      marketQtyAvg: null,
      stockMedian: w.marketStockMedian ? Number(w.marketStockMedian) : null,
      stockQtyAvg: null,
      trend: w.trend,
      suggestedPrice: w.suggestedPrice ? Number(w.suggestedPrice) : null,
      suggestedRuleName: w.suggestedRuleName,
    };
  });

  // Get user's freshDays for age coloring
  const userFresh = await prisma.user.findUnique({ where: { id: userId }, select: { freshDays: true } });

  return NextResponse.json({
    watchlist: items,
    freshDays: userFresh?.freshDays ?? 14,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = watchlistAddSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { partNo, colorId, priority, alertBelow, alertAbove, newOrUsed } = result.data;
  const userId = parseInt(session.user.id);
  const condition = newOrUsed ?? "U";

  let part = await prisma.part.findUnique({
    where: { partNo_colorId_itemType: { partNo, colorId, itemType: "PART" } },
  });

  if (!part) {
    part = await prisma.part.create({
      data: { partNo, colorId, itemType: "PART" },
    });
  }

  // Check if manually added entry already exists (no blInventoryId)
  const existing = await prisma.userWatchlist.findFirst({
    where: { userId, partId: part.id, newOrUsed: condition, blInventoryId: null },
  });

  if (existing) {
    return NextResponse.json(
      { error: "Teil ist bereits in deinem Inventar" },
      { status: 409 }
    );
  }

  const watchlistItem = await prisma.userWatchlist.create({
    data: {
      userId,
      partId: part.id,
      newOrUsed: condition,
      priority: priority ?? 5,
      alertBelow,
      alertAbove,
    },
  });

  // Crawler picks stale parts dynamically from user_watchlists — no queue needed.
  // crawl_queue table is legacy and no longer read by the crawler loop.

  return NextResponse.json(
    { watchlistItem: { id: watchlistItem.id, partNo: part.partNo, colorId: part.colorId, newOrUsed: condition } },
    { status: 201 }
  );
}
