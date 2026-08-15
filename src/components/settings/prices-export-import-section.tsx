"use client";

import { useRef, useState } from "react";
import { Download, Upload, LineChart, Loader2 } from "lucide-react";

interface Props {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

interface ImportResult {
  parts: { added: number; existing: number; total: number };
  sales: { added: number; existing: number; total: number };
  stock: { added: number; existing: number; total: number };
  daily: { recomputed: number; affected: number };
  durationMs: number;
}

export function PricesExportImportSection({ onError, onSuccess }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const doImport = async (file: File) => {
    setImporting(true);
    setLastResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/prices/import", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        setLastResult(data);
        onSuccess(`Import fertig in ${Math.round((data.durationMs ?? 0) / 1000)}s`);
      } else {
        onError(data.error || "Import fehlgeschlagen");
      }
    } catch {
      onError("Netzwerkfehler beim Import");
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100">
          <LineChart className="h-5 w-5 text-indigo-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">Preisdaten Export / Import (Admin)</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Nur die Marktdaten (Parts, Sales, Stock, Daily-Rollups). Kein User, keine Watchlist, keine API-Keys. Import ist additiv — vorhandene Zeilen bleiben, nur Neues kommt dazu.
          </p>
        </div>
      </div>

      {/* Export */}
      <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div>
          <div className="text-sm font-medium text-gray-900">Preisdaten exportieren</div>
          <div className="mt-0.5 text-xs text-gray-500">
            Ein NDJSON-File mit allen Parts + Sales + Stock + Daily. Fuer Instanz-Umzug oder Merge zwischen deinen eigenen Instanzen.
          </div>
        </div>
        <a
          href="/api/admin/prices/export"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Download className="h-4 w-4" />
          Exportieren
        </a>
      </div>

      {/* Import */}
      <div className="mt-3 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div>
          <div className="text-sm font-medium text-gray-900">Preisdaten importieren</div>
          <div className="mt-0.5 text-xs text-gray-500">
            Ein NDJSON aus einem anderen Export einspielen. Bereits vorhandene Zeilen werden nicht ueberschrieben — nur was fehlt kommt dazu. Daily-Rollups werden fuer betroffene Kombis neu berechnet.
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ndjson,application/x-ndjson,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {importing ? "Importiere…" : "Datei waehlen &amp; einspielen"}
        </button>
      </div>

      {/* Ergebnis */}
      {lastResult && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <div className="font-medium mb-1">Import-Ergebnis:</div>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>Parts: <strong>{lastResult.parts.added}</strong> neu, {lastResult.parts.existing} schon vorhanden (von {lastResult.parts.total})</li>
            <li>Sales: <strong>{lastResult.sales.added}</strong> neu, {lastResult.sales.existing} schon vorhanden (von {lastResult.sales.total})</li>
            <li>Stock: <strong>{lastResult.stock.added}</strong> neu, {lastResult.stock.existing} schon vorhanden (von {lastResult.stock.total})</li>
            <li>Daily-Rollups: <strong>{lastResult.daily.recomputed}</strong> neu berechnet ({lastResult.daily.affected} betroffen)</li>
            <li>Dauer: {Math.round(lastResult.durationMs / 1000)}s</li>
          </ul>
        </div>
      )}

      {/* TOS-Warnung */}
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Wichtig — BrickLink-Nutzungsbedingungen:</strong> Die exportierten Daten stammen aus der
        BrickLink-API. Laut BrickLink API Terms of Use darfst du diese Daten <strong>nicht an Dritte
        weitergeben, veroeffentlichen oder verkaufen</strong>. Dieser Export ist ausschliesslich fuer
        <em> deinen eigenen Instanz-Umzug oder Merge zwischen deinen Instanzen</em> gedacht — nicht zum Teilen.
      </div>
    </section>
  );
}
