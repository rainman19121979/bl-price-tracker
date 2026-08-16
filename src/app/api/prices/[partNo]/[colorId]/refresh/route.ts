import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validatePartParams } from "@/lib/validate-params";
import { getUsage, getExternalCallCount } from "@/lib/api-usage";
import { fetchPriceData } from "@/lib/fetch-prices";
import { getCountryFilters } from "@/lib/user-settings";
import { findPart } from "@/lib/find-part";

export const dynamic = "force-dynamic";

/**
 * Frontend-triggered Refresh eines Parts (Detail-Seite "Jetzt aktualisieren").
 * Delegiert komplett an fetchPriceData -- damit kriegt der Endpoint automatisch
 * alle Fixes (country_code aus User-Setting, completeness-Split fuer SETs,
 * recomputeAllLotsForPart am Ende) statt einer parallelen Implementierung.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { partNo: string; colorId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  let validParams;
  try {
    validParams = validatePartParams(params);
  } catch {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }
  const { partNo, colorId } = validParams;

  let body: { newOrUsed?: string } = {};
  try { body = await request.json(); } catch { /* default */ }
  const newOrUsed = (body.newOrUsed === "N" ? "N" : "U") as "N" | "U";

  const part = await findPart(partNo, colorId);
  if (!part) {
    return NextResponse.json({ error: "Teil nicht gefunden" }, { status: 404 });
  }

  const apiKey = await prisma.userApiKey.findFirst({
    where: { userId, isValid: true },
    orderBy: { createdAt: "desc" },
  });
  if (!apiKey) return NextResponse.json({ error: "Kein API-Key" }, { status: 400 });

  // Budget-Check: SET braucht 6 Calls (3 completeness × sold+stock), sonst 2
  const callsNeeded = part.itemType === "SET" ? 6 : 2;
  const used = await getUsage(apiKey.id);
  const external = await getExternalCallCount(userId);
  if (apiKey.dailyLimit - used - external < callsNeeded) {
    return NextResponse.json({
      error: `Tageslimit erreicht (${callsNeeded} Calls noetig, Rest: ${apiKey.dailyLimit - used - external})`,
    }, { status: 429 });
  }

  try {
    const { sellerCountries } = await getCountryFilters(userId);
    // fetchPriceData logged die tatsaechlichen API-Calls intern
    const result = await fetchPriceData(part, newOrUsed, apiKey.id, {
      stockCountryCodes: sellerCountries ?? undefined,
    });

    return NextResponse.json({
      success: true,
      sales: result.salesCount,
      stockOffers: result.stockCount,
    });
  } catch (error) {
    console.error("[refresh] Error:", error);
    return NextResponse.json({ error: "Ein Fehler ist aufgetreten" }, { status: 500 });
  }
}
