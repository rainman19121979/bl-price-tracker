"use client";

import { useState } from "react";
import { Boxes, Check, AlertTriangle, Download } from "lucide-react";
import { timeAgo } from "@/lib/formatters";

export interface HbtoolState {
  url: string | null;
  tokenSet: boolean;
  lastInventoryAt: string | null;
  lastOrdersAt: string | null;
  lastError: string | null;
  ordersCursor: string | null;
}

interface Props {
  initial: HbtoolState;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onActiveChange?: (active: boolean) => void;
}

interface SyncResponse {
  inventory: { notModified: boolean; totalLots: number; added: number; updated: number; removed: number; skipped: number } | null;
  orders: { ordersSeen: number; ordersWritten: number; ordersUnchanged: number; ordersRemoved: number; itemsSkipped: number } | null;
  error: string | null;
  durationMs: number;
}

export function HbtoolSection({ initial, onError, onSuccess, onActiveChange }: Props) {
  const [url, setUrl] = useState(initial.url ?? "http://localhost:8100");
  const [token, setToken] = useState("");
  const [tokenSet, setTokenSet] = useState(initial.tokenSet);
  const [active, setActive] = useState(!!initial.url && initial.tokenSet);
  const [lastError, setLastError] = useState(initial.lastError);
  const [lastInventoryAt, setLastInventoryAt] = useState(initial.lastInventoryAt);
  const [lastOrdersAt, setLastOrdersAt] = useState(initial.lastOrdersAt);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; lots?: number; error?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null);

  const apply = (h: HbtoolState | undefined) => {
    if (!h) return;
    const isActive = !!h.url && h.tokenSet;
    setTokenSet(h.tokenSet);
    setActive(isActive);
    setLastError(h.lastError);
    setLastInventoryAt(h.lastInventoryAt);
    setLastOrdersAt(h.lastOrdersAt);
    onActiveChange?.(isActive);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/hbtool-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), token: token.trim() || undefined }),
      });
      const data = await res.json();
      setTestResult(res.ok ? { ok: true, lots: data.lots } : { ok: false, error: data.error || "Fehler" });
    } catch {
      setTestResult({ ok: false, error: "Netzwerkfehler" });
    } finally {
      setTesting(false);
    }
  };

  const save = async (disable = false) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hbtool: disable
            ? { url: null }
            : { url: url.trim(), token: token.trim().length > 0 ? token.trim() : (tokenSet ? null : "") },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        apply(data.hbtool);
        setToken("");
        onSuccess(disable ? "hb-tool-Anbindung abgeschaltet" : "hb-tool-Anbindung gespeichert");
      } else {
        onError(data.error || "Speichern fehlgeschlagen");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  };

  const runSync = async (force = false) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/settings/hbtool-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data: SyncResponse = await res.json();
      setSyncResult(data);
      setLastError(data.error);
      if (data.inventory) setLastInventoryAt(new Date().toISOString());
      if (data.orders) setLastOrdersAt(new Date().toISOString());
      if (data.error) onError(data.error);
      else onSuccess("Abruf von hb-tool fertig");
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setSyncing(false);
    }
  };

  const guardHit = !!lastError && lastError.includes("Bremse:");

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
          <Boxes className="h-5 w-5 text-orange-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">hb-tool (Inventar + Bestellungen)</h2>
            {active && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">aktiv</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            Holt Bestand und Bestellungen alle 5 Minuten aus hb-tool, ohne BrickLink zu fragen. Solange das
            aktiv ist, sind BL-Auto-Sync und BSX-Import für dich abgeschaltet. Den Schlüssel erzeugst du in
            hb-tool unter Einstellungen → System.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">hb-tool-Adresse</label>
          <input type="text" value={url} onChange={(e) => { setUrl(e.target.value); setTestResult(null); }}
            placeholder="http://localhost:8100"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Schlüssel {tokenSet && <span className="text-green-600">(gespeichert, leer lassen zum Beibehalten)</span>}
          </label>
          <input type="password" value={token} onChange={(e) => { setToken(e.target.value); setTestResult(null); }}
            placeholder={tokenSet ? "••••••••" : "aus hb-tool kopieren"}
            autoComplete="new-password"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={test} disabled={testing || (!token && !tokenSet)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {testing ? "Teste…" : "Verbindung testen"}
        </button>
        <button onClick={() => save(false)} disabled={saving || (!token && !tokenSet)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "…" : "Speichern"}
        </button>
        {active && (
          <button onClick={() => save(true)} disabled={saving}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50">
            Abschalten
          </button>
        )}
      </div>

      {testResult && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${
          testResult.ok ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-900"
        }`}>
          {testResult.ok ? <Check size={16} className="mt-0.5 shrink-0 text-green-600" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />}
          <div>{testResult.ok ? `Verbindung ok, ${testResult.lots} Lots im Bestand.` : testResult.error}</div>
        </div>
      )}

      {active && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-xs text-gray-500">Letzter Inventar-Abruf</div>
              <div className="font-medium text-gray-900">{lastInventoryAt ? timeAgo(lastInventoryAt) : "noch nie"}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-xs text-gray-500">Letzter Bestell-Abruf</div>
              <div className="font-medium text-gray-900">{lastOrdersAt ? timeAgo(lastOrdersAt) : "noch nie"}</div>
            </div>
          </div>

          {lastError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
              <div className="flex-1">
                <div>{lastError}</div>
                {guardHit && (
                  <button onClick={() => runSync(true)} disabled={syncing}
                    className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    Trotzdem übernehmen
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="text-sm text-gray-700">
              <div className="font-medium">Jetzt abrufen</div>
              <div className="text-xs text-gray-500">Wartet sonst bis zu 5 Min auf den Scheduler.</div>
            </div>
            <button onClick={() => runSync(false)} disabled={syncing}
              className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">
              <Download size={14} />
              {syncing ? "Läuft…" : "Abrufen"}
            </button>
          </div>

          {syncResult && (syncResult.inventory || syncResult.orders) && (
            <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
              <div className="text-sm font-medium">Fertig in {(syncResult.durationMs / 1000).toFixed(1)}s</div>
              {syncResult.inventory && (
                <div className="mt-1">
                  Inventar: {syncResult.inventory.notModified
                    ? "unverändert"
                    : <>{syncResult.inventory.totalLots} Lots · <strong>+{syncResult.inventory.added}</strong> neu · <strong>{syncResult.inventory.updated}</strong> geändert · <strong>−{syncResult.inventory.removed}</strong> entfernt{syncResult.inventory.skipped > 0 && <> · {syncResult.inventory.skipped} übersprungen</>}</>}
                </div>
              )}
              {syncResult.orders && (
                <div className="mt-0.5">
                  Bestellungen: {syncResult.orders.ordersSeen} geprüft · <strong>{syncResult.orders.ordersWritten}</strong> geschrieben · {syncResult.orders.ordersUnchanged} unverändert · <strong>{syncResult.orders.ordersRemoved}</strong> entfernt{syncResult.orders.itemsSkipped > 0 && <> · {syncResult.orders.itemsSkipped} Positionen übersprungen</>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
