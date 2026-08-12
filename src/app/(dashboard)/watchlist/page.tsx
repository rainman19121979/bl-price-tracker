"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload, Download, Loader2, Package,
  ArrowUp, ArrowDown,
} from "lucide-react";
import type { WatchlistItem, SortField, SortDir } from "@/types/watchlist";
import { InventoryValueCards } from "@/components/inventory/inventory-value-cards";
import { FilterBar } from "@/components/inventory/filter-bar";
import { WatchlistRow } from "@/components/inventory/watchlist-row";


export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [freshDays, setFreshDays] = useState(14);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<SortField>("partNo");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterCondition, setFilterCondition] = useState<"" | "N" | "U">("");
  const [filterTrend, setFilterTrend] = useState<"" | "up" | "down" | "stable">("");
  const [filterData, setFilterData] = useState<"" | "with" | "without">("");
  const [filterDiff, setFilterDiff] = useState<"" | "over" | "under">("");
  const [filterType, setFilterType] = useState<"" | "PART" | "MINIFIG" | "SET">("");
  const [filterDesc, setFilterDesc] = useState<"" | "with" | "without">("");
  const [filterSale, setFilterSale] = useState<"" | "with" | "without">("");
  const [filterLocked, setFilterLocked] = useState<"" | "yes" | "no">("");
  const [showFilters, setShowFilters] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [inventoryValue, setInventoryValue] = useState<{
    myValue: number;
    soldMedianValue: number; soldQtyAvgValue: number;
    stockMedianValue: number; stockQtyAvgValue: number;
    formulaValue: number | null;
  } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(1);

  // Map frontend sort fields to API sort params
  const sortApiMap: Record<SortField, string> = {
    partNo: "partNo",
    name: "name",
    condition: "condition",
    myPrice: "myPrice",
    marketPrice: "marketPrice",
    diff: "diff",
    quantity: "quantity",
    age: "age",
  };

  const fetchItems = useCallback(async (page: number, append: boolean) => {
    if (page === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "60",
        sort: sortApiMap[sort],
        dir: sortDir,
      });
      if (search) params.set("q", search);
      if (filterCondition) params.set("condition", filterCondition);
      if (filterType) params.set("itemType", filterType);

      // Pass server-side filters
      if (filterData) params.set("hasData", filterData);
      if (filterDesc) params.set("hasDesc", filterDesc);
      if (filterSale) params.set("hasSale", filterSale);
      if (filterLocked) params.set("locked", filterLocked);
      if (filterTrend) params.set("trend", filterTrend);
      if (filterDiff) params.set("diff", filterDiff);

      const res = await fetch(`/api/watchlist?${params}`);
      if (res.ok) {
        const data = await res.json();
        const newItems: WatchlistItem[] = data.watchlist || [];

        if (data.freshDays) setFreshDays(data.freshDays);
        setItems((prev) => append ? [...prev, ...newItems] : newItems);
        setTotal(data.pagination.total);
        setHasMore(page < data.pagination.totalPages);
        pageRef.current = page;
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort, sortDir, filterCondition, filterTrend, filterData, filterDiff, filterType, filterDesc, filterSale, filterLocked]);

  const fetchValue = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist/value");
      if (res.ok) setInventoryValue(await res.json());
    } catch { /* ignore */ }
  }, []);

  // Initial load + reset on sort/search change
  useEffect(() => {
    fetchItems(1, false);
    fetchValue();
  }, [fetchItems, fetchValue]);

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          fetchItems(pageRef.current + 1, true);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, fetchItems]);

  const handleSort = (field: SortField) => {
    if (sort === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(field);
      setSortDir("asc");
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/inventory/import", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `${data.added} Teile importiert, ${data.skipped} bereits vorhanden.` });
        fetchItems(1, false);
      } else {
        setMessage({ type: "error", text: data.error });
      }
    } catch {
      setMessage({ type: "error", text: "Netzwerkfehler" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRefreshPrice = async (item: WatchlistItem) => {
    setRefreshing(item.id);
    try {
      await fetch(`/api/prices/${item.part.partNo}/${item.part.colorId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOrUsed: item.newOrUsed }),
      });
      // Update just this item inline
      const res = await fetch(`/api/watchlist?q=${item.part.partNo}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        const updated = (data.watchlist as WatchlistItem[]).find((w) => w.id === item.id);
        if (updated) {
          setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
        }
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(null);
    }
  };

  const handlePriceLockChange = async (id: number, priceLocked: boolean) => {
    try {
      await fetch(`/api/watchlist/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceLocked }),
      });
      setItems(prev => prev.map(i => i.id === id ? { ...i, priceLocked } : i));
    } catch { /* ignore */ }
  };

  const handleSaleRateChange = async (id: number, saleRate: number) => {
    try {
      await fetch(`/api/watchlist/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleRate }),
      });
      setItems(prev => prev.map(i => i.id === id ? { ...i, saleRate } : i));
    } catch { /* ignore */ }
  };

  const SortHeader = ({ field, label, align = "left" }: { field: SortField; label: string; align?: string }) => (
    <th
      className={`px-3 py-3 text-${align} text-xs font-medium uppercase tracking-wider text-gray-500 cursor-pointer select-none hover:text-gray-700 transition-colors`}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort === field && (
          sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        )}
      </span>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BL-Inventar</h1>
          <p className="mt-1 text-sm text-gray-500">
            {total > 0 ? `${total.toLocaleString("de-DE")} Lots` : "Keine Teile"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/watchlist/export-bsx" download
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <Download size={14} />
            BSX Export
          </a>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            BSX/CSV
            <input type="file" accept=".bsx,.xml,.csv" onChange={handleFileUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
      </div>

      {/* Inventory Value */}
      <InventoryValueCards value={inventoryValue} />

      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          message.type === "success" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-600"
        }`}>{message.text}</div>
      )}

      {/* Search + Filters */}
      <FilterBar
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        handleSearch={handleSearch}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        filterCondition={filterCondition}
        setFilterCondition={setFilterCondition}
        filterType={filterType}
        setFilterType={setFilterType}
        filterTrend={filterTrend}
        setFilterTrend={setFilterTrend}
        filterData={filterData}
        setFilterData={setFilterData}
        filterDiff={filterDiff}
        setFilterDiff={setFilterDiff}
        filterDesc={filterDesc}
        setFilterDesc={setFilterDesc}
        filterSale={filterSale}
        setFilterSale={setFilterSale}
        filterLocked={filterLocked}
        setFilterLocked={setFilterLocked}
      />

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr className="border-b border-gray-200">
                <SortHeader field="partNo" label="Part" />
                <SortHeader field="name" label="Name" />
                <SortHeader field="condition" label="Zust." align="center" />
                <SortHeader field="myPrice" label="Mein Preis" align="right" />
                <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Rabatt</th>
                <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500" title="Preis gesperrt — beim Export wird mein Preis verwendet">🔒</th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Empf.</th>
                <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Trend</th>
                <SortHeader field="quantity" label="Menge" align="right" />
                <SortHeader field="age" label="Alter" align="center" />
                <th className="px-3 py-3 text-right text-xs font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={16} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={16} className="py-12 text-center">
                    <Package size={24} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-500">{search ? "Keine Ergebnisse" : "Inventar leer"}</p>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <WatchlistRow
                    key={item.id}
                    item={item}
                    refreshing={refreshing === item.id}
                    freshDays={freshDays}
                    onRefresh={handleRefreshPrice}
                    onSaleRateChange={handleSaleRateChange}
                    onPriceLockChange={handlePriceLockChange}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-1" />
        {loadingMore && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        )}
        {!hasMore && items.length > 0 && (
          <div className="py-3 text-center text-xs text-gray-400">
            Alle {total.toLocaleString("de-DE")} Eintraege geladen
          </div>
        )}
      </div>
    </div>
  );
}
