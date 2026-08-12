import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateFormula, type PricingRule } from "@/lib/pricing-engine";

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
      pricingFormulas: true, shippingCountries: true, bsxOrdersDir: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let pricingFormulas: PricingRule[] = [];
  if (user.pricingFormulas) {
    try { pricingFormulas = JSON.parse(user.pricingFormulas); } catch { /* ignore */ }
  }

  const countries = await prisma.$queryRaw<{ buyer_country: string; sales: number }[]>`
    SELECT buyer_country, COUNT(*)::int as sales
    FROM price_sales
    WHERE buyer_country IS NOT NULL
    GROUP BY buyer_country
    ORDER BY sales DESC
  `;

  return NextResponse.json({
    autoSyncInventory: user.autoSyncInventory,
    crawlerEnabled: user.crawlerEnabled,
    freshDays: user.freshDays,
    pricingFormulas,
    shippingCountries: user.shippingCountries ? user.shippingCountries.split(",") : null,
    availableCountries: countries.map((c) => ({
      code: c.buyer_country,
      sales: c.sales,
    })),
    bsxOrdersDir: user.bsxOrdersDir,
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
    bsxOrdersDir?: string | null;
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
    bsxOrdersDir?: string | null;
  } = {};

  if (typeof body.autoSyncInventory === "boolean") {
    data.autoSyncInventory = body.autoSyncInventory;
  }
  if (typeof body.crawlerEnabled === "boolean") {
    data.crawlerEnabled = body.crawlerEnabled;
  }
  if (typeof body.freshDays === "number" && body.freshDays >= 1 && body.freshDays <= 90) {
    data.freshDays = Math.round(body.freshDays);
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

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      autoSyncInventory: true, crawlerEnabled: true, freshDays: true,
      pricingFormulas: true, shippingCountries: true, bsxOrdersDir: true,
    },
  });

  if (body.pricingFormulas !== undefined || body.shippingCountries !== undefined) {
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
    bsxOrdersDir: updated.bsxOrdersDir,
  });
}
