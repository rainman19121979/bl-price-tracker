import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id);

  const tokens = await prisma.externalToken.findMany({
    where: { userId },
    select: { id: true, name: true, token: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    tokens: tokens.map(t => ({
      id: t.id,
      name: t.name,
      tokenPreview: t.token.slice(0, 8) + "…" + t.token.slice(-4),
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id);

  let body: { name?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const token = randomBytes(32).toString("hex");
  const row = await prisma.externalToken.create({
    data: { userId, name, token },
  });

  return NextResponse.json({
    id: row.id,
    name: row.name,
    token: row.token,
    createdAt: row.createdAt,
  });
}
