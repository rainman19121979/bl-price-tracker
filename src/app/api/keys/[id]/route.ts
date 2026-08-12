import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getUsage } from "@/lib/api-usage";

const updateKeySchema = z.object({
  dailyLimit: z
    .number()
    .int()
    .min(1, "Daily limit must be at least 1")
    .max(5000, "Daily limit cannot exceed 5000")
    .optional(),
  externalCalls: z.string().nullable().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keyId = parseInt(params.id);
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = updateKeySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (result.data.dailyLimit !== undefined) updateData.dailyLimit = result.data.dailyLimit;
  if (result.data.externalCalls !== undefined) updateData.externalCalls = result.data.externalCalls;

  const updateResult = await prisma.userApiKey.updateMany({
    where: { id: keyId, userId: parseInt(session.user.id) },
    data: updateData,
  });

  if (updateResult.count === 0) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  const updated = await prisma.userApiKey.findUnique({
    where: { id: keyId },
    select: { id: true, consumerKey: true, dailyLimit: true, externalCalls: true, isValid: true },
  });
  const usage = await getUsage(keyId);
  return NextResponse.json({ key: { ...updated, requestsToday: usage } });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keyId = parseInt(params.id);
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
  }

  const deleteResult = await prisma.userApiKey.deleteMany({
    where: { id: keyId, userId: parseInt(session.user.id) },
  });

  if (deleteResult.count === 0) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  return NextResponse.json({ message: "API key deleted" });
}
