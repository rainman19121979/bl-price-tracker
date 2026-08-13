import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      username: true,
      isAdmin: true,
      isActive: true,
      createdAt: true,
      lastLogin: true,
      _count: { select: { watchlists: true, apiKeys: true } },
    },
  });

  return NextResponse.json({ users });
}
