import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const publicPaths = ["/login", "/register", "/api/auth", "/api/external", "/api/setup", "/api/version"];

// Paths that should never go through auth middleware
function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/public") ||
    pathname.includes(".")
  );
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Double-check: skip static assets
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  // Allow public paths
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // API routes: require auth but return 401 instead of redirect
  if (pathname.startsWith("/api/")) {
    if (!req.auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // CSRF-Schutz für state-ändernde Requests: prüfe Origin/Referer gegen
    // Host-Header. Same-origin fetch() setzt Origin auto — Cross-Origin-POSTs
    // (z.B. von einer bösartigen Seite) haben eine fremde Origin und fliegen.
    // SameSite=Lax auf dem Session-Cookie schützt zwar viele Fälle, aber
    // Top-Level-Navigations-POSTs kommen trotzdem durch — deswegen dieser
    // Zweit-Layer.
    const method = req.method;
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      const origin = req.headers.get("origin");
      const host = req.headers.get("host");
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return NextResponse.json(
              { error: "CSRF: Cross-Origin-Request abgelehnt" },
              { status: 403 }
            );
          }
        } catch {
          return NextResponse.json({ error: "CSRF: Ungültiger Origin-Header" }, { status: 403 });
        }
      }
      // Kein Origin-Header (z.B. bei manchen curl-Aufrufen ohne -H origin):
      // NextAuth setzt bei fetch() eh Origin, echte Browser auch — Requests
      // ohne Origin sind fast immer Skripts/curl, die wir per Bearer-Token
      // gehen sollten (nicht per Session-Cookie). Wir lassen sie durch,
      // um API-Nutzung mit Bearer nicht zu brechen.
    }

    return NextResponse.next();
  }

  // Redirect unauthenticated users to /login
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    const safePath = pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/';
    loginUrl.searchParams.set("callbackUrl", safePath);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Match everything except static files
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
