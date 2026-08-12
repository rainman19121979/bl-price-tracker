import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, username: true, createdAt: true, lastLogin: true },
  });
  return NextResponse.json({ user });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  // Require password confirmation
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  if (!body.confirmPassword) {
    return NextResponse.json(
      { error: "Passwort-Bestaetigung erforderlich" },
      { status: 400 }
    );
  }

  // Verify password
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const valid = await bcrypt.compare(body.confirmPassword, user.passwordHash);
  if (!valid)
    return NextResponse.json({ error: "Falsches Passwort" }, { status: 403 });

  // Delete all user data (cascades handle most)
  await prisma.$transaction([
    prisma.userWatchlist.deleteMany({ where: { userId } }),
    prisma.userApiKey.deleteMany({ where: { userId } }),
    prisma.crawlQueue.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  // Do NOT log the email — GDPR-erasure means it must not persist anywhere,
  // including journalctl. User ID is enough for audit trail.
  console.log(`[GDPR] User ${userId} account deleted`);

  return NextResponse.json({
    message: "Konto und alle Daten wurden geloescht",
  });
}
