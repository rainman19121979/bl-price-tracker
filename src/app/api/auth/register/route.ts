import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { isRegistrationOpen } from "@/lib/app-settings";
import { registerSchema } from "@/lib/validators";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 register attempts per IP per hour
    const rl = await rateLimit(`auth:register:${clientIp(request)}`, 5, 3600);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Zu viele Registrierungs-Versuche. Warte ${rl.resetSec}s.` },
        { status: 429 }
      );
    }

    // Setup mode: first-ever user is always allowed and becomes admin
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;

    if (!isFirstUser) {
      const open = await isRegistrationOpen();
      if (!open) {
        return NextResponse.json(
          { error: "Registrierung ist derzeit geschlossen." },
          { status: 403 }
        );
      }
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      return NextResponse.json(
        { error: firstError.message },
        { status: 400 }
      );
    }

    const { email, username, password } = parsed.data;

    // Check for existing email or username
    const existingEmail = await prisma.user.findUnique({
      where: { email },
    });
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });
    if (existingEmail || existingUsername) {
      return NextResponse.json(
        { error: "Registrierung fehlgeschlagen. Bitte versuche andere Zugangsdaten." },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user — first user gets admin + crawler enabled by default
    await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        isAdmin: isFirstUser,
        crawlerEnabled: isFirstUser,
      },
    });

    return NextResponse.json(
      {
        message: isFirstUser
          ? "Admin-Konto erstellt. Bitte anmelden."
          : "Konto erfolgreich erstellt.",
        isFirstUser,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler. Bitte versuche es spaeter erneut." },
      { status: 500 }
    );
  }
}
