import { NextRequest, NextResponse } from "next/server";
import { authenticateBearer, getApiUsageFor } from "@/lib/external-price";
import { syncBricklinkInventory } from "@/lib/inventory-sync";
import { fetchPriceData } from "@/lib/fetch-prices";
import { prisma } from "@/lib/db";
import { recomputeAllLotsForPart } from "@/lib/lot-pricing";
import { logApiCall, getUsage, getExternalCallCount } from "@/lib/api-usage";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Bearer token required or invalid" }, { status: 401 });

  const url = new URL(request.url);
  const fetchNewParts = url.searchParams.get("fetchNewParts") !== "false";

  const t0 = Date.now();
  try {
    const result = await syncBricklinkInventory(auth.userId);

    let priceFetches = 0;
    let priceFetchErrors = 0;

    if (fetchNewParts && result.newPartIds.length > 0) {
      const apiKey = await prisma.userApiKey.findFirst({
        where: { userId: auth.userId, isValid: true },
        orderBy: { createdAt: "desc" },
      });
      if (apiKey) {
        for (const t of result.newPartIds) {
          const used = await getUsage(apiKey.id);
          const ext = await getExternalCallCount(auth.userId);
          if (apiKey.dailyLimit - used - ext < 2) break;

          const part = await prisma.part.findUnique({ where: { id: t.partId } });
          if (!part) continue;
          try {
            await fetchPriceData(part, t.newOrUsed, apiKey.id);
            await logApiCall(apiKey.id);
            await recomputeAllLotsForPart(t.partId, t.newOrUsed);
            priceFetches++;
          } catch {
            priceFetchErrors++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - t0,
      totalLots: result.totalLots,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      errors: result.errors,
      newParts: result.newPartIds.length,
      priceFetches,
      priceFetchErrors,
      apiUsage: await getApiUsageFor(auth.userId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed", durationMs: Date.now() - t0, apiUsage: await getApiUsageFor(auth.userId) },
      { status: 500 },
    );
  }
}
