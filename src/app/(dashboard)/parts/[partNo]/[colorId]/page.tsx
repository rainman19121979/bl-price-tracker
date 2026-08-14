"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PartImage } from "@/components/part-image";
// NOTE: dynamic() lazy-loading for these chart components was attempted but caused
// hydration issues with Next.js 14. Keeping static imports for now.
import { PriceHistoryChart } from "@/components/charts/price-history-chart";
import { VolumeChart } from "@/components/charts/volume-chart";
import { formatEur, formatDate, formatDiffPercent } from "@/lib/formatters";

interface PartInfo {
  partNo: string;
  colorId: number;
  itemType: string;
  partName: string | null;
  colorName: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  lastPriceUpdate: string | null;
}

interface PriceData {
  fetchDate: string;
  avgPrice: string;
  medianPrice: string;
  minPrice: string;
  maxPrice: string;
  qtyAvgPrice: string;
  unitQuantity: number;
  totalQuantity: number;
}

interface StockData {
  avgPrice: number;
  medianPrice: number;
  qtyAvgPrice: number;
  totalOffers: number;
  totalQuantity: number;
}

interface Sale {
  id: string;
  dateOrdered: string;
  unitPrice: string;
  quantity: number;
  buyerCountry: string | null;
  newOrUsed: string;
  sellerCountry: string;
  isMine?: boolean;
}

