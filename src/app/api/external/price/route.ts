import { NextRequest, NextResponse } from "next/server";
import { authenticateBearer, validateRequest, computeExternalPrice, isPriceError, getApiUsageFor } from "@/lib/external-price";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Bearer token required or invalid" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const v = validateRequest({
    partNo: searchParams.get("partNo") ?? undefined,
    colorId: searchParams.get("colorId") ?? undefined,
    itemType: searchParams.get("itemType") ?? undefined,
    condition: searchParams.get("condition") ?? undefined,
  });
  if (!v.ok) return NextResponse.json({ error: v.error, apiUsage: await getApiUsageFor(auth.userId) }, { status: 400 });

  const result = await computeExternalPrice(auth.userId, v.req);
  const apiUsage = await getApiUsageFor(auth.userId);
  if (isPriceError(result)) return NextResponse.json({ error: result.error, apiUsage }, { status: result.status });
  return NextResponse.json({ ...result, apiUsage });
}
