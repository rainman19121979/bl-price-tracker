import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 600;  // 10 Min für große DBs
export const runtime = "nodejs";

/**
 * Admin-only: kompletter pg_dump als SQL-Download.
 * Enthält ALLES — inkl. verschlüsselter API-Keys. Der ENCRYPTION_KEY
 * (aus .env) wird nicht mit exportiert; ohne den ist das Backup wertlos.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: "DATABASE_URL nicht gesetzt" }, { status: 500 });
  }

  // DATABASE_URL parsen und Passwort per PGPASSWORD env übergeben — so
  // taucht es weder in `ps auxf` noch in pg_dump-stderr-Warnings auf.
  const { host, port, pathname, username, password } = new URL(dbUrl);
  const dump = spawn("pg_dump", [
    "--host", host,
    "--port", port || "5432",
    "--username", username,
    "--dbname", pathname.slice(1),
    "--format=plain",
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: password || "" },
  });

  const stream = new ReadableStream({
    start(controller) {
      dump.stdout.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      dump.stderr.on("data", (chunk: Buffer) => {
        // pg_dump schreibt Warnings nach stderr, das ist meist harmlos.
        // Bei echten Fehlern liefert der exit-code != 0. Log ist safe:
        // Passwort ist nicht in den Args und stderr enthält keine URL mehr.
        console.warn("[backup] pg_dump stderr:", chunk.toString().trim());
      });
      dump.on("close", (code) => {
        if (code === 0) controller.close();
        else controller.error(new Error(`pg_dump exit code ${code}`));
      });
      dump.on("error", (err) => controller.error(err));
    },
    cancel() {
      dump.kill("SIGTERM");
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/sql",
      "Content-Disposition": `attachment; filename="bl-price-tracker-backup-${date}.sql"`,
      "Cache-Control": "no-store",
    },
  });
}
