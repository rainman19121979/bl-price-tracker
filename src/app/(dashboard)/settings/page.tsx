"use client";

import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import { ApiKeysSection, type ApiKey } from "@/components/settings/api-keys-section";
import { AutoSyncSection } from "@/components/settings/auto-sync-section";
import { ShippingCountriesSection } from "@/components/settings/shipping-countries-section";
import { PricingFormulasSection } from "@/components/settings/pricing-formulas-section";
import { ApiTokensSection } from "@/components/settings/api-tokens-section";
import { BsxImportSection } from "@/components/settings/bsx-import-section";
import type { PricingRule } from "@/lib/pricing-engine";

export default function SettingsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);

  // Crawler + Auto-sync state
  const [crawlerEnabled, setCrawlerEnabled] = useState(true);
  const [autoSync, setAutoSync] = useState(false);
  const [autoSyncLoading, setAutoSyncLoading] = useState(true);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);
  const [crawlerSaving, setCrawlerSaving] = useState(false);

  // Pricing formulas state
  const [pricingFormulas, setPricingFormulas] = useState<PricingRule[]>([]);

  // Fresh days state
  const [freshDays, setFreshDays] = useState(14);
  const [freshDaysSaving, setFreshDaysSaving] = useState(false);

  // Shipping countries state
  const [shippingCountries, setShippingCountries] = useState<string[] | null>(null);
  const [availableCountries, setAvailableCountries] = useState<{ code: string; sales: number }[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // BSX orders directory (optional feature)
  const [bsxOrdersDir, setBsxOrdersDir] = useState<string | null>(null);

  // Account deletion state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Shared messages
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys);
      }
    } catch {
      // ignore
    } finally {
      setKeysLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setAutoSync(data.autoSyncInventory);
        setCrawlerEnabled(data.crawlerEnabled);
        setFreshDays(data.freshDays ?? 14);
        setPricingFormulas(data.pricingFormulas || []);
        setShippingCountries(data.shippingCountries);
        setAvailableCountries(data.availableCountries || []);
        setBsxOrdersDir(data.bsxOrdersDir ?? null);
        setSettingsLoaded(true);
      }
    } catch {
      // ignore
    } finally {
      setAutoSyncLoading(false);
    }
  }, []);

  const toggleAutoSync = async () => {
    setAutoSyncSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSyncInventory: !autoSync }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutoSync(data.autoSyncInventory);
        setSuccess(
          data.autoSyncInventory
            ? "Auto-Sync aktiviert"
            : "Auto-Sync deaktiviert"
        );
      } else {
        setError("Fehler beim Speichern der Einstellung");
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setAutoSyncSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setError("Bitte Passwort eingeben");
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmPassword: deletePassword }),
      });
      if (res.ok) {
        await signOut({ callbackUrl: "/login" });
      } else {
        const data = await res.json();
        setError(data.error || "Fehler beim Loeschen des Kontos");
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setDeleteLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
    fetchSettings();
  }, [fetchKeys, fetchSettings]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Einstellungen</h1>
        <p className="mt-1 text-sm text-gray-500">
          Verwalte API-Keys, Crawl-Einstellungen und Datenexport
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <ApiKeysSection
        keys={keys}
        loading={keysLoading}
        onKeysChange={fetchKeys}
        onError={setError}
        onSuccess={setSuccess}
      />

      {/* Crawler API Toggle */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
              <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">API-Nutzung fuer Crawler</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Erlaube dem Crawler deinen API-Key zu nutzen um Preise abzufragen. Dein Tageslimit wird dabei respektiert.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={crawlerEnabled}
            disabled={crawlerSaving}
            onClick={async () => {
              setCrawlerSaving(true);
              try {
                const res = await fetch("/api/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ crawlerEnabled: !crawlerEnabled }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setCrawlerEnabled(data.crawlerEnabled);
                  setSuccess(data.crawlerEnabled ? "API-Nutzung aktiviert" : "API-Nutzung deaktiviert");
                }
              } catch { setError("Netzwerkfehler"); }
              finally { setCrawlerSaving(false); }
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
              crawlerEnabled ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${crawlerEnabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
      </section>

      {/* Datenaktualität */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Datenaktualitaet</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Wie alt duerfen Preisdaten sein, bevor sie neu geholt werden?
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={freshDays}
              min={1}
              max={90}
              onChange={(e) => setFreshDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 14)))}
              className="w-20 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">Tage</span>
          </div>
          <button
            disabled={freshDaysSaving}
            onClick={async () => {
              setFreshDaysSaving(true);
              try {
                const res = await fetch("/api/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ freshDays }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setFreshDays(data.freshDays);
                  setSuccess(`Max-Alter auf ${data.freshDays} Tage gesetzt`);
                }
              } catch { setError("Netzwerkfehler"); }
              finally { setFreshDaysSaving(false); }
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {freshDaysSaving ? "Speichern..." : "Speichern"}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Teile mit aelteren Preisdaten werden vom Crawler bevorzugt aktualisiert. Hoehere Werte reduzieren die Last auf den API-Key.
        </p>
      </section>

      {settingsLoaded && (
        <PricingFormulasSection
          initialFormulas={pricingFormulas}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}

      <AutoSyncSection
        autoSync={autoSync}
        loading={autoSyncLoading}
        saving={autoSyncSaving}
        onToggle={toggleAutoSync}
      />

      {settingsLoaded && (
        <ShippingCountriesSection
          initialCountries={shippingCountries}
          availableCountries={availableCountries}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}

      <ApiTokensSection onError={setError} onSuccess={setSuccess} />

      {settingsLoaded && (
        <BsxImportSection
          initialDir={bsxOrdersDir}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}

      {/* Data Export Section */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Datenexport</h2>
        <p className="mt-1 text-sm text-gray-500">
          Exportiere deine gesammelten Preisdaten
        </p>
        <div className="mt-6 flex gap-3">
          <a
            href="/api/users/me/export"
            download
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            JSON Export (DSGVO)
          </a>
          <button
            disabled
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            CSV Export (bald verfuegbar)
          </button>
        </div>
      </section>

      {/* Danger Zone: Account Deletion */}
      <section className="rounded-xl border border-red-300 bg-red-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-red-900">Gefahrenzone</h2>
        <p className="mt-1 text-sm text-red-700">
          Unwiderrufliche Aktionen — bitte mit Vorsicht verwenden.
        </p>
        <div className="mt-6">
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Konto loeschen
          </button>
        </div>
      </section>

      {/* Delete Account Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => {
              setShowDeleteDialog(false);
              setDeletePassword("");
            }}
          />
          <div className="relative z-50 w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-gray-900">
              Konto endgueltig loeschen?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Alle deine Daten werden unwiderruflich geloescht: Watchlist,
              API-Keys, Einstellungen und Kontoinformationen. Bitte gib dein
              Passwort zur Bestaetigung ein.
            </p>
            <div className="mt-4">
              <label
                htmlFor="delete-password"
                className="block text-sm font-medium text-gray-700"
              >
                Passwort
              </label>
              <input
                id="delete-password"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                placeholder="Passwort eingeben"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeletePassword("");
                }}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Abbrechen
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading || !deletePassword}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? "Wird geloescht..." : "Endgueltig loeschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
