import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const publicPaths = ["/login", "/register", "/api/auth", "/api/external", "/api/setup"];

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
