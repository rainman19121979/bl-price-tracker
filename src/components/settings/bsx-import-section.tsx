"use client";

import { useState } from "react";
import { FolderOpen, Check, AlertTriangle, Download, Network } from "lucide-react";

export interface BsxSourceState {
  type: "local" | "smb";
  smbHost: string | null;
  smbShare: string | null;
  smbSubpath: string | null;
  smbDomain: string | null;
  smbUser: string | null;
  smbPasswordSet: boolean;
}

interface Props {
  initialDir: string | null;
  initialSource: BsxSourceState;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

interface TestResult {
  ok: boolean;
  bsxFiles?: number;
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

export function BsxImportSection({ initialDir, initialSource, onError, onSuccess }: Props) {
  const [type, setType] = useState<"local" | "smb">(initialSource.type);
  const [dir, setDir] = useState(initialDir ?? "");
  const [smbHost, setSmbHost] = useState(initialSource.smbHost ?? "");
  const [smbShare, setSmbShare] = useState(initialSource.smbShare ?? "");
  const [smbSubpath, setSmbSubpath] = useState(initialSource.smbSubpath ?? "");
  const [smbDomain, setSmbDomain] = useState(initialSource.smbDomain ?? "");
  const [smbUser, setSmbUser] = useState(initialSource.smbUser ?? "");
  const [smbPassword, setSmbPassword] = useState("");
  const [passwordAlreadySet, setPasswordAlreadySet] = useState(initialSource.smbPasswordSet);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const buildTestPayload = () => {
    if (type === "smb") {
      return {
        type: "smb",
        host: smbHost.trim(),
        share: smbShare.trim(),
        subpath: smbSubpath.trim() || undefined,
        domain: smbDomain.trim() || undefined,
        user: smbUser.trim(),
        password: smbPassword,
      };
    }
    return { type: "local", dir: dir.trim() };
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/bsx-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTestPayload()),
      });
      const data = await res.json();
      setTestResult(res.ok ? data : { ok: false, error: data.error || "Fehler" });
    } catch {
      setTestResult({ ok: false, error: "Netzwerkfehler" });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setImportResult(null);
    try {
      const body: Record<string, unknown> = {};
      if (type === "local") {
        body.bsxOrdersDir = dir.trim() || null;
        body.bsxSource = { type: "local" };
      } else {
        body.bsxSource = {
          type: "smb",
          smbHost: smbHost.trim(),
          smbShare: smbShare.trim(),
          smbSubpath: smbSubpath.trim() || null,
          smbDomain: smbDomain.trim() || null,
          smbUser: smbUser.trim(),
          // Only send password if user entered a new one; empty string with
          // no existing password means "clear", non-empty means "set"
          smbPassword: smbPassword.length > 0 ? smbPassword : (passwordAlreadySet ? null : ""),
        };
      }
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess(`BSX-Quelle gespeichert (${type})`);
        if (smbPassword.length > 0) setPasswordAlreadySet(true);
        setSmbPassword("");
      } else {
        onError(data.error || "Speichern fehlgeschlagen");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setSaving(false);
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
        onSuccess(`Import fertig: ${data.itemsImported} neue Items, ${data.itemsSkipped} bereits da`);
      } else {
        onError(data.error || "Import fehlgeschlagen");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
          <FolderOpen className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">BSX-Order-Import</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            BrickSync legt für jede eingehende Order eine BSX-Datei an. Der Scheduler liest den
            Ordner alle 30 Minuten und importiert neue Orders in <code className="rounded bg-gray-100 px-1 text-xs">my_sales</code>.
            Dateien werden nur gelesen, nie geändert oder gelöscht.
          </p>
        </div>
      </div>

      {/* Source-Type Selector */}
      <div className="mt-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
        <button
          onClick={() => { setType("local"); setTestResult(null); }}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            type === "local" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <FolderOpen size={14} /> Lokaler Ordner
        </button>
        <button
          onClick={() => { setType("smb"); setTestResult(null); }}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            type === "smb" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Network size={14} /> Netzwerkfreigabe (SMB)
        </button>
      </div>

      {/* Local form */}
      {type === "local" && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-gray-600">Pfad (im Container erreichbar)</label>
          <input type="text" value={dir} onChange={(e) => { setDir(e.target.value); setTestResult(null); }}
            placeholder="/pfad/zu/bricksync/orders  (leer lassen zum Deaktivieren)"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <p className="text-xs text-amber-700">
            ⚠️ Server-Prozess bekommt Lese-Zugriff auf den angegebenen Pfad. Nur eigene Verzeichnisse verwenden.
          </p>
        </div>
      )}

      {/* SMB form */}
      {type === "smb" && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Host / NAS-Adresse *</label>
            <input type="text" value={smbHost} onChange={(e) => { setSmbHost(e.target.value); setTestResult(null); }}
              placeholder="nas.local oder 192.168.1.20"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Share-Name *</label>
            <input type="text" value={smbShare} onChange={(e) => { setSmbShare(e.target.value); setTestResult(null); }}
              placeholder="lego oder BrickSync"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">Unterordner (optional)</label>
            <input type="text" value={smbSubpath} onChange={(e) => { setSmbSubpath(e.target.value); setTestResult(null); }}
              placeholder="bricksync/orders (leer = Share-Root)"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Domain / Workgroup (optional)</label>
            <input type="text" value={smbDomain} onChange={(e) => { setSmbDomain(e.target.value); setTestResult(null); }}
              placeholder="WORKGROUP"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Benutzername *</label>
            <input type="text" value={smbUser} onChange={(e) => { setSmbUser(e.target.value); setTestResult(null); }}
              placeholder="holger"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Passwort {passwordAlreadySet && <span className="text-green-600">(gespeichert — leer lassen zum Beibehalten)</span>}
            </label>
            <input type="password" value={smbPassword} onChange={(e) => { setSmbPassword(e.target.value); setTestResult(null); }}
              placeholder={passwordAlreadySet ? "••••••••" : "SMB-Passwort"}
              autoComplete="new-password"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <p className="mt-1 text-xs text-gray-500">
              Wird AES-256-verschlüsselt in der Datenbank abgelegt (gleicher Mechanismus wie BrickLink-Keys).
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button onClick={test} disabled={testing}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {testing ? "Teste…" : "Verbindung testen"}
        </button>
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "…" : "Speichern"}
        </button>
      </div>

      {testResult && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${
          testResult.ok ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-900"
        }`}>
          {testResult.ok ? (
            <>
              <Check size={16} className="mt-0.5 shrink-0 text-green-600" />
              <div>
                <div className="font-medium">Verbindung ok</div>
                <div className="mt-0.5 text-xs">{testResult.bsxFiles} .bsx-Dateien gefunden.</div>
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

      <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="text-sm text-gray-700">
          <div className="font-medium">Manueller Import</div>
          <div className="text-xs text-gray-500">Wartet sonst maximal 30 Min auf den Scheduler-Lauf.</div>
        </div>
        <button onClick={runImport} disabled={importing}
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          <Download size={14} />
          {importing ? "Läuft…" : "Jetzt importieren"}
        </button>
      </div>

      {importResult && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">Import fertig in {(importResult.durationMs / 1000).toFixed(1)}s</div>
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
