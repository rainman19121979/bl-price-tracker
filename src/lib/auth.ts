import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

// NOTE: rate-limit uses ioredis and can't live in the Edge-Runtime middleware
// bundle. We import it dynamically inside authorize() (which runs in the Node
// runtime), so the Edge bundle stays clean.

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Self-hosted: der User erreicht die App potentiell über Tailscale-IP,
  // eigene Domain, LAN-IP oder localhost — nicht immer identisch mit
  // NEXTAUTH_URL. next-auth v5 blockt sonst mit "UntrustedHost".
  // Sicher weil wir hinter Tailscale/Caddy/LAN sitzen, kein öffentlicher
  // Multi-Tenant-Service.
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Rate-limit: two counters (both silent-fail on redis down).
        //   auth:login:email:<email>  10 attempts / 15 min  → schützt einen Account gegen Passwort-Spray
        //   auth:login:ip:<ip>        30 attempts / 15 min  → schützt vor Bruteforce quer über viele Accounts
        // Wichtig: alle Auth-Versuche (auch die erfolgreichen) verbrauchen einen Slot,
        // 10/15 min ist locker genug für einen normalen User der sich mal vertippt hat.
        try {
          const { rateLimit, clientIp } = await import("./rate-limit");
          const emailBucket = await rateLimit(`auth:login:email:${email.toLowerCase()}`, 10, 900);
          if (!emailBucket.ok) return null;
          const ip = request ? clientIp(request as Request) : "unknown";
          if (ip !== "unknown") {
            const ipBucket = await rateLimit(`auth:login:ip:${ip}`, 30, 900);
            if (!ipBucket.ok) return null;
          }
        } catch { /* redis down → login zulassen, lieber Verfügbarkeit als hart abwürgen */ }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.isActive) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: String(user.id),
          email: user.email,
          name: user.username,
          isAdmin: user.isAdmin,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.isAdmin = user.isAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.isAdmin = token.isAdmin;

        // Verifiziere dass der User in der DB noch existiert (schützt vor
        // Zombie-Sessions auf frisch resetteten DBs bzw. gelöschten Accounts).
        // JWT-Sessions sind self-signed — ohne diesen Check würde ein alter
        // Cookie auf einer leeren DB als "eingeloggt" gelten.
        try {
          const { prisma } = await import("./db");
          const id = parseInt(token.id as string, 10);
          if (Number.isFinite(id)) {
            const exists = await prisma.user.findUnique({
              where: { id },
              select: { id: true, isActive: true },
            });
            if (!exists || !exists.isActive) {
              // Session unbrauchbar — Middleware wird zu /login redirecten
              return null as unknown as typeof session;
            }
          }
        } catch { /* DB down → lieber Session behalten als hart abwürgen */ }
      }
      return session;
    },
  },
});
