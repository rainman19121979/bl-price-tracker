import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isRegistrationOpen, setRegistrationOpen } from "@/lib/app-settings";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [registrationOpen, userCount, activeUsers] = await Promise.all([
    isRegistrationOpen(),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
  ]);

  return NextResponse.json({ registrationOpen, userCount, activeUsers });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { registrationOpen?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.registrationOpen === "boolean") {
    await setRegistrationOpen(body.registrationOpen);
  }

  return NextResponse.json({
    registrationOpen: await isRegistrationOpen(),
  });
}
