import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

export const dynamic = "force-static";

/**
 * Public: aktuelle App-Version aus package.json.
 * Version wird beim Cold-Start eingelesen -- kein I/O pro Request.
 * Auch ohne Session abrufbar, damit das Version-Label immer sofort steht.
 */
export function GET() {
  return NextResponse.json({ version: pkg.version });
}
