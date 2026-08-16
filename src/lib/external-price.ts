import { prisma } from "@/lib/db";
import { fetchPriceData } from "@/lib/fetch-prices";
import { evaluateFormula, findMatchingRule, type PricingRule, type PricingVars } from "@/lib/pricing-engine";
import { getCountryFilters } from "@/lib/user-settings";
import { getUsage, getExternalCallCount } from "@/lib/api-usage";

export interface ApiUsage {
  used: number;      // BL API calls logged in api_call_log (last 24h)
  external: number;  // estimated external calls from per-key externalCalls JSON
  limit: number;     // configured dailyLimit
  remaining: number; // limit - used - external
}

/**
 * Returns BL API usage snapshot for the user's active API key.
 * Returns null if user has no valid API key.
 */
export async function getApiUsageFor(userId: number): Promise<ApiUsage | null> {
  const apiKey = await prisma.userApiKey.findFirst({
    where: { userId, isValid: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, dailyLimit: true },
  });
  if (!apiKey) return null;
  const used = await getUsage(apiKey.id);
  const external = await getExternalCallCount(userId);
  return {
    used,
    external,
    limit: apiKey.dailyLimit,
    remaining: Math.max(0, apiKey.dailyLimit - used - external),
  };
}

export interface PriceRequest {
  partNo: string;
  colorId: number;
  itemType: "PART" | "MINIFIG" | "SET";
  condition: "N" | "U";
  completeness?: "C" | "I" | "S";  // nur bei SET relevant, sonst ignoriert
  blInventoryId?: number;  // optional -- wenn mitgegeben, wird der Watchlist-Eintrag
                           // gematcht und lot-spezifische Felder (saleRate, priceLocked,
                           // myPrice) im Response ergaenzt. Fuer BrickStore-Extension,
                           // die den Rabatt + Lock-Zustand zurueckspielen will.
}

export interface PriceResponse {
  partNo: string;
  colorId: number;
  itemType: string;
  condition: "N" | "U";
  completeness: "C" | "I" | "S" | null;  // was tatsächlich abgefragt wurde
  suggestedPrice: number | null;
  rule: string | null;
  stockMedian: number | null;
  stockAvg: number | null;
  stockMin: number | null;
  stockMax: number | null;
  stockOffers: number;
  soldMedian: number | null;
  soldAvg: number | null;
  lastSoldFetch: Date | null;
  lastStockFetch: Date | null;
  freshlyCrawled: boolean;
  // Lot-spezifisch -- nur befuellt wenn Request blInventoryId enthielt und ein
  // passender user_watchlists-Eintrag gefunden wurde. Sonst alle null.
  blInventoryId: number | null;
  saleRate: number | null;      // Rabatt in Prozent (0-99), aus user_watchlists.saleRate
  priceLocked: boolean | null;  // true = Extension sollte den Preis NICHT ueberschreiben
  myPrice: number | null;       // aktueller myPrice im Tracker (fuer Anzeige/Locked-Fallback)
}

export interface PriceError {
  partNo: string;
  colorId: number;
  itemType: string;
  condition: string;
  error: string;
  status: number;
}

