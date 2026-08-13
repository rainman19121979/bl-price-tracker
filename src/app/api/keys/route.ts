import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { apiKeySchema } from "@/lib/validators";
import { encrypt } from "@/lib/encryption";
import { getUsageByKey } from "@/lib/api-usage";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await prisma.userApiKey.findMany({
    where: { userId: parseInt(session.user.id) },
    select: {
      id: true,
      consumerKey: true,
      dailyLimit: true,
      externalCalls: true,
      isValid: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const usageMap = await getUsageByKey(keys.map(k => k.id));
  const keysWithUsage = keys.map(k => ({
    ...k,
    requestsToday: usageMap.get(k.id) ?? 0,
  }));

  return NextResponse.json({ keys: keysWithUsage });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = apiKeySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const consumerKey = result.data.consumerKey.trim();
  const consumerSecret = result.data.consumerSecret.trim();
  const tokenValue = result.data.tokenValue.trim();
  const tokenSecret = result.data.tokenSecret.trim();

  const consumerSecretEnc = encrypt(consumerSecret);
  const tokenSecretEnc = encrypt(tokenSecret);

  // Seed BrickSync as an external caller by default (5-min poll → ~288 calls/day).
  // Users can edit or remove it in the UI. This matches the common BrickSync setup.
  const defaultExternalCalls = JSON.stringify([{ name: "BrickSync", interval: 300 }]);

  const apiKey = await prisma.userApiKey.create({
    data: {
      userId: parseInt(session.user.id),
      consumerKey,
      consumerSecretEnc,
      tokenValue,
      tokenSecretEnc,
      externalCalls: defaultExternalCalls,
    },
    select: {
      id: true,
      consumerKey: true,
      dailyLimit: true,
      externalCalls: true,
      isValid: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ key: { ...apiKey, requestsToday: 0 } }, { status: 201 });
}
