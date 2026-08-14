import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncBricklinkInventory } from "@/lib/inventory-sync";
import { setLastSyncDate } from "@/lib/crawler-control";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Session-authenticated: user triggers an immediate BL inventory sync from the UI.
// Same helper as the scheduler runs on the 24h loop. Updates lastSyncDate so the
// scheduler doesn't re-run it in the next 5 min.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id);

  const t0 = Date.now();
  try {
    const result = await syncBricklinkInventory(userId);
    await setLastSyncDate(userId);
    return NextResponse.json({
      ok: true,
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
