import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateFormula, type PricingRule } from "@/lib/pricing-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      autoSyncInventory: true, crawlerEnabled: true, freshDays: true,
      pricingFormulas: true, shippingCountries: true, sellerCountries: true,
      bsxOrdersDir: true, bsxSourceType: true,
      bsxSmbHost: true, bsxSmbShare: true, bsxSmbSubpath: true,
      bsxSmbDomain: true, bsxSmbUser: true, bsxSmbPasswordEnc: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let pricingFormulas: PricingRule[] = [];
  if (user.pricingFormulas) {
    try { pricingFormulas = JSON.parse(user.pricingFormulas); } catch { /* ignore */ }
  }

  const [buyerCountries, sellerCountriesAgg] = await Promise.all([
    prisma.$queryRaw<{ buyer_country: string; sales: number }[]>`
      SELECT buyer_country, COUNT(*)::int as sales
      FROM price_sales
      WHERE buyer_country IS NOT NULL
      GROUP BY buyer_country
      ORDER BY sales DESC
    `,
    prisma.$queryRaw<{ seller_country: string; sales: number }[]>`
      SELECT seller_country, COUNT(*)::int as sales
      FROM price_sales
      WHERE seller_country IS NOT NULL AND seller_country != 'XX'
      GROUP BY seller_country
      ORDER BY sales DESC
    `,
  ]);

  // Fallback-Laenderliste falls DB noch leer ist (frischer Install ohne
  // Marktdaten). Sonst waeren die Country-Filter-Dropdowns leer und der
  // User haette keine Chance seinen Verkaeufer/Kaeufer-Filter zu setzen
  // vor dem ersten Crawl. Liste = die ~30 aktivsten BL-Marktlaender.
  const DEFAULT_BL_COUNTRIES = [
    "DE", "US", "GB", "FR", "IT", "ES", "NL", "BE", "AT", "CH",
    "PL", "CZ", "DK", "SE", "FI", "NO", "IE", "PT", "GR", "HU",
    "LU", "CA", "AU", "NZ", "JP", "KR", "SG", "HK", "IL", "BR",
  ];
  const mergeCountries = <T extends { code: string; sales: number }>(agg: T[]): T[] => {
    const existing = new Set(agg.map(c => c.code));
    const merged: T[] = [...agg];
    for (const code of DEFAULT_BL_COUNTRIES) {
      if (!existing.has(code)) {
        merged.push({ code, sales: 0 } as T);
      }
    }
    return merged;
  };

  return NextResponse.json({
    autoSyncInventory: user.autoSyncInventory,
    crawlerEnabled: user.crawlerEnabled,
    freshDays: user.freshDays,
    pricingFormulas,
    shippingCountries: user.shippingCountries ? user.shippingCountries.split(",") : null,
    sellerCountries: user.sellerCountries ? user.sellerCountries.split(",") : null,
    availableCountries: mergeCountries(buyerCountries.map((c) => ({
      code: c.buyer_country,
      sales: c.sales,
    }))),
    availableSellerCountries: mergeCountries(sellerCountriesAgg.map((c) => ({
      code: c.seller_country,
      sales: c.sales,
    }))),
    bsxOrdersDir: user.bsxOrdersDir,
    bsxSource: {
      type: user.bsxSourceType,
      smbHost: user.bsxSmbHost,
      smbShare: user.bsxSmbShare,
      smbSubpath: user.bsxSmbSubpath,
      smbDomain: user.bsxSmbDomain,
      smbUser: user.bsxSmbUser,
      smbPasswordSet: !!user.bsxSmbPasswordEnc,
    },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  let body: {
    autoSyncInventory?: boolean;
    crawlerEnabled?: boolean;
    freshDays?: number;
    pricingFormulas?: PricingRule[];
    shippingCountries?: string[] | null;
    sellerCountries?: string[] | null;
    bsxOrdersDir?: string | null;
    bsxSource?: {
      type?: "local" | "smb";
      smbHost?: string | null;
      smbShare?: string | null;
      smbSubpath?: string | null;
      smbDomain?: string | null;
      smbUser?: string | null;
      smbPassword?: string | null;  // null = keep existing, "" = clear, string = new
    } | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: {
    autoSyncInventory?: boolean;
    crawlerEnabled?: boolean;
    freshDays?: number;
    pricingFormulas?: string | null;
    shippingCountries?: string | null;
    sellerCountries?: string | null;
    bsxOrdersDir?: string | null;
    bsxSourceType?: string;
    bsxSmbHost?: string | null;
    bsxSmbShare?: string | null;
    bsxSmbSubpath?: string | null;
    bsxSmbDomain?: string | null;
    bsxSmbUser?: string | null;
    bsxSmbPasswordEnc?: Buffer | null;
  } = {};

  if (typeof body.autoSyncInventory === "boolean") {
    data.autoSyncInventory = body.autoSyncInventory;
  }
  if (typeof body.crawlerEnabled === "boolean") {
    data.crawlerEnabled = body.crawlerEnabled;
  }
  if (typeof body.freshDays === "number") {
    const days = Math.round(body.freshDays);
    if (days < 30 || days > 365) {
      return NextResponse.json({ error: "freshDays muss zwischen 30 und 365 Tagen liegen" }, { status: 400 });
    }
    // Block if the maintenance cadence would exceed the user's total daily API limit.
    const [watchlistCount, apiKeys] = await Promise.all([
      prisma.userWatchlist.count({ where: { userId } }),
      prisma.userApiKey.findMany({ where: { userId, isValid: true }, select: { dailyLimit: true } }),
    ]);
    const totalLimit = apiKeys.reduce((s, k) => s + k.dailyLimit, 0);
    const requiredPerDay = Math.ceil((watchlistCount * 2) / days);
    if (totalLimit > 0 && requiredPerDay > totalLimit) {
      return NextResponse.json({
        error: `Nicht möglich: ${watchlistCount} Lots × 2 Calls / ${days} Tage = ~${requiredPerDay} Calls/Tag benötigt, dein Limit ist ${totalLimit}. Wähle einen längeren Zeitraum oder erhöhe das API-Limit.`,
        requiredPerDay,
        totalLimit,
      }, { status: 400 });
    }
    data.freshDays = days;
  }
  if (body.pricingFormulas !== undefined) {
    if (Array.isArray(body.pricingFormulas)) {
      if (body.pricingFormulas.length > 50) {
        return NextResponse.json({ error: "Maximal 50 Preisformeln" }, { status: 400 });
      }
      for (const rule of body.pricingFormulas) {
        if (typeof rule?.name !== "string" || rule.name.length > 100) {
          return NextResponse.json({ error: "Formel-Name fehlt oder zu lang (max 100)" }, { status: 400 });
        }
        if (typeof rule?.formula !== "string" || rule.formula.length > 500) {
          return NextResponse.json({ error: `Formel "${rule.name}" zu lang (max 500 Zeichen)` }, { status: 400 });
        }
        const result = validateFormula(rule.formula);
        if (!result.valid) {
          return NextResponse.json(
            { error: `Formel "${rule.name}": ${result.error}` },
            { status: 400 }
          );
        }
      }
      data.pricingFormulas = body.pricingFormulas.length > 0 ? JSON.stringify(body.pricingFormulas) : null;
    } else {
      data.pricingFormulas = null;
    }
  }
  if (body.shippingCountries !== undefined) {
    if (body.shippingCountries === null) {
      data.shippingCountries = null;
    } else if (Array.isArray(body.shippingCountries)) {
      if (body.shippingCountries.length > 50) {
        return NextResponse.json({ error: "Maximal 50 Länder" }, { status: 400 });
      }
      const cleaned: string[] = [];
      for (const c of body.shippingCountries) {
        if (typeof c !== "string" || !/^[A-Z]{2}$/.test(c.trim().toUpperCase())) {
          return NextResponse.json({ error: `Ungültiger Ländercode: ${c}` }, { status: 400 });
        }
        cleaned.push(c.trim().toUpperCase());
      }
      data.shippingCountries = cleaned.length > 0 ? cleaned.join(",") : null;
    }
  }
  if (body.sellerCountries !== undefined) {
    if (body.sellerCountries === null) {
      data.sellerCountries = null;
    } else if (Array.isArray(body.sellerCountries)) {
      if (body.sellerCountries.length > 50) {
        return NextResponse.json({ error: "Maximal 50 Verkäufer-Länder" }, { status: 400 });
      }
      const cleaned: string[] = [];
      for (const c of body.sellerCountries) {
        if (typeof c !== "string" || !/^[A-Z]{2}$/.test(c.trim().toUpperCase())) {
          return NextResponse.json({ error: `Ungültiger Verkäufer-Ländercode: ${c}` }, { status: 400 });
        }
        cleaned.push(c.trim().toUpperCase());
      }
      data.sellerCountries = cleaned.length > 0 ? cleaned.join(",") : null;
    }
  }
  if (body.bsxOrdersDir !== undefined) {
    // Free-form path — restricted to admins because the scheduler + import routes
    // grant read access to any location the process can reach. Non-admins can't
    // change the field at all.
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
    if (!me?.isAdmin) {
      return NextResponse.json({ error: "Nur Admin darf BSX-Ordner setzen" }, { status: 403 });
    }
    const trimmed = typeof body.bsxOrdersDir === "string" ? body.bsxOrdersDir.trim() : "";
    data.bsxOrdersDir = trimmed.length > 0 ? trimmed : null;
  }
  if (body.bsxSource !== undefined) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
    if (!me?.isAdmin) {
      return NextResponse.json({ error: "Nur Admin darf BSX-Quelle setzen" }, { status: 403 });
    }
    const s = body.bsxSource;
    const type = s?.type === "smb" ? "smb" : "local";
    data.bsxSourceType = type;
    if (type === "smb") {
      const host = (s?.smbHost || "").trim();
      const share = (s?.smbShare || "").trim();
      const user = (s?.smbUser || "").trim();
      if (!host || !share || !user) {
        return NextResponse.json({ error: "SMB benötigt host, share und user" }, { status: 400 });
      }
      data.bsxSmbHost = host;
      data.bsxSmbShare = share;
      data.bsxSmbSubpath = (s?.smbSubpath || "").trim() || null;
      data.bsxSmbDomain = (s?.smbDomain || "").trim() || null;
      data.bsxSmbUser = user;
      // Password handling: undefined/null → keep, "" → clear, other → encrypt
      if (s?.smbPassword === undefined || s?.smbPassword === null) {
        // keep existing — don't set field
      } else if (s.smbPassword === "") {
        data.bsxSmbPasswordEnc = null;
      } else {
        const { encrypt } = await import("@/lib/encryption");
        data.bsxSmbPasswordEnc = encrypt(s.smbPassword);
      }
    }
    // For type="local" we DON'T wipe the SMB fields — user might toggle back
    // to SMB later without re-entering everything. Only the type field decides
    // which fields the loader reads.
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      autoSyncInventory: true, crawlerEnabled: true, freshDays: true,
      pricingFormulas: true, shippingCountries: true, sellerCountries: true,
      bsxOrdersDir: true, bsxSourceType: true,
      bsxSmbHost: true, bsxSmbShare: true, bsxSmbSubpath: true,
      bsxSmbDomain: true, bsxSmbUser: true, bsxSmbPasswordEnc: true,
    },
  });

  if (
    body.pricingFormulas !== undefined ||
    body.shippingCountries !== undefined ||
    body.sellerCountries !== undefined
  ) {
    try {
      const { recomputeAllLotsForUser } = await import("@/lib/lot-pricing");
      await recomputeAllLotsForUser(userId);
    } catch (err) {
      console.error("[settings PUT] Recompute-Fehler:", err instanceof Error ? err.message : err);
    }
  }

  let updatedFormulas: PricingRule[] = [];
  if (updated.pricingFormulas) {
    try { updatedFormulas = JSON.parse(updated.pricingFormulas); } catch { /* ignore */ }
  }

  return NextResponse.json({
    autoSyncInventory: updated.autoSyncInventory,
    crawlerEnabled: updated.crawlerEnabled,
    freshDays: updated.freshDays,
    pricingFormulas: updatedFormulas,
    shippingCountries: updated.shippingCountries ? updated.shippingCountries.split(",") : null,
    sellerCountries: updated.sellerCountries ? updated.sellerCountries.split(",") : null,
    bsxOrdersDir: updated.bsxOrdersDir,
    bsxSource: {
      type: updated.bsxSourceType,
      smbHost: updated.bsxSmbHost,
      smbShare: updated.bsxSmbShare,
      smbSubpath: updated.bsxSmbSubpath,
      smbDomain: updated.bsxSmbDomain,
      smbUser: updated.bsxSmbUser,
      smbPasswordSet: !!updated.bsxSmbPasswordEnc,
    },
  });
}
