"use client";

import { useEffect, useState, useCallback } from "react";
import { Clock, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { fmt } from "@/lib/formatters";
import { DashboardAnalytics } from "@/components/dashboard/analytics-section";

interface Stats {
  watchlistCount: number;
  withoutPrice: number;
  freshPrice: number;
  stalePrice: number;
  requestsToday: number;
  dailyLimit: number;
  externalCallsPerDay: number;
  freshDays: number;
  estimatedCycleDays: number;
  maintenanceCallsPerDay: number;
  etaDays: number;
  callsPerDay24h: number;
  partsWithPrice: number;
  partsNeedUpdate: number;
  doneTodaySold: number;
  doneTodayStock: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/stats");
      if (res.ok) setStats(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>;
  }

  if (!stats) {
    return <p className="text-gray-500">Daten konnten nicht geladen werden</p>;
  }

  const totalEstimated = stats.requestsToday + (stats.externalCallsPerDay || 0);
  const coveragePct = stats.watchlistCount > 0 ? ((stats.watchlistCount - stats.partsNeedUpdate) / stats.watchlistCount) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            {fmt(stats.watchlistCount)} Lots im Inventar
          </p>
        </div>
      </div>

      {/* Crawler Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">API Calls (24h)</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {fmt(totalEstimated)}
            <span className="text-lg text-gray-400"> / {fmt(stats.dailyLimit)}</span>
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {fmt(stats.requestsToday)} Tracker{stats.externalCallsPerDay > 0 && ` + ~${fmt(stats.externalCallsPerDay)} extern`} — verbleibend: ~{fmt(Math.max(0, stats.dailyLimit - totalEstimated))}
          </p>
          <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, (stats.requestsToday / stats.dailyLimit) * 100)}%` }} />
            {stats.externalCallsPerDay > 0 && (
              <div className="h-full bg-orange-300 transition-all" style={{ width: `${Math.min(100 - (stats.requestsToday / stats.dailyLimit) * 100, (stats.externalCallsPerDay / stats.dailyLimit) * 100)}%` }} />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Aktualisiert (24h)</p>
          <div className="mt-2 flex items-baseline gap-3">
            <div>
              <span className="text-3xl font-bold text-green-600">{fmt(stats.doneTodaySold)}</span>
              <span className="ml-1 text-xs text-gray-400">Sold</span>
            </div>
            <span className="text-gray-300">|</span>
            <div>
              <span className="text-3xl font-bold text-blue-500">{fmt(stats.doneTodayStock)}</span>
              <span className="ml-1 text-xs text-gray-400">Stock</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Brauchen Update</p>
          <p className="mt-2 text-3xl font-bold text-yellow-600">{fmt(stats.partsNeedUpdate)}</p>
          <p className="mt-1 text-xs text-gray-400">
            ohne oder aelter als {stats.freshDays} Tage
          </p>
        </div>
      </div>

      {/* Aktualisierungszyklus + Preisabdeckung */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Crawler Status</p>
          {stats.partsNeedUpdate > 0 ? (
            <>
              <p className="mt-2 text-3xl font-bold text-blue-600">
                {stats.etaDays > 0 ? `~${stats.etaDays} Tage` : "Berechne..."}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                bis restliche {fmt(stats.partsNeedUpdate)} Lots gecrawlt ({fmt(stats.callsPerDay24h)} Calls/Tag aktuell)
              </p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${Math.min(100, ((stats.watchlistCount - stats.partsNeedUpdate) / stats.watchlistCount) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {fmt(stats.watchlistCount - stats.partsNeedUpdate)} / {fmt(stats.watchlistCount)} fertig
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-3xl font-bold text-green-600">Erhaltung</p>
              <p className="mt-1 text-xs text-gray-500">
                ~{fmt(stats.maintenanceCallsPerDay)} Calls/Tag fuer {fmt(stats.watchlistCount)} Lots in {stats.freshDays} Tagen
              </p>
            </>
          )}
        </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Preisabdeckung</span>
          <span className="font-medium text-gray-900">{coveragePct.toFixed(1)}% aktuell</span>
        </div>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-1000"
            style={{ width: `${Math.min(100, coveragePct)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-400">
          {fmt(stats.partsWithPrice)} von {fmt(stats.watchlistCount)} Teilen haben Preisdaten
        </p>
      </div>
      </div>

      {/* Inventar-Status Detail */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Ohne Preisdaten</p>
            <AlertTriangle size={18} className={stats.withoutPrice > 0 ? "text-red-500" : "text-gray-300"} />
          </div>
          <p className="mt-2 text-3xl font-bold text-red-600">{fmt(stats.withoutPrice)}</p>
          <p className="mt-1 text-xs text-gray-400">Nie gecrawlt</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Aktuell</p>
            <CheckCircle size={18} className="text-green-500" />
          </div>
          <p className="mt-2 text-3xl font-bold text-green-600">{fmt(stats.freshPrice)}</p>
          <p className="mt-1 text-xs text-gray-400">Preis &lt; {stats.freshDays} Tage alt</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Veraltet</p>
            <Clock size={18} className={stats.stalePrice > 0 ? "text-yellow-500" : "text-gray-300"} />
          </div>
          <p className="mt-2 text-3xl font-bold text-yellow-600">{fmt(stats.stalePrice)}</p>
          <p className="mt-1 text-xs text-gray-400">Preis &gt; {stats.freshDays} Tage alt</p>
        </div>

      </div>

      {/* Analytics */}
      <DashboardAnalytics />
    </div>
  );
}