export async function computeExternalPrice(
  userId: number,
  req: PriceRequest,
): Promise<PriceResponse | PriceError> {
  const { partNo, colorId, itemType, condition: newOrUsed } = req;
  // Completeness nur bei SET; wenn nicht mitgeschickt → default 'C'
  const effectiveCompleteness = itemType === "SET"
    ? (req.completeness === "C" || req.completeness === "I" || req.completeness === "S" ? req.completeness : "C")
    : null;

  let part = await prisma.part.findUnique({
    where: { partNo_colorId_itemType: { partNo, colorId, itemType } },
  });
  const wasCreated = !part;
  let freshlyCrawled = false;

  if (!part) {
    part = await prisma.part.create({ data: { partNo, colorId, itemType } });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { freshDays: true, pricingFormulas: true },
  });
  const freshDays = user?.freshDays ?? 14;
  const freshThreshold = new Date(Date.now() - freshDays * 86400000);

  const soldTs = newOrUsed === "N" ? part.lastSoldCrawlN : part.lastSoldCrawlU;
  const stockTs = newOrUsed === "N" ? part.lastStockCrawlN : part.lastStockCrawlU;
  const isStale = !soldTs || !stockTs || soldTs < freshThreshold || stockTs < freshThreshold;

  if (isStale) {
    const apiKey = await prisma.userApiKey.findFirst({
      where: { userId, isValid: true },
      orderBy: { createdAt: "desc" },
    });
    if (!apiKey) {
      return { partNo, colorId, itemType, condition: newOrUsed, error: "No valid API key", status: 503 };
    }
    const used = await getUsage(apiKey.id);
    const externalCalls = await getExternalCallCount(userId);
    const remaining = apiKey.dailyLimit - used - externalCalls;
    if (remaining < 2) {
      return { partNo, colorId, itemType, condition: newOrUsed, error: "API daily limit exhausted", status: 429 };
    }
    try {
      // Stock-country-Filter aus User-Settings ziehen -- damit BL Server-seitig
      // auf DE-Stores filtert (Stock hat keinen per-Entry country).
      const { sellerCountries: scForFetch } = await getCountryFilters(userId);
      await fetchPriceData(part, newOrUsed, apiKey.id, {
        stockCountryCodes: scForFetch ?? undefined,
      });
      freshlyCrawled = true;
      part = await prisma.part.findUnique({
        where: { partNo_colorId_itemType: { partNo, colorId, itemType } },
      });
      if (!part) throw new Error("Part disappeared after fetch");
    } catch (err) {
      if (wasCreated && part) {
        await prisma.part.delete({ where: { id: part.id } }).catch(() => {});
      }
      return {
        partNo, colorId, itemType, condition: newOrUsed,
        error: err instanceof Error ? err.message : "BL fetch failed",
        status: 502,
      };
    }
  }

  const { shippingCountries, sellerCountries } = await getCountryFilters(userId);
  const params: unknown[] = [part.id, newOrUsed];
  let p = 3;
  let soldCf = "";
  if (shippingCountries) { soldCf += ` AND s.buyer_country = ANY($${p++})`; params.push(shippingCountries); }
  if (sellerCountries)   { soldCf += ` AND s.seller_country = ANY($${p++})`; params.push(sellerCountries); }
  // completeness (nur bei SET) — beide Filter-Clauses brauchen es
  let comprPlaceholderSold = "";
  let comprPlaceholderStock = "";
  if (effectiveCompleteness) {
    const idx = p++;
    comprPlaceholderSold = ` AND s.completeness = $${idx}`;
    comprPlaceholderStock = ` AND st.completeness = $${idx}`;
    params.push(effectiveCompleteness);
  } else {
    comprPlaceholderSold = ` AND s.completeness IS NULL`;
    comprPlaceholderStock = ` AND st.completeness IS NULL`;
  }
  const stockCf = sellerCountries ? ` AND st.seller_country = ANY($${p})` : "";
  if (sellerCountries)   { params.push(sellerCountries); }

  const stats = await prisma.$queryRawUnsafe<Array<{
    sold_median: number | null; sold_avg: number | null;
    stock_median: number | null; stock_avg: number | null;
    stock_min: number | null; stock_max: number | null;
    stock_count: number; stock_qty: number;
  }>>(
    `WITH latest_stock AS (
      SELECT st.unit_price, st.quantity FROM price_stock st
      WHERE st.part_id = $1 AND st.new_or_used = $2 ${comprPlaceholderStock} ${stockCf}
        AND st.fetched_at = (SELECT MAX(fetched_at) FROM price_stock WHERE part_id = $1 AND new_or_used = $2)
    )
    SELECT
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.unit_price)::float
       FROM price_sales s WHERE s.part_id = $1 AND s.new_or_used = $2
         AND s.date_ordered >= NOW() - INTERVAL '6 months' ${comprPlaceholderSold} ${soldCf}) AS sold_median,
      (SELECT (SUM(s.unit_price * s.quantity) / NULLIF(SUM(s.quantity), 0))::float
       FROM price_sales s WHERE s.part_id = $1 AND s.new_or_used = $2
         AND s.date_ordered >= NOW() - INTERVAL '6 months' ${comprPlaceholderSold} ${soldCf}) AS sold_avg,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price)::float FROM latest_stock) AS stock_median,
      (SELECT (SUM(unit_price * quantity) / NULLIF(SUM(quantity), 0))::float FROM latest_stock) AS stock_avg,
      (SELECT MIN(unit_price)::float FROM latest_stock) AS stock_min,
      (SELECT MAX(unit_price)::float FROM latest_stock) AS stock_max,
      (SELECT COUNT(*)::int FROM latest_stock) AS stock_count,
      (SELECT COALESCE(SUM(quantity), 0)::int FROM latest_stock) AS stock_qty`,
    ...params,
  );
  const s = stats[0];

  let pricingRules: PricingRule[] = [];
  if (user?.pricingFormulas) {
    try { pricingRules = JSON.parse(user.pricingFormulas); } catch { /* ignore */ }
  }

  let suggestedPrice: number | null = null;
  let ruleName: string | null = null;
  if (pricingRules.length > 0) {
    const rule = findMatchingRule(pricingRules, {
      itemType, condition: newOrUsed, colorId, categoryId: part.categoryId ?? null,
      completeness: effectiveCompleteness,
    });
    if (rule) {
      const vars: PricingVars = {
        sold6mMedian: s.sold_median ?? 0, sold6mAvg: s.sold_avg ?? 0,
        soldMedian: s.sold_median ?? 0, soldAvg: s.sold_avg ?? 0,
        stockMedian: s.stock_median ?? 0, stockAvg: s.stock_avg ?? 0,
        stockMin: s.stock_min ?? 0, stockMax: s.stock_max ?? 0,
        stockCount: s.stock_count, stockQty: s.stock_qty,
        myPrice: 0, myQty: 0, myCost: 0,
        sold7dMedian: 0, sold30dMedian: 0, sold60dMedian: 0, sold90dMedian: 0,
        sold7dAvg: 0, sold30dAvg: 0, sold60dAvg: 0, sold90dAvg: 0,
        sold6mMin: 0, sold6mMax: 0, sold30dCount: 0, sold90dCount: 0, sold6mCount: 0,
        sold30dQty: 0, sold90dQty: 0, sold6mQty: 0,
      };
      suggestedPrice = evaluateFormula(rule.formula, vars);
      if (suggestedPrice) suggestedPrice = Math.round(suggestedPrice * 1000) / 1000;
      ruleName = rule.name;
    }
  }

  // Lot-Match falls blInventoryId im Request: lookup user_watchlists fuer
  // saleRate/priceLocked/myPrice damit die BrickStore-Extension den Rabatt
  // und Lock-Zustand zurueckspielen kann. Zusaetzlich: der gecachte
  // suggestedPrice aus user_watchlists ist korrekter als der LIVE-berechnete
  // (LIVE setzt sold7d/30d/60d/90dMedian hardcoded auf 0 -- Formeln die
  // diese Variablen nutzen bekommen sonst 0 oder unter-realistische Werte).
  // Der Cache wird von recomputeLotPricing(...) mit ALLEN Zeit-Buckets
  // korrekt gefuellt. Deshalb bei Lot-Match den Cache-Wert bevorzugen.
  let lotFields = {
    blInventoryId: null as number | null,
    saleRate: null as number | null,
    priceLocked: null as boolean | null,
    myPrice: null as number | null,
  };
  if (req.blInventoryId) {
    const lot = await prisma.userWatchlist.findUnique({
      where: { userId_blInventoryId: { userId, blInventoryId: req.blInventoryId } },
      select: {
        blInventoryId: true, saleRate: true, priceLocked: true, myPrice: true,
        suggestedPrice: true, suggestedRuleName: true,
      },
    });
    if (lot) {
      lotFields = {
        blInventoryId: lot.blInventoryId,
        saleRate: lot.saleRate ?? 0,
        priceLocked: lot.priceLocked ?? false,
        myPrice: lot.myPrice !== null ? Number(lot.myPrice) : null,
      };
      // Cache-Preis bevorzugen falls vorhanden (die LIVE-Berechnung oben ist
      // fuer Formeln mit Zeit-Bucket-Variablen unzuverlaessig -- siehe Kommentar)
      if (lot.suggestedPrice !== null) {
        suggestedPrice = Number(lot.suggestedPrice);
        if (lot.suggestedRuleName) ruleName = lot.suggestedRuleName;
      }
    }
  }

  return {
    partNo, colorId, itemType, condition: newOrUsed,
    completeness: effectiveCompleteness,
    suggestedPrice,
    rule: ruleName,
    stockMedian: s.stock_median,
    stockAvg: s.stock_avg,
    stockMin: s.stock_min,
    stockMax: s.stock_max,
    stockOffers: s.stock_count,
    soldMedian: s.sold_median,
    soldAvg: s.sold_avg,
    lastSoldFetch: newOrUsed === "N" ? part.lastSoldCrawlN : part.lastSoldCrawlU,
    lastStockFetch: newOrUsed === "N" ? part.lastStockCrawlN : part.lastStockCrawlU,
    freshlyCrawled,
    ...lotFields,
  };
}

