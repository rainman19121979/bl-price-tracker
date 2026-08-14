import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { isRegistrationOpen } from "@/lib/app-settings";
import { registerSchema } from "@/lib/validators";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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
    // Advisory-Lock (arbitrary 4711). Verhindert:
    //   - Race #1: zwei parallele Registrierungen mit derselben Email/Username
    //   - Race #2: zwei parallele First-User-Registrierungen werden beide Admin
    // Advisory-Lock ist prozess-scoped und serialisiert alle Register-Requests
    // sequenziell — bei einem Register/Sek kein Problem.
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(4711)`;

        const userCount = await tx.user.count();
        const isFirstUser = userCount === 0;

        if (!isFirstUser) {
          const open = await isRegistrationOpen();
          if (!open) {
            throw new Error("REGISTRATION_CLOSED");
          }
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
            isAdmin: isFirstUser,
            crawlerEnabled: isFirstUser,
          },
        });

        return { isFirstUser };
      }, { isolationLevel: "Serializable" });

      return NextResponse.json(
        {
          message: result.isFirstUser
            ? "Admin-Konto erstellt. Bitte anmelden."
            : "Konto erfolgreich erstellt.",
          isFirstUser: result.isFirstUser,
        },
        { status: 201 }
      );
    } catch (txError) {
      const msg = txError instanceof Error ? txError.message : String(txError);
      if (msg === "REGISTRATION_CLOSED") {
        return NextResponse.json(
          { error: "Registrierung ist derzeit geschlossen." },
          { status: 403 }
        );
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
