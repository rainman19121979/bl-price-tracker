import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      username: true,
      createdAt: true,
      lastLogin: true,
      autoSyncInventory: true,
      shippingCountries: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const watchlists = await prisma.userWatchlist.findMany({
    where: { userId },
    include: {
      part: {
        select: {
          partNo: true,
          colorId: true,
          itemType: true,
          partName: true,
          colorName: true,
          categoryName: true,
        },
      },
    },
  });

  const apiKeys = await prisma.userApiKey.findMany({
    where: { userId },
    select: {
      id: true,
      platform: true,
      consumerKey: true,
      dailyLimit: true,
      isValid: true,
      createdAt: true,
    },
  });

  const { getUsageByKey } = await import("@/lib/api-usage");
  const usageMap = await getUsageByKey(apiKeys.map(k => k.id));

  const exportData = {
    exportedAt: new Date().toISOString(),
    profile: {
      email: user.email,
      username: user.username,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
    },
    settings: {
      autoSyncInventory: user.autoSyncInventory,
      shippingCountries: user.shippingCountries
        ? user.shippingCountries.split(",")
        : null,
    },
    watchlistEntries: watchlists.map((w) => ({
      part: w.part,
      newOrUsed: w.newOrUsed,
      priority: w.priority,
      myPrice: w.myPrice,
      myQuantity: w.myQuantity,
      description: w.description,
      alertBelow: w.alertBelow,
      alertAbove: w.alertAbove,
      notes: w.notes,
      createdAt: w.createdAt,
    })),
    apiKeys: apiKeys.map((k) => ({
      id: k.id,
      platform: k.platform,
      consumerKey: k.consumerKey,
      dailyLimit: k.dailyLimit,
      requestsLast24h: usageMap.get(k.id) ?? 0,
      isValid: k.isValid,
      createdAt: k.createdAt,
    })),
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="meine-daten.json"',
    },
  });
}
