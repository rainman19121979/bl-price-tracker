import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { spawn } from "child_process";

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

  // Sicherheits-Scan der KOMPLETTEN Datei auf Postgres-RCE-Vektoren.
  // pg_dump erzeugt nie diese Muster in normalen Dumps; jede Präsenz ist
  // ein Zeichen für einen manipulierten/gefährlichen Dump.
  //
  // - COPY … FROM PROGRAM  → beliebige Shell-Command-Execution als postgres-User
  //   (nur mit pg_execute_server_program-Role, aber unsere App-DB-Role hat es)
  // - \! psql-Meta-Command → Shell-Escape wenn per psql eingespielt
  // - CREATE EXTENSION … / SQL-Function-Loading kann C-Extensions einbinden
  //
  // Wir lesen die Datei einmal komplett zum Scan (bis 500 MB — passt in RAM
  // auf dem Zielsystem) und schreiben sie danach an psql weiter.
  const fullText = await file.text();
  const dangerousPatterns = [
    /\bCOPY\b[\s\S]{0,200}\bFROM\s+PROGRAM\b/i,
    /^\s*\\!/m,
    /\bCREATE\s+EXTENSION\b/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b[\s\S]{0,500}\bLANGUAGE\s+C\b/i,
  ];
  for (const pat of dangerousPatterns) {
    const m = fullText.match(pat);
    if (m) {
      return NextResponse.json({
        error: `Verdächtiges SQL-Muster in Backup erkannt und abgelehnt: ${m[0].slice(0, 80)}...`,
        hint: "pg_dump-Standardausgaben enthalten diese Muster nie. Datei sieht manipuliert oder von fremder Quelle.",
      }, { status: 400 });
    }
  }

  const t0 = Date.now();
  // Parse DATABASE_URL → PGPASSWORD, damit das Passwort nicht als CLI-Arg
  // sichtbar ist und auch nicht in psql-Fehlermeldungen leakt.
  // hostname (nicht host!) — host inkludiert den Port.
  const { hostname, port, pathname, username, password } = new URL(dbUrl);
  const psql = spawn("psql", [
    "--host", hostname,
    "--port", port || "5432",
    "--username", username,
    "--dbname", pathname.slice(1),
    "--single-transaction",
    "--set", "ON_ERROR_STOP=1",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: password || "" },
  });

  let stderrChunks = "";
  psql.stderr.on("data", (chunk: Buffer) => {
    stderrChunks += chunk.toString();
  });

  // Datei-Text (bereits von der Security-Scan-Phase in RAM) an psql pipen.
  try {
    psql.stdin.write(fullText);
    psql.stdin.end();
  } catch (err) {
    psql.kill("SIGTERM");
    return NextResponse.json({
      error: `Pipe-Fehler: ${err instanceof Error ? err.message : String(err)}`,
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
