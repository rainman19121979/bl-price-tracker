"use client";

import { useCallback, useEffect, useState } from "react";
import { Key, Copy, Check, Trash2, Plus, AlertTriangle } from "lucide-react";

interface Token {
  id: number;
  name: string;
  tokenPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Props {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function ApiTokensSection({ onError, onSuccess }: Props) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/tokens");
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  const createToken = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setFreshToken({ name: data.name, token: data.token });
        setNewName("");
        setShowCreate(false);
        fetchTokens();
        onSuccess("Token erstellt — bitte jetzt kopieren, er wird nicht erneut angezeigt");
      } else {
        onError(data.error || "Fehler beim Erstellen");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setCreating(false);
    }
  };

  const deleteToken = async (id: number, name: string) => {
    if (!confirm(`Token "${name}" wirklich löschen? Alle Clients mit diesem Token verlieren den Zugriff.`)) return;
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (res.ok) {
        onSuccess("Token gelöscht");
        fetchTokens();
      } else {
        onError("Fehler beim Löschen");
      }
    } catch {
      onError("Netzwerkfehler");
    }
  };

  const copyToken = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <Key className="h-5 w-5 text-gray-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">API-Tokens</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Bearer-Tokens für den Zugriff auf <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">/api/external/price</code> und <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">/api/external/price/batch</code>
            </p>
          </div>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={14} /> Neuer Token
          </button>
        )}
      </div>

      {showCreate && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <label className="block text-sm font-medium text-gray-700">Bezeichnung</label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="z.B. BrickSync-Client, N8N-Workflow…"
              maxLength={100}
              onKeyDown={(e) => { if (e.key === "Enter") createToken(); }}
              autoFocus
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={createToken}
              disabled={creating || !newName.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "Erstelle…" : "Erstellen"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(""); }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {freshToken && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">Token &quot;{freshToken.name}&quot; erstellt</p>
              <p className="mt-1 text-xs text-amber-800">
                Kopiere den Token jetzt — er wird aus Sicherheitsgründen nicht noch einmal angezeigt.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  readOnly
                  value={freshToken.token}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 rounded border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-gray-900"
                />
                <button
                  onClick={copyToken}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors ${copied ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"}`}
                >
                  {copied ? <><Check size={14} /> Kopiert!</> : <><Copy size={14} /> Kopieren</>}
                </button>
                <button
                  onClick={() => setFreshToken(null)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Schließen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-gray-500">Lade…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-gray-500">Noch keine Tokens vorhanden.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500">Token</th>
                  <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500">Erstellt</th>
                  <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500">Zuletzt genutzt</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{t.tokenPreview}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{new Date(t.createdAt).toLocaleDateString("de-DE")}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString("de-DE") : "nie"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => deleteToken(t.id, t.name)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title="Löschen"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-gray-700">Verwendungs-Beispiele</summary>
        <div className="mt-3 space-y-4 text-xs text-gray-700">
          <div className="rounded border border-blue-200 bg-blue-50 p-2">
            <p className="font-semibold text-blue-900">Info: apiUsage in jeder Response</p>
            <p className="text-[11px] text-blue-800">Jede Antwort enthält <code>{`{"apiUsage":{"used":772,"external":0,"limit":4000,"remaining":3228}}`}</code> — nutze <code>remaining</code> um vor Bulk-Aktionen zu prüfen ob Budget da ist.</p>
          </div>

          <div>
            <p className="font-semibold">Einzel-Preis (GET)</p>
            <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-[10px] text-gray-100">{`curl -H "Authorization: Bearer <TOKEN>" \\
  "https://<host>/api/external/price?partNo=3024&colorId=1&itemType=PART&condition=N"`}</pre>
          </div>

          <div>
            <p className="font-semibold">Batch-Preise (POST, max 100 Items)</p>
            <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-[10px] text-gray-100">{`curl -X POST -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"items":[{"partNo":"3024","colorId":1,"itemType":"PART","condition":"N"}]}' \\
  "https://<host>/api/external/price/batch"`}</pre>
          </div>

          <div className="rounded border border-green-200 bg-green-50 p-2">
            <p className="font-semibold text-green-900">Empfohlen für hb-tool: Lot pushen</p>
            <p className="text-[11px] text-green-800">Trägt Lot in die Watchlist ein und rechnet sofort suggestedPrice — ohne dass der Preistracker BL-Inventar selbst pollt. 0 BL-Calls wenn Part bekannt.</p>
            <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-[10px] text-gray-100">{`curl -X POST -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"lots":[{
    "blInventoryId":123456789,
    "partNo":"3024","colorId":1,"itemType":"PART","condition":"N",
    "myPrice":0.045,"myQuantity":100,"myCost":2.50
  }]}' \\
  "https://<host>/api/external/watchlist/lots"
# Optional: ?skipPriceFetch=true  (nie BL-Call machen, auch bei unbekannten Teilen)`}</pre>
          </div>

          <div>
            <p className="font-semibold">Lot löschen</p>
            <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-[10px] text-gray-100">{`# Einzeln
curl -X DELETE -H "Authorization: Bearer <TOKEN>" \\
  "https://<host>/api/external/watchlist/lots?blInventoryId=123456789"

# Batch
curl -X DELETE -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \\
  -d '{"blInventoryIds":[111,222,333]}' \\
  "https://<host>/api/external/watchlist/lots"`}</pre>
          </div>

          <div>
            <p className="font-semibold">Voller Inventar-Sync (Legacy)</p>
            <p className="text-[11px] text-gray-500">Nur nötig wenn KEIN externes Tool die Lots pusht. Holt BL-Inventar (1+ BL-Call).</p>
            <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-[10px] text-gray-100">{`curl -X POST -H "Authorization: Bearer <TOKEN>" \\
  "https://<host>/api/external/inventory/sync"
# Optional: ?fetchNewParts=false  (nur Bestandsabgleich, keine Preis-Fetches)`}</pre>
          </div>

          <div>
            <p className="font-semibold">Nur Empfehlungspreise neu berechnen</p>
            <p className="text-[11px] text-gray-500">Kein BL-Call — rechnet alle Lot-Empfehlungen neu (~10s für 9k Lots). Sinnvoll nach Formel-Änderung.</p>
            <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-[10px] text-gray-100">{`curl -X POST -H "Authorization: Bearer <TOKEN>" \\
  "https://<host>/api/external/inventory/recompute"`}</pre>
          </div>
        </div>
      </details>
    </section>
  );
}
