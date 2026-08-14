import { NextRequest, NextResponse } from "next/server";
import { authenticateBearer, enforceExternalRateLimit, getApiUsageFor } from "@/lib/external-price";
import { recomputeAllLotsForUser } from "@/lib/lot-pricing";

export const dynamic = "force-dynamic";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Bearer token required or invalid" }, { status: 401 });
  const _rl = await enforceExternalRateLimit(auth.tokenId); if (_rl) return _rl;

  const t0 = Date.now();
  try {
    const result = await recomputeAllLotsForUser(auth.userId);
    return NextResponse.json({
      success: true,
      recomputed: result.updated,
      durationMs: Date.now() - t0,
      apiUsage: await getApiUsageFor(auth.userId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Recompute failed", durationMs: Date.now() - t0, apiUsage: await getApiUsageFor(auth.userId) },
      { status: 500 },
    );
  }
}
