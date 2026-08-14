import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
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

  // Wichtig: wir dürfen erst NextResponse(stream, 200) zurückgeben, wenn wir
  // wissen dass pg_dump wirklich Daten liefert. Sonst committed Next den
  // 200-Header, pg_dump crasht danach (Version-Mismatch, ENOENT, Auth-Fail),
  // controller.error() feuert — und der Browser sieht nur einen leeren
  // Response (NS_ERROR_NET_EMPTY_RESPONSE) ohne jede Fehlermeldung.
  //
  // Deshalb: erst auf den ersten stdout-chunk warten. Kommt statt dessen
  // ein close mit exit!=0, liefern wir ein sauberes JSON-500 mit stderr.
  const stderrChunks: Buffer[] = [];
  dump.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const first = await new Promise<{ ok: true; chunk: Buffer } | { ok: false; error: string }>((resolve) => {
    const onData = (chunk: Buffer) => {
      cleanup();
      resolve({ ok: true, chunk });
    };
    const onClose = (code: number | null) => {
      cleanup();
      const stderr = Buffer.concat(stderrChunks).toString().trim();
      resolve({ ok: false, error: stderr || `pg_dump exit code ${code}` });
    };
    const onError = (err: Error) => {
      cleanup();
      resolve({ ok: false, error: err.message });
    };
    const cleanup = () => {
      dump.stdout.off("data", onData);
      dump.off("close", onClose);
      dump.off("error", onError);
    };
    dump.stdout.once("data", onData);
    dump.once("close", onClose);
    dump.once("error", onError);
  });

  if (!first.ok) {
    console.error("[backup] pg_dump failed before first byte:", first.error);
    return NextResponse.json(
      { error: `pg_dump fehlgeschlagen: ${first.error}` },
      { status: 500 },
    );
  }

  // Ab hier läuft pg_dump und liefert Daten — wir committen 200 und streamen.
  const firstChunk = first.chunk;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(firstChunk);
      dump.stdout.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      dump.stderr.on("data", (chunk: Buffer) => {
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
