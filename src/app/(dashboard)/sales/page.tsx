"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Receipt, Search, Upload, Check, AlertTriangle } from "lucide-react";
import { formatEur, formatDate } from "@/lib/formatters";

interface Kpi { revenue: number; qty: number; orders: number; itemLines: number }
interface Monthly { ym: string; revenue: number; qty: number; orders: number }
interface TopPart {
  part_no: string; color_id: number; color_name: string | null;
  item_type: string; new_or_used: string;
  qty: number; revenue: number; orders: number;
}
interface Sale {
  id: number; sold_at: string; platform: string; order_id: string;
  part_no: string; color_id: number; color_name: string | null;
  item_type: string; new_or_used: string;
  quantity: number; unit_price: number;
}

interface Data {
  kpi: { overall: Kpi; d30: Kpi; d90: Kpi; d180: Kpi };
  monthly: Monthly[];
  topParts: TopPart[];
  sales: Sale[];
  pagination: { total: number; limit: number; offset: number };
}

export default function SalesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<"" | "BL" | "BO">("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    ok: boolean; filesProcessed?: number; ordersProcessed?: number;
    itemsImported?: number; itemsSkipped?: number; partsCreated?: number;
    errorCount?: number; error?: string;
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (platform) params.set("platform", platform);
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/sales?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [platform, debouncedSearch, offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true); setUploadResult(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/sales/upload", { method: "POST", body: form });
      const data = await res.json();
      setUploadResult({ ok: res.ok, ...data });
      if (res.ok) fetchData();  // refresh list
    } catch {
      setUploadResult({ ok: false, error: "Netzwerkfehler" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const maxMonthlyRevenue = data?.monthly.length
    ? Math.max(...data.monthly.map(m => m.revenue), 1)
    : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Receipt className="h-6 w-6 text-gray-500" />
          <h1 className="text-2xl font-bold text-gray-900">Verkäufe</h1>
          {data && <span className="text-sm text-gray-500">· {data.pagination.total.toLocaleString("de-DE")} Einträge</span>}
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bsx"
            multiple
            className="hidden"
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            BSX-Orders hochladen
          </button>
        </div>
      </div>

      {uploadResult && (
        <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
          uploadResult.ok
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-red-200 bg-red-50 text-red-900"
        }`}>
          {uploadResult.ok ? <Check className="mt-0.5 h-4 w-4 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />}
          <div className="flex-1">
            {uploadResult.ok ? (
              <>
                <div className="font-medium">
                  {uploadResult.filesProcessed} Datei{uploadResult.filesProcessed !== 1 ? "en" : ""} verarbeitet
                </div>
                <div className="mt-0.5 text-xs">
                  {uploadResult.itemsImported} neue Items · {uploadResult.itemsSkipped} bereits da · {uploadResult.partsCreated} neue Parts
                  {uploadResult.errorCount && uploadResult.errorCount > 0 ? ` · ${uploadResult.errorCount} Fehler` : ""}
                </div>
              </>
            ) : (
              <div>{uploadResult.error || "Upload fehlgeschlagen"}</div>
            )}
          </div>
          <button onClick={() => setUploadResult(null)} className="text-current opacity-50 hover:opacity-100">×</button>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade…
        </div>
      )}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Letzte 30 Tage", kpi: data.kpi.d30 },
              { label: "Letzte 90 Tage", kpi: data.kpi.d90 },
              { label: "Letzte 180 Tage", kpi: data.kpi.d180 },
              { label: "Gesamt", kpi: data.kpi.overall },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] uppercase text-gray-400">{c.label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{formatEur(c.kpi.revenue)}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {c.kpi.qty.toLocaleString("de-DE")} Stk · {c.kpi.orders.toLocaleString("de-DE")} Orders
                </p>
              </div>
            ))}
          </div>

          {/* Monthly bars */}
          {data.monthly.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-semibold text-gray-900">Umsatz pro Monat (12 Monate)</h2>
              <div className="grid grid-cols-12 gap-2">
                {data.monthly.slice(-12).map((m) => (
                  <div key={m.ym} className="flex flex-col items-center">
                    <div className="flex h-32 w-full items-end">
                      <div
                        className="w-full rounded-t bg-blue-500 transition-all hover:bg-blue-600"
                        style={{ height: `${Math.max(2, (m.revenue / maxMonthlyRevenue) * 100)}%` }}
                        title={`${m.ym}: ${formatEur(m.revenue)} · ${m.qty} Stk · ${m.orders} Orders`}
                      />
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500">{m.ym.slice(5)}</div>
                    <div className="text-[10px] font-medium text-gray-700">{formatEur(m.revenue)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top parts */}
          {data.topParts.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-semibold text-gray-900">Top-10 verkaufte Teile (nach Menge)</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-[10px] uppercase text-gray-500">
                      <th className="pb-2 pr-4">Teil</th>
                      <th className="pb-2 pr-4">Farbe</th>
                      <th className="pb-2 pr-4">Typ</th>
                      <th className="pb-2 pr-4">Zustand</th>
                      <th className="pb-2 pr-4 text-right">Menge</th>
                      <th className="pb-2 pr-4 text-right">Orders</th>
                      <th className="pb-2 pr-4 text-right">Umsatz</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.topParts.map((t) => (
                      <tr key={`${t.part_no}-${t.color_id}-${t.new_or_used}`}>
                        <td className="py-1.5 pr-4 font-mono text-xs">{t.part_no}</td>
                        <td className="py-1.5 pr-4 text-xs text-gray-600">{t.color_name}</td>
                        <td className="py-1.5 pr-4 text-xs text-gray-500">{t.item_type}</td>
                        <td className="py-1.5 pr-4 text-xs text-gray-500">{t.new_or_used === "N" ? "Neu" : "Gebr."}</td>
                        <td className="py-1.5 pr-4 text-right text-xs font-medium">{t.qty}</td>
                        <td className="py-1.5 pr-4 text-right text-xs text-gray-500">{t.orders}</td>
                        <td className="py-1.5 pr-4 text-right text-xs font-medium">{formatEur(t.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Filters + Sales table */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-gray-900">Alle Verkäufe</h2>
              <div className="ml-auto flex items-center gap-2">
                <select value={platform} onChange={(e) => { setPlatform(e.target.value as "" | "BL" | "BO"); setOffset(0); }}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700">
                  <option value="">Alle Marktplätze</option>
                  <option value="BL">BrickLink</option>
                  <option value="BO">BrickOwl</option>
                </select>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Teil-Nr oder Farbe…"
                    className="rounded-lg border border-gray-300 bg-white pl-8 pr-3 py-1.5 text-sm text-gray-700" />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-[10px] uppercase text-gray-500">
                    <th className="pb-2 pr-4">Datum</th>
                    <th className="pb-2 pr-4">Markt</th>
                    <th className="pb-2 pr-4">Order</th>
                    <th className="pb-2 pr-4">Teil</th>
                    <th className="pb-2 pr-4">Farbe</th>
                    <th className="pb-2 pr-4">Zustand</th>
                    <th className="pb-2 pr-4 text-right">Menge</th>
                    <th className="pb-2 pr-4 text-right">Preis/Stk</th>
                    <th className="pb-2 pr-4 text-right">Zeile</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.sales.map((s) => (
                    <tr key={s.id}>
                      <td className="py-1.5 pr-4 text-xs text-gray-500">{formatDate(s.sold_at)}</td>
                      <td className="py-1.5 pr-4 text-xs">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${s.platform === "BL" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                          {s.platform}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-[10px] text-gray-500">{s.order_id}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs">{s.part_no}</td>
                      <td className="py-1.5 pr-4 text-xs text-gray-600">{s.color_name}</td>
                      <td className="py-1.5 pr-4 text-xs text-gray-500">{s.new_or_used === "N" ? "Neu" : "Gebr."}</td>
                      <td className="py-1.5 pr-4 text-right text-xs">{s.quantity}</td>
                      <td className="py-1.5 pr-4 text-right text-xs">{formatEur(s.unit_price)}</td>
                      <td className="py-1.5 pr-4 text-right text-xs font-medium">{formatEur(s.unit_price * s.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.sales.length === 0 && (
                <p className="py-6 text-center text-sm text-gray-500">Keine Verkäufe gefunden.</p>
              )}
            </div>

            {data.pagination.total > LIMIT && (
              <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                <span>
                  {offset + 1}–{Math.min(offset + LIMIT, data.pagination.total)} von {data.pagination.total.toLocaleString("de-DE")}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0}
                    className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50">
                    ← Zurück
                  </button>
                  <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.pagination.total}
                    className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50">
                    Weiter →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
