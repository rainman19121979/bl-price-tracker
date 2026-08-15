import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/validators";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Bootstrap-only: diese Route ist nur aktiv SOLANGE die DB null User hat.
 * Danach 404 — Selbst-Registrierung ist dauerhaft dicht (BL API TOS).
 * Der erste erfolgreiche Register-Call legt den Admin-Account an.
 */
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

    // Bootstrap-Gate: sobald ein User existiert, ist die Route tot.
    // Check ausserhalb der Transaktion — der finale Race-safe Check
    // steht drinnen mit Advisory-Lock.
    if (await prisma.user.count() > 0) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
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

    // Hash password AUSSERHALB der Transaktion (bcrypt ist teuer, blockiert
    // sonst DB-Locks unnötig lange)
    const passwordHash = await bcrypt.hash(password, 12);

    // Ganze Registrierung in einer Serializable-Transaktion + Postgres-
    // Advisory-Lock (arbitrary 4711). Verhindert dass zwei parallele
    // First-User-Registrierungen beide Admin werden. Race-safe re-check
    // von userCount innerhalb der Transaktion.
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(4711)`;

        const userCount = await tx.user.count();
        if (userCount > 0) {
          // Ein anderer Request hat waehrend wir gewartet haben den ersten
          // User angelegt — wir sind aus dem Bootstrap raus.
          throw new Error("BOOTSTRAP_CLOSED");
        }

        const [existingEmail, existingUsername] = await Promise.all([
          tx.user.findUnique({ where: { email } }),
          tx.user.findUnique({ where: { username } }),
        ]);
        if (existingEmail || existingUsername) {
          throw new Error("DUPLICATE_CREDENTIALS");
        }

        await tx.user.create({
          data: {
            email,
            username,
            passwordHash,
            isAdmin: true,
            crawlerEnabled: true,
          },
        });
      }, { isolationLevel: "Serializable" });

      return NextResponse.json(
        {
          message: "Admin-Konto erstellt. Bitte anmelden.",
          isFirstUser: true,
        },
        { status: 201 }
      );
    } catch (txError) {
      const msg = txError instanceof Error ? txError.message : String(txError);
      if (msg === "BOOTSTRAP_CLOSED") {
        return NextResponse.json({ error: "Not Found" }, { status: 404 });
      }
      if (msg === "DUPLICATE_CREDENTIALS") {
        return NextResponse.json(
          { error: "Registrierung fehlgeschlagen. Bitte versuche andere Zugangsdaten." },
          { status: 400 }
        );
      }
      throw txError;
    }
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler. Bitte versuche es spaeter erneut." },
      { status: 500 }
    );
  }
}
