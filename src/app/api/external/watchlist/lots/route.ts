import { NextRequest, NextResponse } from "next/server";
import { authenticateBearer, getApiUsageFor } from "@/lib/external-price";
import { upsertLot, deleteLots, validateLot, isLotError } from "@/lib/watchlist-lots";
import { prisma } from "@/lib/db";

const MAX_BATCH_SIZE = 100;
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Bearer token required or invalid" }, { status: 401 });

  const url = new URL(request.url);
  const skipPriceFetch = url.searchParams.get("skipPriceFetch") === "true";

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const lots = (body as { lots?: unknown })?.lots;
  if (!Array.isArray(lots)) {
    return NextResponse.json({ error: "Body must be { lots: [...] }" }, { status: 400 });
  }
  if (lots.length === 0) return NextResponse.json({ count: 0, results: [] });
  if (lots.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `Max ${MAX_BATCH_SIZE} lots per request` }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { freshDays: true },
  });
  const freshDays = user?.freshDays ?? 14;

  const t0 = Date.now();
  const results: unknown[] = [];
  let created = 0, updated = 0, errors = 0, blCalls = 0;

  for (const raw of lots) {
    const v = validateLot((raw ?? {}) as Record<string, unknown>);
    if (!v.ok) {
      const r = raw as Record<string, unknown>;
      results.push({
        blInventoryId: r?.blInventoryId ?? null,
        partNo: r?.partNo ?? null,
        error: v.error,
      });
      errors++;
      continue;
    }
    const result = await upsertLot(auth.userId, v.lot, { skipPriceFetch, freshDays });
    results.push(result);
    if (isLotError(result)) errors++;
    else {
      if (result.wasCreated) created++;
      else updated++;
      if (result.freshlyCrawled) blCalls += 2;
    }
  }

  return NextResponse.json({
    count: results.length,
    created,
    updated,
    errors,
    blApiCalls: blCalls,
    durationMs: Date.now() - t0,
    results,
    apiUsage: await getApiUsageFor(auth.userId),
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Bearer token required or invalid" }, { status: 401 });

  const url = new URL(request.url);
  const single = url.searchParams.get("blInventoryId");
  let ids: number[] = [];

  if (single) {
    const n = parseInt(single);
    if (Number.isFinite(n) && n > 0) ids = [n];
  } else {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const raw = (body as { blInventoryIds?: unknown })?.blInventoryIds;
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: "Body must be { blInventoryIds: [...] } or use ?blInventoryId=N" }, { status: 400 });
    }
    ids = raw.map(x => parseInt(String(x))).filter(x => Number.isFinite(x) && x > 0);
  }

  if (ids.length === 0) return NextResponse.json({ deleted: 0, apiUsage: await getApiUsageFor(auth.userId) });

  const deleted = await deleteLots(auth.userId, ids);
  return NextResponse.json({ deleted, requested: ids.length, apiUsage: await getApiUsageFor(auth.userId) });
}