export default function PartDetailPage() {
  const params = useParams<{ partNo: string; colorId: string }>();
  const searchParams = useSearchParams();
  const completenessParam = searchParams.get("completeness");
  const completeness: "C" | "I" | "S" | null =
    completenessParam === "C" || completenessParam === "I" || completenessParam === "S"
      ? completenessParam
      : null;
  const { partNo, colorId } = params;
  const condition = searchParams.get("condition") || "U";

  const [part, setPart] = useState<PartInfo | null>(null);
  const [price, setPrice] = useState<PriceData | null>(null);
  const [stockPrice, setStockPrice] = useState<StockData | null>(null);
  const [myPrice, setMyPrice] = useState<number | null>(null);
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const [chartData, setChartData] = useState<{ date: string; avgPriceNew?: number; avgPriceUsed?: number; minPriceNew?: number; maxPriceNew?: number; minPriceUsed?: number; maxPriceUsed?: number }[]>([]);
  const [volumeData, setVolumeData] = useState<{ date: string; quantityNew?: number; quantityUsed?: number }[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesPage, setSalesPage] = useState(1);
  const [salesTotalPages, setSalesTotalPages] = useState(0);
  const [stockItems, setStockItems] = useState<{ unitPrice: number; quantity: number; isMine?: boolean }[]>([]);
  const [tableTab, setTableTab] = useState<"sales" | "stock">("sales");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ sellerCountries: string[] | null; shippingCountries: string[] | null }>({ sellerCountries: null, shippingCountries: null });

  const soldLabel = (() => {
    const parts: string[] = [];
    if (filters.sellerCountries) parts.push(`Verk.: ${filters.sellerCountries.join(",")}`);
    if (filters.shippingCountries) parts.push(`Käufer: ${filters.shippingCountries.join(",")}`);
    return parts.length ? ` (${parts.join(" | ")})` : " (weltweit)";
  })();
  const stockLabel = filters.sellerCountries ? ` (${filters.sellerCountries.join(",")})` : " (weltweit)";

  const conditionLabel = condition === "N" ? "Neu" : "Gebraucht";
  const conditionColor = condition === "N" ? "green" : "amber";

  const fetchPartData = useCallback(async () => {
    try {
      // Completeness-Query-Param für alle relevanten Endpoints (nur bei SETs
      // wirksam, sonst serverseitig ignoriert)
      const compQuery = completeness ? `&completeness=${completeness}` : "";
      // All 5 API calls in parallel
      const [priceRes, historyRes, watchlistRes, stockRes, salesRes] = await Promise.all([
        fetch(`/api/prices/${partNo}/${colorId}${completeness ? `?completeness=${completeness}` : ""}`),
        fetch(`/api/prices/${partNo}/${colorId}/history?days=365${compQuery}`),
        fetch(`/api/watchlist?q=${encodeURIComponent(partNo)}&limit=10&condition=${condition}`),
        fetch(`/api/prices/${partNo}/${colorId}/stock?condition=${condition}${compQuery}`),
        fetch(`/api/prices/${partNo}/${colorId}/sales?${new URLSearchParams({ page: "1", limit: "30", condition })}${compQuery}`),
      ]);

      if (priceRes.ok) {
        const data = await priceRes.json();
        setPart(data.part);
        setPrice(condition === "N" ? data.prices?.new : data.prices?.used);
        setStockPrice(condition === "N" ? data.stock?.new : data.stock?.used);
        if (data.filters) setFilters(data.filters);
      }

      if (stockRes.ok) {
        const stockData = await stockRes.json();
        setStockItems(stockData.items || []);
      }

      if (salesRes.ok) {
        const data = await salesRes.json();
        setSales(data.sales);
        setSalesTotal(data.total);
        setSalesPage(data.page);
        setSalesTotalPages(data.totalPages);
      }

      if (watchlistRes.ok) {
        const wData = await watchlistRes.json();
        const colorIdNum = parseInt(colorId, 10);
        const match = (wData.watchlist || []).find(
          (w: { part: { partNo: string; colorId: number }; newOrUsed: string }) =>
            w.part.partNo === partNo &&
            w.part.colorId === colorIdNum &&
            w.newOrUsed === condition
        );
        setMyPrice(match?.myPrice != null ? parseFloat(String(match.myPrice)) : null);
        setSuggestedPrice(match?.suggestedPrice ?? null);
      }

      if (historyRes.ok) {
        const data = await historyRes.json();
        const historyEntries = condition === "N" ? (data.new || []) : (data.used || []);

        const chartPoints = historyEntries.map((h: { fetchDate: string; avgPrice: string; minPrice: string; maxPrice: string; totalQuantity: number }) => ({
          date: h.fetchDate.split("T")[0],
          ...(condition === "N"
            ? { avgPriceNew: parseFloat(h.avgPrice), minPriceNew: parseFloat(h.minPrice), maxPriceNew: parseFloat(h.maxPrice) }
            : { avgPriceUsed: parseFloat(h.avgPrice), minPriceUsed: parseFloat(h.minPrice), maxPriceUsed: parseFloat(h.maxPrice) }
          ),
        }));

        const volPoints = historyEntries.map((h: { fetchDate: string; totalQuantity: number }) => ({
          date: h.fetchDate.split("T")[0],
          ...(condition === "N"
            ? { quantityNew: h.totalQuantity }
            : { quantityUsed: h.totalQuantity }
          ),
        }));

        setChartData(chartPoints);
        setVolumeData(volPoints);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [partNo, colorId, condition, completeness]);

  const fetchSales = useCallback(async (page: number) => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: "30", condition });
      if (completeness) params.set("completeness", completeness);
      const res = await fetch(`/api/prices/${partNo}/${colorId}/sales?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSales(data.sales);
        setSalesTotal(data.total);
        setSalesPage(data.page);
        setSalesTotalPages(data.totalPages);
      }
    } catch {
      // ignore
    }
  }, [partNo, colorId, condition, completeness]);

  useEffect(() => { fetchPartData(); }, [fetchPartData]);

  if (loading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <div>
        <Link href="/watchlist" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ChevronLeft size={16} /> Inventar
        </Link>
      </div>

      {/* Part Info + Price */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-6">
          <PartImage partNo={partNo} colorId={parseInt(colorId, 10)} itemType={part?.itemType} size="lg" className="shrink-0 rounded-lg" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">
              {part?.partName || `Part ${partNo}`}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {part?.colorName || `Farbe ID: ${colorId}`}
              {part?.categoryName && ` · ${part.categoryName}`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-3 py-1 font-medium bg-${conditionColor}-100 text-${conditionColor}-700`}>
                {conditionLabel}
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-600">
                {partNo} · {part?.colorName || colorId}
              </span>
              {/* Completeness-Auswahl nur bei SETs anzeigen */}
              {part?.itemType === "SET" && (
                <div className="inline-flex rounded-full border border-gray-200 bg-white p-0.5">
                  {(["C", "I", "S"] as const).map((c) => {
                    const active = (completeness ?? "C") === c;
                    const label = c === "C" ? "Kompl." : c === "I" ? "Unvoll." : "Sealed";
                    const title = c === "C" ? "Complete (kompletter Bausatz)" : c === "I" ? "Incomplete (unvollständig)" : "Sealed (versiegelt in OVP)";
                    return (
                      <Link
                        key={c}
                        href={`/parts/${partNo}/${colorId}?condition=${condition}&completeness=${c}`}
                        title={title}
                        className={`rounded-full px-3 py-1 font-medium transition-colors ${
                          active
                            ? c === "S" ? "bg-purple-100 text-purple-700"
                              : c === "C" ? "bg-blue-100 text-blue-700"
                              : "bg-orange-100 text-orange-700"
                            : "text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Price Cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Sold */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <span className="text-xs font-semibold uppercase text-blue-600">Verkauft (6 Monate){soldLabel}</span>
            {price ? (
              <div className="mt-2">
                <div className="flex items-baseline gap-6">
                  <div>
                    <span className="text-[10px] uppercase text-gray-400">Median</span>
                    <p className="text-2xl font-bold text-gray-900">{formatEur(price.medianPrice)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-gray-400">Ø</span>
                    <p className="text-lg font-semibold text-gray-700">{formatEur(price.avgPrice)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-gray-400">Gew. Ø</span>
                    <p className="text-lg font-semibold text-gray-700">{formatEur(price.qtyAvgPrice)}</p>
                  </div>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-gray-500">
                  <span>Min: <span className="font-mono">{formatEur(price.minPrice)}</span></span>
                  <span>Max: <span className="font-mono">{formatEur(price.maxPrice)}</span></span>
                  <span>{price.totalQuantity} Stk</span>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-400">Keine Daten</p>
            )}
          </div>

          {/* Stock */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <span className="text-xs font-semibold uppercase text-purple-600">Aktuelle Angebote{stockLabel}</span>
            {stockPrice ? (
              <div className="mt-2">
                <div className="flex items-baseline gap-6">
                  <div>
                    <span className="text-[10px] uppercase text-gray-400">Median</span>
                    <p className="text-2xl font-bold text-gray-900">{formatEur(stockPrice.medianPrice)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-gray-400">Ø</span>
                    <p className="text-lg font-semibold text-gray-700">{formatEur(stockPrice.avgPrice)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-gray-400">Gew. Ø</span>
                    <p className="text-lg font-semibold text-gray-700">{formatEur(stockPrice.qtyAvgPrice)}</p>
                  </div>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-gray-500">
                  <span>{stockPrice.totalOffers} Angebote</span>
                  <span>{stockPrice.totalQuantity} Stk verfuegbar</span>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-400">Keine Daten</p>
            )}
          </div>
        </div>

        {/* Mein Preis + Diffs */}
        {myPrice != null && (price || stockPrice) && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-baseline gap-6">
              <p className="text-sm font-semibold uppercase text-gray-500">Mein Preis: <span className="text-xl font-bold text-gray-900">{formatEur(myPrice)}</span></p>
              {suggestedPrice != null && suggestedPrice > 0 && (
                <p className="text-sm font-semibold uppercase text-gray-500">Empf: <span className={`text-xl font-bold ${suggestedPrice > myPrice ? "text-green-600" : suggestedPrice < myPrice ? "text-red-600" : "text-gray-900"}`}>{formatEur(suggestedPrice)}</span>
                  <span className={`ml-2 text-xs ${suggestedPrice > myPrice ? "text-green-600" : "text-red-600"}`}>
                    ({suggestedPrice > myPrice ? "+" : ""}{(((suggestedPrice - myPrice) / myPrice) * 100).toFixed(0)}%)
                  </span>
                </p>
              )}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-4 text-sm lg:grid-cols-6">
              {price && (() => {
                const dM = formatDiffPercent(myPrice, parseFloat(price.medianPrice));
                const dA = formatDiffPercent(myPrice, parseFloat(price.avgPrice));
                const dQ = formatDiffPercent(myPrice, parseFloat(price.qtyAvgPrice));
                return (
                  <>
                    <div>
                      <span className="text-xs text-gray-400">vs. Verk. Med.</span>
                      <p className={`font-semibold ${dM.colorClass}`}>{dM.text}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">vs. Verk. Ø</span>
                      <p className={`font-semibold ${dA.colorClass}`}>{dA.text}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">vs. Verk. Gew.</span>
                      <p className={`font-semibold ${dQ.colorClass}`}>{dQ.text}</p>
                    </div>
                  </>
                );
              })()}
              {stockPrice && (() => {
                const dSM = formatDiffPercent(myPrice, stockPrice.medianPrice);
                const dSA = formatDiffPercent(myPrice, stockPrice.avgPrice);
                const dSQ = formatDiffPercent(myPrice, stockPrice.qtyAvgPrice);
                return (
                  <>
                    <div>
                      <span className="text-xs text-gray-400">vs. Angeb. Med.</span>
                      <p className={`font-semibold ${dSM.colorClass}`}>{dSM.text}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">vs. Angeb. Ø</span>
                      <p className={`font-semibold ${dSA.colorClass}`}>{dSA.text}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">vs. Angeb. Gew.</span>
                      <p className={`font-semibold ${dSQ.colorClass}`}>{dSQ.text}</p>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Price History Chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Preisverlauf — {conditionLabel}</h2>
        <p className="mt-1 text-sm text-gray-500">Durchschnittspreise der letzten 12 Monate</p>
        <div className="mt-4">
          <PriceHistoryChart data={chartData} />
        </div>
      </div>

      {/* Volume Chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Verkaufsvolumen — {conditionLabel}</h2>
        <p className="mt-1 text-sm text-gray-500">Stueckzahl pro Tag</p>
        <div className="mt-4">
          <VolumeChart data={volumeData} />
        </div>
      </div>

      {/* Sales / Stock Table with Tabs */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTableTab("sales")}
            className={`flex-1 px-6 py-3.5 text-sm font-medium transition-colors ${
              tableTab === "sales" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Verkaeufe ({salesTotal})
          </button>
          <button
            onClick={() => setTableTab("stock")}
            className={`flex-1 px-6 py-3.5 text-sm font-medium transition-colors ${
              tableTab === "stock" ? "border-b-2 border-purple-600 text-purple-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Angebote ({stockItems.length})
          </button>
        </div>

        <div className="overflow-x-auto">
          {tableTab === "sales" ? (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-2.5">Datum</th>
                    <th className="px-4 py-2.5 text-right">Preis</th>
                    <th className="px-4 py-2.5 text-right">Menge</th>
                    <th className="px-4 py-2.5">Kaeufer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sales.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Keine Verkaufsdaten</td></tr>
                  ) : (
                    sales.map((sale, i) => (
                      <tr key={`${sale.id}-${i}`} className={`hover:bg-gray-50 ${sale.isMine ? "bg-blue-50 text-blue-700" : "text-gray-600"}`}>
                        <td className="px-4 py-2">{formatDate(sale.dateOrdered)}{sale.isMine && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">Mein Verkauf</span>}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">{formatEur(sale.unitPrice)}</td>
                        <td className="px-4 py-2 text-right">{sale.quantity}</td>
                        <td className="px-4 py-2 text-gray-400">{sale.buyerCountry || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {salesTotalPages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
                  <p className="text-xs text-gray-400">Seite {salesPage} von {salesTotalPages}</p>
                  <div className="flex gap-1">
                    <button onClick={() => fetchSales(salesPage - 1)} disabled={salesPage <= 1}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                      <ChevronLeft size={16} />
                    </button>
                    <button onClick={() => fetchSales(salesPage + 1)} disabled={salesPage >= salesTotalPages}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-2.5 text-right">#</th>
                  <th className="px-4 py-2.5 text-right">Preis</th>
                  <th className="px-4 py-2.5 text-right">Menge</th>
                  <th className="px-4 py-2.5 text-right">Wert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stockItems.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Keine Angebotsdaten</td></tr>
                ) : (
                  stockItems.map((item, i) => (
                    <tr key={i} className={`hover:bg-gray-50 ${item.isMine ? "bg-blue-50 text-blue-700" : "text-gray-600"}`}>
                      <td className="px-4 py-2 text-right text-gray-400">{i + 1}{item.isMine && <span className="ml-1 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-600">Ich</span>}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-900">{formatEur(item.unitPrice)}</td>
                      <td className="px-4 py-2 text-right">{item.quantity}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-500">{formatEur(item.unitPrice * item.quantity)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
