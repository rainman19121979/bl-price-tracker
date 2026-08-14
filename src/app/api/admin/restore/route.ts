import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { spawn } from "child_process";
import { Writable } from "stream";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const runtime = "nodejs";

/**
 * Admin-only: SQL-Dump per multipart/form-data hochladen, in psql pipen.
 * ACHTUNG: Der Dump enthält DROP-Statements (--clean --if-exists) und
 * ersetzt komplett den DB-Inhalt.
 *
 * Der Client muss "confirm=REPLACE" im Form-Body mitsenden, sonst wird
 * abgelehnt — als kleine Sicherheitsschranke gegen Fehlbedienung.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: "DATABASE_URL nicht gesetzt" }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Multipart-Body erwartet" }, { status: 400 });
  }

  const confirm = form.get("confirm");
  if (confirm !== "REPLACE") {
    return NextResponse.json({
      error: "Sicherheits-Schranke: confirm=REPLACE muss mitgesendet werden",
    }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Kein 'file' im Form-Body" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Datei ist leer" }, { status: 400 });
  }
  if (file.size > 500 * 1024 * 1024) {
    return NextResponse.json({ error: "Datei > 500 MB — bitte via psql direkt einspielen" }, { status: 400 });
  }

  // Preflight: erste Zeilen der Datei anschauen, muss nach pg_dump aussehen
  const preview = (await file.slice(0, 2048).text()).toLowerCase();
  if (!preview.includes("postgresql database dump") && !preview.includes("-- dumped from database")) {
    return NextResponse.json({
      error: "Datei sieht nicht wie ein pg_dump-Output aus (magic-string fehlt)",
    }, { status: 400 });
  }

  const t0 = Date.now();
  const psql = spawn("psql", ["--single-transaction", "--set", "ON_ERROR_STOP=1", dbUrl], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderrChunks = "";
  psql.stderr.on("data", (chunk: Buffer) => {
    stderrChunks += chunk.toString();
  });

  // Stream die Upload-Datei in psql's stdin
  const stdinWritable = Writable.toWeb(psql.stdin);
  const body = file.stream();

  try {
    await body.pipeTo(stdinWritable);
  } catch (err) {
    psql.kill("SIGTERM");
    return NextResponse.json({
      error: `Upload-Stream-Fehler: ${err instanceof Error ? err.message : String(err)}`,
    }, { status: 500 });
  }

  const exitCode: number = await new Promise((resolve) => psql.on("close", (c) => resolve(c ?? 1)));

  if (exitCode !== 0) {
    return NextResponse.json({
      error: `psql exit code ${exitCode}`,
      stderr: stderrChunks.slice(-2000),  // letzte 2 KB Fehler-Output
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - t0,
    warnings: stderrChunks.trim() || null,
    note: "Restore erfolgreich. Sessions ungültig — bitte neu einloggen.",
  });
}