export function isPriceError(r: PriceResponse | PriceError): r is PriceError {
  return "error" in r;
}

export async function authenticateBearer(request: Request): Promise<{ userId: number; tokenId: number } | null> {
  const authHeader = request.headers.get("authorization") || "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const tokenRow = await prisma.externalToken.findUnique({
    where: { token: m[1] },
    select: { id: true, userId: true },
  });
  if (!tokenRow) return null;
  prisma.externalToken.update({ where: { id: tokenRow.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { userId: tokenRow.userId, tokenId: tokenRow.id };
}

/**
 * Rate-Limit-Check für externe API-Endpoints. Aufrufen NACH authenticateBearer.
 * Returned NextResponse (429) wenn Limit überschritten — Endpoint muss die
 * dann direkt returnen. Bei null: Limit OK, weitermachen.
 *
 * Zwei Buckets:
 *   ext:token:<id>   120 req / 60s   → Basis-Throttle pro Token
 *   ext:token:<id>:min 20 req / 5s   → Burst-Schutz gegen Batch-Loops
 */
export async function enforceExternalRateLimit(tokenId: number): Promise<Response | null> {
  const { rateLimit } = await import("./rate-limit");
  const [minBucket, burstBucket] = await Promise.all([
    rateLimit(`ext:token:${tokenId}`, 120, 60),
    rateLimit(`ext:token:${tokenId}:burst`, 20, 5),
  ]);
  if (!minBucket.ok || !burstBucket.ok) {
    const worst = !burstBucket.ok ? burstBucket : minBucket;
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        retryAfterSec: worst.resetSec,
        limits: { perMinute: 120, burst5s: 20 },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(worst.resetSec),
        },
      },
    );
  }
  return null;
}

