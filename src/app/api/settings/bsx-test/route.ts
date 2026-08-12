import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { promises as fs } from "fs";

import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!me?.isAdmin) return NextResponse.json({ error: "Nur Admin" }, { status: 403 });

  let body: { dir?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const dir = typeof body.dir === "string" ? body.dir.trim() : "";
  if (!dir) return NextResponse.json({ error: "dir required" }, { status: 400 });

  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return NextResponse.json({ error: "Pfad ist kein Verzeichnis" }, { status: 400 });
    const files = await fs.readdir(dir);
    const bsxFiles = files.filter(f => f.endsWith(".bsx"));
    return NextResponse.json({
      ok: true,
      totalFiles: files.length,
      bsxFiles: bsxFiles.length,
      sample: bsxFiles.slice(0, 3),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Ordner nicht lesbar: ${msg}` }, { status: 400 });
  }
}
