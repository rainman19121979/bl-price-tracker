"use client";

import { useState, useMemo } from "react";
import { Key, Trash2, CheckCircle, XCircle, Loader2, Plus, Shield, PlusCircle } from "lucide-react";

export interface ExternalCaller {
  name: string;
  interval: number; // seconds
}

export interface ApiKey {
  id: number;
  consumerKey: string;
  dailyLimit: number;
  requestsToday: number;
  externalCalls: string | null;
  isValid: boolean;
  createdAt: string;
}

interface ApiKeysSectionProps {
  keys: ApiKey[];
  loading: boolean;
  onKeysChange: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function ApiKeysSection({ keys, loading, onKeysChange, onError, onSuccess }: ApiKeysSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);

  // Form state
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onError("");
    onSuccess("");
    setSaving(true);

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consumerKey, consumerSecret, tokenValue, tokenSecret }),
      });

      if (!res.ok) {
        const data = await res.json();
        onError(data.error || "Fehler beim Speichern");
        return;
      }

      onSuccess("API Key erfolgreich gespeichert!");
      setConsumerKey("");
      setConsumerSecret("");
      setTokenValue("");
      setTokenSecret("");
      setShowForm(false);
      onKeysChange();
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("API Key wirklich loeschen?")) return;
    onError("");

    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        onKeysChange();
        onSuccess("API Key geloescht");
      } else {
        onError("Fehler beim Loeschen");
      }
    } catch {
      onError("Netzwerkfehler");
    }
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    onError("");
    onSuccess("");

    try {
      const res = await fetch(`/api/keys/${id}/test`, { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        onSuccess("API Key funktioniert! Verbindung zu BrickLink erfolgreich.");
        onKeysChange();
      } else {
        onError(data.error || "API Key Test fehlgeschlagen");
      }
    } catch {
      onError("Netzwerkfehler beim Testen");
    } finally {
      setTesting(null);
    }
  };

  const handleLimitChange = async (id: number, newLimit: number) => {
    try {
      await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyLimit: newLimit }),
      });
      onKeysChange();
    } catch {
      // ignore
    }
  };

  const handleExternalCallsChange = async (id: number, callers: ExternalCaller[]) => {
    try {
      await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalCalls: callers.length > 0 ? JSON.stringify(callers) : null }),
      });
      onKeysChange();
    } catch {
      // ignore
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">BrickLink API Keys</h2>
          <p className="mt-1 text-sm text-gray-500">
            OAuth-Zugangsdaten von{" "}
            <a
              href="https://www.bricklink.com/v2/api/register_consumer.page"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              BrickLink API
            </a>
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          API Key hinzufuegen
        </button>
      </div>

      {/* Add Key Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">
            Neue BrickLink API-Zugangsdaten
          </h3>
          <p className="mb-4 text-xs text-gray-500">
            Du findest diese Daten auf der BrickLink API-Seite unter &quot;Register a New Consumer&quot;. Du brauchst Consumer Key, Consumer Secret, Token Value und Token Secret.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Consumer Key
              </label>
              <input
                type="text"
                value={consumerKey}
                onChange={(e) => setConsumerKey(e.target.value)}
                required
                placeholder="z.B. A1B2C3D4E5F6G7H8"
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Consumer Secret
              </label>
              <input
                type="password"
                value={consumerSecret}
                onChange={(e) => setConsumerSecret(e.target.value)}
                required
                placeholder="Wird verschluesselt gespeichert"
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Token Value
              </label>
              <input
                type="text"
                value={tokenValue}
                onChange={(e) => setTokenValue(e.target.value)}
                required
                placeholder="z.B. X9Y8Z7W6V5U4T3S2"
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Token Secret
              </label>
              <input
                type="password"
                value={tokenSecret}
                onChange={(e) => setTokenSecret(e.target.value)}
                required
                placeholder="Wird verschluesselt gespeichert"
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <Shield className="h-3.5 w-3.5" />
            Secrets werden mit AES-256-GCM verschluesselt gespeichert
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Speichern
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {/* Keys List */}
      <div className="mt-6">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : keys.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-400">
            Noch keine API-Keys konfiguriert.
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <ApiKeyCard
                key={key.id}
                apiKey={key}
                testing={testing}
                onTest={handleTest}
                onDelete={handleDelete}
                onLimitChange={handleLimitChange}
                onExternalCallsChange={handleExternalCallsChange}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function ApiKeyCard({
  apiKey: key,
  testing,
  onTest,
  onDelete,
  onLimitChange,
  onExternalCallsChange,
}: {
  apiKey: ApiKey;
  testing: number | null;
  onTest: (id: number) => void;
  onDelete: (id: number) => void;
  onLimitChange: (id: number, limit: number) => void;
  onExternalCallsChange: (id: number, callers: ExternalCaller[]) => void;
}) {
  const [showExternal, setShowExternal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInterval, setNewInterval] = useState("600");

  const externalCallers: ExternalCaller[] = useMemo(() => {
    if (!key.externalCalls) return [];
    try { return JSON.parse(key.externalCalls); } catch { return []; }
  }, [key.externalCalls]);

  const externalCallsPerDay = useMemo(
    () => externalCallers.reduce((sum, c) => sum + Math.floor(86400 / c.interval), 0),
    [externalCallers]
  );

  const totalEstimated = key.requestsToday + externalCallsPerDay;

  const addCaller = () => {
    const name = newName.trim();
    const interval = parseInt(newInterval);
    if (!name || !interval || interval < 1) return;
    onExternalCallsChange(key.id, [...externalCallers, { name, interval }]);
    setNewName("");
    setNewInterval("600");
  };

  const removeCaller = (idx: number) => {
    onExternalCallsChange(key.id, externalCallers.filter((_, i) => i !== idx));
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200">
            <Key className="h-5 w-5 text-gray-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-gray-900">{key.consumerKey}</span>
              {key.isValid ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
              <span>Tracker (24h): {key.requestsToday}</span>
              {externalCallsPerDay > 0 && (
                <span>+ Extern: ~{externalCallsPerDay}/Tag</span>
              )}
              <span className={totalEstimated > key.dailyLimit ? "text-red-600 font-medium" : ""}>
                Gesamt: ~{totalEstimated} / {key.dailyLimit}
              </span>
              <span>Erstellt: {new Date(key.createdAt).toLocaleDateString("de-DE")}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-4">
            <label className="text-xs text-gray-500">Limit:</label>
            <input
              type="number"
              defaultValue={key.dailyLimit}
              min={100}
              max={5000}
              onBlur={(e) => onLimitChange(key.id, parseInt(e.target.value) || 5000)}
              className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => onTest(key.id)}
            disabled={testing === key.id}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            {testing === key.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Testen"}
          </button>
          <button
            onClick={() => setShowExternal(!showExternal)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            Externe Tools
          </button>
          <button
            onClick={() => onDelete(key.id)}
            className="rounded-lg border border-gray-300 p-1.5 text-gray-400 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showExternal && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-3">
            Andere Tools die denselben API-Key nutzen (z.B. BrickSync). Wird nur zur Anzeige verwendet.
          </p>

          {externalCallers.length > 0 && (
            <div className="space-y-2 mb-3">
              {externalCallers.map((caller, idx) => (
                <div key={idx} className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="text-sm text-gray-700">
                    <span className="font-medium">{caller.name}</span>
                    <span className="text-gray-400 ml-2">
                      alle {caller.interval}s = ~{Math.floor(86400 / caller.interval)} Calls/Tag
                    </span>
                  </div>
                  <button
                    onClick={() => removeCaller(idx)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Tool-Name (z.B. BrickSync)"
              className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="number"
              value={newInterval}
              onChange={(e) => setNewInterval(e.target.value)}
              min={1}
              placeholder="Intervall (Sek.)"
              className="w-32 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <span className="text-xs text-gray-400 whitespace-nowrap">Sek.</span>
            <button
              onClick={addCaller}
              disabled={!newName.trim()}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Hinzufuegen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
