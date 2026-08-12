"use client";

import { useState } from "react";
import { FolderOpen, Check, AlertTriangle, Download } from "lucide-react";

interface Props {
  initialDir: string | null;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

interface TestResult {
  ok: boolean;
  totalFiles?: number;
  bsxFiles?: number;
  sample?: string[];
  error?: string;
}

interface ImportResult {
  ordersProcessed: number;
  itemsImported: number;
  itemsSkipped: number;
  partsCreated: number;
  errors: number;
  durationMs: number;
}

export function BsxImportSection({ initialDir, onError, onSuccess }: Props) {
  const [dir, setDir] = useState(initialDir ?? "");
  const [savedDir, setSavedDir] = useState(initialDir ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const save = async () => {
    setSaving(true);
    setTestResult(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bsxOrdersDir: dir.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedDir(data.bsxOrdersDir ?? "");
        onSuccess(dir.trim() ? `BSX-Ordner gesetzt: ${data.bsxOrdersDir}` : "BSX-Import deaktiviert");
      } else {
        onError(data.error || "Speichern fehlgeschlagen");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/bsx-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: dir.trim() }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: "Netzwerkfehler" });
    } finally {
      setTesting(false);
    }
  };

  const runImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/settings/bsx-import", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setImportResult(data);
        onSuccess(
          `Import fertig: ${data.itemsImported} neue Items, ${data.itemsSkipped} bereits da, ${data.partsCreated} Parts neu`,
        );
      } else {
        onError(data.error || "Import fehlgeschlagen");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setImporting(false);
    }
  };

  const isSaved = dir.trim() === savedDir;
  const canImport = !!savedDir && isSaved && !importing;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
          <FolderOpen className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">BSX-Order-Import</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Pfad zu einem Verzeichnis mit BSX-Order-Dateien (z.B. von BrickSync). Der Scheduler scannt den Ordner alle 30 Minuten und importiert neue Orders in <code className="rounded bg-gray-100 px-1 text-xs">my_sales</code>. Dateien werden nur gelesen, nie geändert oder gelöscht.
          </p>
          <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            ⚠️ Der Server-Prozess erhält lesenden Zugriff auf den angegebenen Pfad. Nur eigene Verzeichnisse verwenden (kein <code className="rounded bg-white/60 px-1">/etc</code>, <code className="rounded bg-white/60 px-1">/root</code> etc.).
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <input type="text" value={dir} onChange={(e) => { setDir(e.target.value); setTestResult(null); }}
          placeholder="/pfad/zu/bricksync/orders  (leer lassen zum Deaktivieren)"
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <button onClick={test} disabled={testing || !dir.trim()}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {testing ? "…" : "Testen"}
        </button>
        <button onClick={save} disabled={saving || isSaved}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "…" : isSaved ? "Gespeichert" : "Speichern"}
        </button>
      </div>

      {testResult && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${
          testResult.ok
            ? "border-green-200 bg-green-50 text-green-900"
            : "border-red-200 bg-red-50 text-red-900"
        }`}>
          {testResult.ok ? (
            <>
              <Check size={16} className="mt-0.5 shrink-0 text-green-600" />
              <div>
                <div className="font-medium">Ordner lesbar</div>
                <div className="mt-0.5 text-xs">
                  {testResult.bsxFiles} .bsx-Dateien gefunden ({testResult.totalFiles} Einträge insgesamt).
                  {testResult.sample && testResult.sample.length > 0 && (
                    <> Beispiel: <code className="rounded bg-white/60 px-1">{testResult.sample.join(", ")}</code></>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
              <div>{testResult.error || "Unbekannter Fehler"}</div>
            </>
          )}
        </div>
      )}

      {savedDir && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="text-sm text-gray-700">
            <div className="font-medium">Manueller Import</div>
            <div className="text-xs text-gray-500">Wartet sonst maximal 30 Min auf den Scheduler-Lauf.</div>
          </div>
          <button onClick={runImport} disabled={!canImport}
            className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            <Download size={14} />
            {importing ? "Läuft…" : "Jetzt importieren"}
          </button>
        </div>
      )}

      {importResult && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">
            Import fertig in {(importResult.durationMs / 1000).toFixed(1)}s
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs md:grid-cols-4">
            <span>Orders: <strong>{importResult.ordersProcessed}</strong></span>
            <span>Neue Items: <strong>{importResult.itemsImported}</strong></span>
            <span>Bereits da: <strong>{importResult.itemsSkipped}</strong></span>
            <span>Parts neu: <strong>{importResult.partsCreated}</strong></span>
            {importResult.errors > 0 && (
              <span className="col-span-2 text-red-700 md:col-span-4">Fehler: <strong>{importResult.errors}</strong></span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
