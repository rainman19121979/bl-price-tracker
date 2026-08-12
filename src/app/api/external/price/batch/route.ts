import { NextRequest, NextResponse } from "next/server";
import { authenticateBearer, validateRequest, computeExternalPrice, getApiUsageFor } from "@/lib/external-price";

const MAX_BATCH_SIZE = 100;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Bearer token required or invalid" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "Body must be { items: [...] }" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ items: [] });
  }
  if (items.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `Max ${MAX_BATCH_SIZE} items per batch` }, { status: 400 });
  }

  const results: unknown[] = [];
  for (const raw of items) {
    const v = validateRequest(raw as Record<string, unknown>);
    if (!v.ok) {
      const r = raw as Record<string, unknown>;
      results.push({
        partNo: r.partNo ?? null,
        colorId: r.colorId ?? null,
        itemType: r.itemType ?? null,
        condition: r.condition ?? null,
        error: v.error,
      });
      continue;
    }
    const result = await computeExternalPrice(auth.userId, v.req);
    results.push(result);
  }

  return NextResponse.json({ count: results.length, items: results, apiUsage: await getApiUsageFor(auth.userId) });
}
