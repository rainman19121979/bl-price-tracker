import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { BrickLinkClient, BrickLinkApiError } from "@/lib/bricklink-api";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 10 test calls per user per 10 min (BL API costs money)
  const rl = await rateLimit(`keys:test:${session.user.id}`, 10, 600);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Zu viele Test-Aufrufe. Warte ${rl.resetSec}s.` },
      { status: 429 }
    );
  }

  const keyId = parseInt(params.id);
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
  }

  const apiKey = await prisma.userApiKey.findFirst({
    where: { id: keyId, userId: parseInt(session.user.id) },
  });

  if (!apiKey) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  let consumerSecret: string;
  let tokenSecret: string;
  try {
    consumerSecret = decrypt(Buffer.from(apiKey.consumerSecretEnc));
    tokenSecret = decrypt(Buffer.from(apiKey.tokenSecretEnc));
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt API key secrets" },
      { status: 500 }
    );
  }

  const client = new BrickLinkClient(
    apiKey.consumerKey,
    consumerSecret,
    apiKey.tokenValue,
    tokenSecret,
    0,
  );

  try {
    // Cheap test call: get price guide for a common part (3001 = 2x4 Brick, White, Used)
    const guide = await client.getPriceGuide("3001", "PART", 1, "U");

    await prisma.userApiKey.update({
      where: { id: keyId },
      data: { isValid: true },
    });

    return NextResponse.json({
      success: true,
      message: "API key is valid",
      testResult: {
        itemNo: "3001",
        colorId: 1,
        avgPrice: guide.data?.avg_price ?? null,
        totalQuantity: guide.data?.total_quantity ?? null,
      },
    });
  } catch (error) {
    await prisma.userApiKey.update({
      where: { id: keyId },
      data: { isValid: false },
    });
    if (error instanceof BrickLinkApiError) {
      return NextResponse.json(
        { success: false, error: error.message, statusCode: error.statusCode },
        { status: 400 }
      );
    }
    console.error("[keys/test] Error:", error);
    return NextResponse.json({ error: "Ein Fehler ist aufgetreten" }, { status: 500 });
  }
}
