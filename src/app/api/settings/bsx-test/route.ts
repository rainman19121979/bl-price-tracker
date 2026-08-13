import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { testSource, type BsxSource } from "@/lib/bsx-source";

export const dynamic = "force-dynamic";

// Test a BSX source configuration. The client sends the source config in the
// request body (including plaintext password if SMB), so the user can test
// BEFORE saving. Nothing is persisted.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!me?.isAdmin) return NextResponse.json({ error: "Nur Admin" }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const b = body as {
    type?: string; dir?: string;
    host?: string; share?: string; subpath?: string; domain?: string; user?: string; password?: string;
  };

  let source: BsxSource;
  if (b.type === "smb") {
    if (!b.host || !b.share || !b.user || !b.password) {
      return NextResponse.json({ error: "SMB benötigt host, share, user, password" }, { status: 400 });
    }
    source = {
      type: "smb",
      host: b.host.trim(),
      share: b.share.trim(),
      subpath: b.subpath?.trim() || null,
      domain: b.domain?.trim() || null,
      user: b.user.trim(),
      password: b.password,
    };
  } else {
    const dir = typeof b.dir === "string" ? b.dir.trim() : "";
    if (!dir) return NextResponse.json({ error: "dir required" }, { status: 400 });
    source = { type: "local", dir };
  }

  const result = await testSource(source);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, bsxFiles: result.count });
}
