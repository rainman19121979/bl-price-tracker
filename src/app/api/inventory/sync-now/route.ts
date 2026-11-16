import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncBricklinkInventory } from "@/lib/inventory-sync";
import { setLastSyncDate } from "@/lib/crawler-control";
import { loadUserHbtoolSource } from "@/lib/hbtool-source";
import { runHbtoolSync } from "@/lib/hbtool-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Session-authenticated: user triggers an immediate inventory sync from the UI.
// Ist hb-tool als Quelle eingerichtet, kommt der Bestand von dort (kein
// BL-Aufruf, sonst wuerde der BL-Stand die hb-tool-Daten ueberschreiben).
// Ohne hb-tool: BL-getInventory wie der Scheduler im 24h-Takt.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id);

  const t0 = Date.now();

  if (await loadUserHbtoolSource(userId)) {
    const r = await runHbtoolSync(userId);
    if (!r.inventory) {
      return NextResponse.json({ error: r.error ?? "Abruf von hb-tool fehlgeschlagen" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      source: "hbtool",
      durationMs: Date.now() - t0,
      notModified: r.inventory.notModified,
      added: r.inventory.added,
      updated: r.inventory.updated,
      removed: r.inventory.removed,
      ordersWritten: r.orders?.ordersWritten ?? 0,
      warning: r.error,
    });
  }

  try {
    const result = await syncBricklinkInventory(userId);
    await setLastSyncDate(userId);
    return NextResponse.json({
      ok: true,
      source: "bricklink",
      durationMs: Date.now() - t0,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync fehlgeschlagen" },
      { status: 500 }
    );
  }
}
