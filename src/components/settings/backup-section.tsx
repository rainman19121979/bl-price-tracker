"use client";

import { useRef, useState } from "react";
import { Download, Upload, Database, Loader2, AlertTriangle, Check } from "lucide-react";

interface Props {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function BackupSection({ onError, onSuccess }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const doRestore = async () => {
    if (!pendingFile) return;
    setRestoring(true);
    try {
      const form = new FormData();
      form.append("file", pendingFile);
      form.append("confirm", "REPLACE");
      const res = await fetch("/api/admin/restore", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        onSuccess(`Restore erfolgreich in ${Math.round((data.durationMs ?? 0) / 1000)}s. Bitte neu einloggen.`);
        setTimeout(() => window.location.href = "/login", 2000);
      } else {
        onError(data.error || "Restore fehlgeschlagen");
      }
    } catch {
      onError("Netzwerkfehler beim Restore");
    } finally {
      setRestoring(false);
      setShowConfirm(false);
      setPendingFile(null);
      setConfirmText("");
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
          <Database className="h-5 w-5 text-slate-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">Backup &amp; Restore (Admin)</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Kompletter Datenbank-Dump als SQL-Datei zum Herunterladen. Restore ersetzt komplett die aktuelle DB — vorherige Daten sind weg.
          </p>
        </div>
      </div>

      {/* Download */}
      <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div>
          <div className="text-sm font-medium text-gray-900">Backup herunterladen</div>
          <div className="mt-0.5 text-xs text-gray-500">
            Enthält alles: Watchlist, Marktdaten, API-Keys (verschlüsselt), Preisformeln, my_sales.
            Der ENCRYPTION_KEY aus <code className="rounded bg-white px-1">.env</code> ist NICHT dabei — den brauchst du zum Entschlüsseln der Keys.
          </div>
        </div>
        <a
          href="/api/admin/backup"
          className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Download className="h-4 w-4" />
          Backup herunterladen
        </a>
      </div>

      {/* Restore */}
      <div className="mt-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4">
        <div>
          <div className="text-sm font-medium text-red-900">Restore hochladen</div>
          <div className="mt-0.5 text-xs text-red-700">
            ⚠ Ersetzt die komplette DB. Alle aktuellen User, Lots, Sales, Preisdaten werden überschrieben.
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,application/sql"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setPendingFile(f);
              setShowConfirm(true);
            }
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={restoring}
          className="flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          Backup wählen &amp; einspielen
        </button>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Nach dem Restore sind alle Sessions ungültig (User-IDs können sich geändert haben) — du wirst automatisch ausgeloggt.
      </p>

      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Wichtig — BrickLink-Nutzungsbedingungen:</strong> Diese Backup-Datei enthält Preis-,
        Verkaufs- und Angebots-Daten die aus der BrickLink-API stammen. Laut BrickLink API Terms of Use
        darfst du diese Daten <strong>nicht an Dritte weitergeben, veröffentlichen oder verkaufen</strong>.
        Das Backup ist ausschließlich für deinen eigenen Wiederherstellungs-Zweck. Bewahre es sicher
        auf (Passwortmanager, verschlüsselte Cloud).
      </div>

      {/* Confirm-Dialog */}
      {showConfirm && pendingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !restoring && setShowConfirm(false)}>
          <div className="w-full max-w-md rounded-xl border border-red-300 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 shrink-0 text-red-600" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">Restore endgültig ausführen?</h3>
                <p className="mt-1 text-sm text-gray-700">
                  Datei: <code className="rounded bg-gray-100 px-1">{pendingFile.name}</code> ({(pendingFile.size / 1024 / 1024).toFixed(2)} MB)
                </p>
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <div className="font-medium">Das wird passieren:</div>
                  <ul className="mt-1 ml-4 list-disc text-xs text-red-800">
                    <li>Alle aktuellen User + Watchlist + Sales + Marktdaten werden GELÖSCHT</li>
                    <li>Der Inhalt der Backup-Datei wird eingespielt</li>
                    <li>Du wirst ausgeloggt und musst dich mit einem User aus dem Backup neu anmelden</li>
                    <li>Falls die encrypted API-Keys mit einem anderen ENCRYPTION_KEY verschlüsselt wurden, sind sie unbrauchbar</li>
                  </ul>
                </div>
                <label className="mt-3 block text-xs text-gray-600">
                  Tippe <code className="rounded bg-gray-100 px-1 text-red-700">ERSETZEN</code> um zu bestätigen:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowConfirm(false); setPendingFile(null); setConfirmText(""); }}
                disabled={restoring}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={doRestore}
                disabled={confirmText !== "ERSETZEN" || restoring}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {restoring ? "Spiele ein…" : "Endgültig einspielen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
