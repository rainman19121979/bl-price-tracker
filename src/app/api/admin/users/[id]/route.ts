import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) return null;
  return { session, userId: parseInt(session.user.id) };
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const targetId = parseInt(params.id);
  if (!Number.isFinite(targetId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { isAdmin?: boolean; isActive?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Don't let an admin lock/de-admin themselves — must be done by another admin
  if (targetId === admin.userId) {
    return NextResponse.json({ error: "Eigenen Account nicht ändern" }, { status: 400 });
  }

  const data: { isAdmin?: boolean; isActive?: boolean } = {};
  if (typeof body.isAdmin === "boolean") data.isAdmin = body.isAdmin;
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  const updated = await prisma.user.update({
    where: { id: targetId },
    data,
    select: { id: true, email: true, username: true, isAdmin: true, isActive: true },
  });
  return NextResponse.json({ user: updated });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const targetId = parseInt(params.id);
  if (!Number.isFinite(targetId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  if (targetId === admin.userId) {
    return NextResponse.json({ error: "Eigenen Account nicht löschen" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.userWatchlist.deleteMany({ where: { userId: targetId } }),
    prisma.userApiKey.deleteMany({ where: { userId: targetId } }),
    prisma.crawlQueue.deleteMany({ where: { userId: targetId } }),
    prisma.user.delete({ where: { id: targetId } }),
  ]);
  return NextResponse.json({ ok: true });
}