export function validateRequest(item: {
  partNo?: unknown; colorId?: unknown; itemType?: unknown; condition?: unknown;
  completeness?: unknown; blInventoryId?: unknown;
}): { ok: true; req: PriceRequest } | { ok: false; error: string } {
  const partNo = typeof item.partNo === "string" ? item.partNo.trim() : "";
  const colorId = typeof item.colorId === "number" ? item.colorId : parseInt(String(item.colorId));
  const itemType = typeof item.itemType === "string" ? item.itemType.toUpperCase() : "";
  const condition = typeof item.condition === "string" ? item.condition.toUpperCase() : "";
  const completeness = typeof item.completeness === "string" ? item.completeness.toUpperCase() : "";
  if (!partNo) return { ok: false, error: "partNo required" };
  if (!Number.isFinite(colorId)) return { ok: false, error: "colorId must be number" };
  if (!["PART", "MINIFIG", "SET"].includes(itemType)) return { ok: false, error: "itemType must be PART|MINIFIG|SET" };
  if (!["N", "U"].includes(condition)) return { ok: false, error: "condition must be N|U" };
  if (completeness && !["C", "I", "S"].includes(completeness)) {
    return { ok: false, error: "completeness must be C|I|S if provided" };
  }
  const req: PriceRequest = {
    partNo, colorId,
    itemType: itemType as PriceRequest["itemType"],
    condition: condition as "N" | "U",
  };
  if (itemType === "SET" && completeness) {
    req.completeness = completeness as "C" | "I" | "S";
  }
  if (item.blInventoryId !== undefined && item.blInventoryId !== null) {
    const bi = typeof item.blInventoryId === "number" ? item.blInventoryId : parseInt(String(item.blInventoryId));
    if (!Number.isFinite(bi) || bi <= 0) {
      return { ok: false, error: "blInventoryId must be a positive number if provided" };
    }
    req.blInventoryId = bi;
  }
  return { ok: true, req };
}
