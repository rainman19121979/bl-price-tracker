"use client";

import { useState, useEffect, useCallback } from "react";
import { ApiKeysSection, type ApiKey } from "@/components/settings/api-keys-section";
import { AutoSyncSection } from "@/components/settings/auto-sync-section";
import { ShippingCountriesSection } from "@/components/settings/shipping-countries-section";
import { SellerCountriesSection } from "@/components/settings/seller-countries-section";
import { PricingFormulasSection } from "@/components/settings/pricing-formulas-section";
import { ApiTokensSection } from "@/components/settings/api-tokens-section";
import { BsxImportSection, type BsxSourceState } from "@/components/settings/bsx-import-section";
import { AdminSection } from "@/components/settings/admin-section";
import { BackupSection } from "@/components/settings/backup-section";
import { useSession } from "next-auth/react";
import type { PricingRule } from "@/lib/pricing-engine";

export default function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin ?? false;
  const currentUserId = session?.user?.id ? parseInt(session.user.id) : 0;

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
  const [freshDays, setFreshDays] = useState(180);
  const [freshDaysSaving, setFreshDaysSaving] = useState(false);
  const [budgetStats, setBudgetStats] = useState<{ watchlistCount: number; dailyLimit: number; externalCallsPerDay: number } | null>(null);

  // Shipping countries state
  const [shippingCountries, setShippingCountries] = useState<string[] | null>(null);
  const [availableCountries, setAvailableCountries] = useState<{ code: string; sales: number }[]>([]);
  const [sellerCountries, setSellerCountries] = useState<string[] | null>(null);
  const [availableSellerCountries, setAvailableSellerCountries] = useState<{ code: string; sales: number }[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // BSX orders directory (optional feature)
  const [bsxOrdersDir, setBsxOrdersDir] = useState<string | null>(null);
  const [bsxSource, setBsxSource] = useState<BsxSourceState>({
    type: "local", smbHost: null, smbShare: null, smbSubpath: null,
    smbDomain: null, smbUser: null, smbPasswordSet: false,
  });

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
        setFreshDays(data.freshDays ?? 180);
        setPricingFormulas(data.pricingFormulas || []);
        setShippingCountries(data.shippingCountries);
        setAvailableCountries(data.availableCountries || []);
        setSellerCountries(data.sellerCountries);
        setAvailableSellerCountries(data.availableSellerCountries || []);
        setBsxOrdersDir(data.bsxOrdersDir ?? null);
        if (data.bsxSource) setBsxSource(data.bsxSource);
        setSettingsLoaded(true);
      }
    } catch {
      // ignore
    } finally {
      setAutoSyncLoading(false);
    }
  }, []);

  const fetchBudget = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/stats");
      if (res.ok) {
        const data = await res.json();
        setBudgetStats({
          watchlistCount: data.watchlistCount ?? 0,
          dailyLimit: data.dailyLimit ?? 0,
          externalCallsPerDay: data.externalCallsPerDay ?? 0,
        });
      }
    } catch { /* ignore */ }
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

  useEffect(() => {
    fetchKeys();
    fetchSettings();
    fetchBudget();
  }, [fetchKeys, fetchSettings, fetchBudget]);

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
              Wie alt duerfen Preisdaten sein, bevor sie neu geholt werden? Kuerzer = frischer, kostet mehr API-Aufrufe.
            </p>
          </div>
        </div>
        {(() => {
          const months = Math.max(1, Math.round(freshDays / 30));
          const wl = budgetStats?.watchlistCount ?? 0;
          const limit = budgetStats?.dailyLimit ?? 0;
          const external = budgetStats?.externalCallsPerDay ?? 0;
          const days = months * 30;
          const requiredPerDay = Math.ceil((wl * 2) / days);
          const totalUsage = requiredPerDay + external;
          const available = Math.max(0, limit - external);
          const exceeds = limit > 0 && requiredPerDay > available;
          return (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-700">Alle</label>
                <select
                  value={months}
                  onChange={(e) => setFreshDays(parseInt(e.target.value) * 30)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((m) => (
                    <option key={m} value={m}>{m} Monat{m > 1 ? "e" : ""}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-600">neu holen</span>
                <button
                  disabled={freshDaysSaving || exceeds}
                  onClick={async () => {
                    setFreshDaysSaving(true);
                    setError(""); setSuccess("");
                    try {
                      const res = await fetch("/api/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ freshDays: days }),
                      });
                      const data = await res.json();
                      if (res.ok) {
                        setFreshDays(data.freshDays);
                        setSuccess(`Max-Alter auf ${Math.round(data.freshDays / 30)} Monate gesetzt`);
                        fetchBudget();
                      } else {
                        setError(data.error || "Fehler beim Speichern");
                      }
                    } catch { setError("Netzwerkfehler"); }
                    finally { setFreshDaysSaving(false); }
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {freshDaysSaving ? "Speichern..." : "Speichern"}
                </button>
              </div>

              {budgetStats && (
                <div className={`mt-3 rounded-lg border p-3 text-xs ${
                  exceeds ? "border-red-300 bg-red-50 text-red-900" :
                  totalUsage > limit * 0.8 ? "border-amber-300 bg-amber-50 text-amber-900" :
                  "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    <div>
                      <span className="font-semibold">Lots:</span> {wl.toLocaleString("de-DE")}
                      {" · "}
                      <span className="font-semibold">Zeitraum:</span> {months} Monat{months > 1 ? "e" : ""} = {days} Tage
                    </div>
                    <div>
                      <span className="font-semibold">Benoetigt:</span> ~{requiredPerDay.toLocaleString("de-DE")} Calls/Tag
                      {external > 0 && ` + ${external} extern`}
                      {limit > 0 && (
                        <> {" · "}<span className="font-semibold">Limit:</span> {limit.toLocaleString("de-DE")}</>
                      )}
                    </div>
                  </div>
                  {exceeds && (
                    <div className="mt-1 font-semibold">
                      Nicht speicherbar: benoetigt mehr Calls als dein Limit erlaubt.
                      Waehle einen laengeren Zeitraum oder erhoehe das Limit in den API-Keys.
                    </div>
                  )}
                  {!exceeds && totalUsage > limit * 0.8 && limit > 0 && (
                    <div className="mt-1">
                      Achtung: nutzt {Math.round((totalUsage / limit) * 100)}% deines Tageslimits.
                    </div>
                  )}
                </div>
              )}

              <p className="mt-2 text-xs text-gray-400">
                Formel: <code>Lots × 2 (sold+stock) / Tage</code>. Teile mit aelteren Preisdaten werden bevorzugt aktualisiert.
              </p>
            </>
          );
        })()}
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

      {settingsLoaded && (
        <SellerCountriesSection
          initialCountries={sellerCountries}
          availableCountries={availableSellerCountries}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}

      <ApiTokensSection onError={setError} onSuccess={setSuccess} />

      {settingsLoaded && (
        <BsxImportSection
          initialDir={bsxOrdersDir}
          initialSource={bsxSource}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}

      {isAdmin && currentUserId > 0 && (
        <AdminSection currentUserId={currentUserId} onError={setError} onSuccess={setSuccess} />
      )}

      {isAdmin && (
        <BackupSection onError={setError} onSuccess={setSuccess} />
      )}

    </div>
  );
}
