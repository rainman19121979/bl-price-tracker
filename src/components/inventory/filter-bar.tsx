"use client";

import { Search } from "lucide-react";

interface FilterBarProps {
  searchInput: string;
  setSearchInput: (value: string) => void;
  handleSearch: (e: React.FormEvent) => void;
  showFilters: boolean;
  setShowFilters: (value: boolean) => void;
  filterCondition: "" | "N" | "U";
  setFilterCondition: (value: "" | "N" | "U") => void;
  filterType: "" | "PART" | "MINIFIG" | "SET";
  setFilterType: (value: "" | "PART" | "MINIFIG" | "SET") => void;
  filterTrend: "" | "up" | "down" | "stable";
  setFilterTrend: (value: "" | "up" | "down" | "stable") => void;
  filterData: "" | "with" | "without";
  setFilterData: (value: "" | "with" | "without") => void;
  filterDiff: "" | "over" | "under";
  setFilterDiff: (value: "" | "over" | "under") => void;
  filterDesc: "" | "with" | "without";
  setFilterDesc: (value: "" | "with" | "without") => void;
  filterSale: "" | "with" | "without";
  setFilterSale: (value: "" | "with" | "without") => void;
  filterLocked: "" | "yes" | "no";
  setFilterLocked: (value: "" | "yes" | "no") => void;
  filterCompleteness: "" | "C" | "I" | "S";
  setFilterCompleteness: (value: "" | "C" | "I" | "S") => void;
}

export function FilterBar({
  searchInput,
  setSearchInput,
  handleSearch,
  showFilters,
  setShowFilters,
  filterCondition,
  setFilterCondition,
  filterType,
  setFilterType,
  filterTrend,
  setFilterTrend,
  filterData,
  setFilterData,
  filterDiff,
  setFilterDiff,
  filterDesc,
  setFilterDesc,
  filterSale,
  setFilterSale,
  filterLocked,
  setFilterLocked,
  filterCompleteness,
  setFilterCompleteness,
}: FilterBarProps) {
  const hasActiveFilters = filterCondition || filterTrend || filterData || filterDiff || filterType || filterDesc || filterSale || filterLocked || filterCompleteness;

  return (
    <>
      {/* Search + Filter Toggle */}
      <div className="flex gap-2">
        <form onSubmit={handleSearch} className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Teil-Nr, Name oder Farbe suchen..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </form>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            showFilters || hasActiveFilters
              ? "border-blue-300 bg-blue-50 text-blue-600"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          Filter {hasActiveFilters && "\u00b7"}
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <select value={filterCondition} onChange={(e) => setFilterCondition(e.target.value as typeof filterCondition)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none">
            <option value="">Alle Zustaende</option>
            <option value="N">Neu</option>
            <option value="U">Gebraucht</option>
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none">
            <option value="">Alle Typen</option>
            <option value="PART">Part</option>
            <option value="MINIFIG">Minifig</option>
            <option value="SET">Set</option>
          </select>
          <select value={filterTrend} onChange={(e) => setFilterTrend(e.target.value as typeof filterTrend)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none">
            <option value="">Alle Trends</option>
            <option value="up">Steigend &#8599;</option>
            <option value="down">Sinkend &#8600;</option>
            <option value="stable">Stabil &#8594;</option>
          </select>
          <select value={filterData} onChange={(e) => setFilterData(e.target.value as typeof filterData)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none">
            <option value="">Preisdaten</option>
            <option value="with">Mit Preisdaten</option>
            <option value="without">Ohne Preisdaten</option>
          </select>
          <select value={filterDiff} onChange={(e) => setFilterDiff(e.target.value as typeof filterDiff)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none">
            <option value="">Preis vs. Empf.</option>
            <option value="over">Ueber Empfehlung</option>
            <option value="under">Unter Empfehlung</option>
          </select>
          <select value={filterDesc} onChange={(e) => setFilterDesc(e.target.value as typeof filterDesc)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none">
            <option value="">Description</option>
            <option value="with">Mit Description</option>
            <option value="without">Ohne Description</option>
          </select>
          <select value={filterSale} onChange={(e) => setFilterSale(e.target.value as typeof filterSale)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none">
            <option value="">Rabatt</option>
            <option value="with">Mit Rabatt</option>
            <option value="without">Ohne Rabatt</option>
          </select>
          <select value={filterLocked} onChange={(e) => setFilterLocked(e.target.value as typeof filterLocked)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none">
            <option value="">Preis gesperrt</option>
            <option value="yes">Gesperrt</option>
            <option value="no">Nicht gesperrt</option>
          </select>
          <select value={filterCompleteness} onChange={(e) => setFilterCompleteness(e.target.value as typeof filterCompleteness)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
            title="Nur relevant bei SETs (C/I/S). Andere Item-Typen ignorieren diesen Filter.">
            <option value="">Completeness (SETs)</option>
            <option value="C">Complete</option>
            <option value="I">Incomplete</option>
            <option value="S">Sealed</option>
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterCondition(""); setFilterTrend(""); setFilterData(""); setFilterDiff(""); setFilterType(""); setFilterDesc(""); setFilterSale(""); setFilterLocked(""); setFilterCompleteness(""); }}
              className="rounded border border-gray-300 px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50"
            >
              Zuruecksetzen
            </button>
          )}
        </div>
      )}
    </>
  );
}
