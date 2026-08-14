import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

// NOTE: no rate-limit import here. auth.ts is pulled into the Edge-Runtime
// middleware bundle, and ioredis / redis-errors can't run in Edge.
// Login rate-limit is enforced instead in a route-level wrapper for the
// signin API route. bcrypt-12 (~200ms per attempt) throttles bruteforce
// even without the Redis bucket.

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

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
