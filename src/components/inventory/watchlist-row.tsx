"use client";

import { useMemo, useState } from "react";
import { Loader2, RotateCw, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import Link from "next/link";
import { PartImage } from "@/components/part-image";
import { timeAgo, dataAgeColor } from "@/lib/formatters";
import type { WatchlistItem } from "@/types/watchlist";

interface WatchlistRowProps {
  item: WatchlistItem;
  refreshing: boolean;
  freshDays: number;
  onRefresh: (item: WatchlistItem) => void;
  onSaleRateChange?: (id: number, saleRate: number) => void;
  onPriceLockChange?: (id: number, priceLocked: boolean) => void;
}

export function WatchlistRow({ item, refreshing, freshDays, onRefresh, onSaleRateChange, onPriceLockChange }: WatchlistRowProps) {
  const [editingSale, setEditingSale] = useState(false);
  const [saleValue, setSaleValue] = useState(String(item.saleRate || 0));
  const { myPrice, suggested, diffSugg, med, qtyAvg, sMed, sQtyAvg, diffMed, diffQty, diffSMed, diffSQty } = useMemo(() => {
    const myP = item.myPrice ? parseFloat(item.myPrice) : null;
    const m = item.marketMedian;
    const qa = item.marketQtyAvg;
    const sm = item.stockMedian;
    const sqa = item.stockQtyAvg;
    const sug = item.suggestedPrice ?? null;

    const pct = (a: number | null, b: number | null) =>
      a && b && b > 0 ? ((a - b) / b) * 100 : null;

    return {
      myPrice: myP,
      suggested: sug,
      diffSugg: pct(myP, sug),
      med: m,
      qtyAvg: qa,
      sMed: sm,
      sQtyAvg: sqa,
      diffMed: pct(myP, m),
      diffQty: pct(myP, qa),
      diffSMed: pct(myP, sm),
      diffSQty: pct(myP, sqa),
    };
  }, [item.myPrice, item.suggestedPrice, item.marketMedian, item.marketQtyAvg, item.stockMedian, item.stockQtyAvg]);

  const diffColor = (d: number | null) =>
    d === null ? "" : d > 5 ? "text-red-600" : d < -5 ? "text-green-600" : "text-gray-500";

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <PartImage partNo={item.part.partNo} colorId={item.part.colorId} itemType={item.part.itemType} size="md" />
          <div>
            <Link href={`/parts/${item.part.partNo}/${item.part.colorId}?condition=${item.newOrUsed}`}
              className="font-mono text-sm text-blue-600 hover:text-blue-700">
              {item.part.partNo}
            </Link>
            <span className="ml-1.5 text-xs text-gray-400">{item.part.colorName || item.part.colorId}</span>
          </div>
        </div>
      </td>
      <td className="max-w-[200px] px-3 py-2">
        <div className="truncate text-sm text-gray-600">{item.part.partName || "-"}</div>
        {item.description && (
          <div className="truncate text-[10px] text-gray-400 italic">{item.description}</div>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
          item.newOrUsed === "N" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
        }`}>{item.newOrUsed === "N" ? "Neu" : "Gebr."}</span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm text-gray-900">
        {myPrice ? myPrice.toFixed(4) : "-"}
      </td>
      {/* Rabatt */}
      <td className="px-2 py-2 text-center text-xs">
        {editingSale ? (
          <input
            type="number"
            value={saleValue}
            min={0}
            max={99}
            autoFocus
            className="w-12 rounded border border-blue-300 bg-white px-1 py-0.5 text-center text-xs text-gray-900 focus:outline-none"
            onChange={(e) => setSaleValue(e.target.value)}
            onBlur={() => {
              setEditingSale(false);
              const val = Math.max(0, Math.min(99, parseInt(saleValue) || 0));
              setSaleValue(String(val));
              if (val !== item.saleRate && onSaleRateChange) onSaleRateChange(item.id, val);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
        ) : (
          <span
            onClick={() => setEditingSale(true)}
            className={`cursor-pointer rounded px-1.5 py-0.5 ${item.saleRate > 0 ? "bg-red-100 text-red-600 font-medium" : "text-gray-300 hover:bg-gray-100"}`}
          >
            {item.saleRate > 0 ? `-${item.saleRate}%` : "-"}
          </span>
        )}
      </td>
      {/* Preis gesperrt */}
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          checked={item.priceLocked}
          onChange={(e) => onPriceLockChange?.(item.id, e.target.checked)}
          title="Preis sperren — beim Export wird mein Preis verwendet"
          className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
      </td>
      {/* Empf. Preis */}
      <td className="px-3 py-2 text-right font-mono text-sm" title={item.suggestedRuleName || undefined}>
        {suggested ? (
          <span className={diffSugg !== null && diffSugg > 5 ? "text-red-600" : diffSugg !== null && diffSugg < -5 ? "text-green-600" : "text-gray-500"}>
            {suggested.toFixed(4)}
          </span>
        ) : <span className="text-gray-200">-</span>}
      </td>
      {/* Trend */}
      <td className="px-2 py-2 text-center">
        {item.trend === "up" && <TrendingUp size={16} className="inline text-green-500" />}
        {item.trend === "down" && <TrendingDown size={16} className="inline text-red-500" />}
        {item.trend === "stable" && <ArrowRight size={16} className="inline text-orange-400" />}
        {!item.trend && <span className="text-gray-200">-</span>}
      </td>
      <td className="px-3 py-2 text-right text-sm text-gray-500">
        {item.myQuantity || "-"}
      </td>
      <td className="px-3 py-2 text-center text-xs">
        {(() => {
          if (!item.part.lastPriceUpdate) return <span className="text-red-500 font-medium">Nie</span>;
          const ageMs = Date.now() - new Date(item.part.lastPriceUpdate).getTime();
          const ageDays = ageMs / 86400000;
          const color = ageDays <= freshDays ? "text-green-500" : "text-orange-500";
          return <span className={color}>{timeAgo(item.part.lastPriceUpdate)}</span>;
        })()}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={() => onRefresh(item)}
          disabled={refreshing}
          title="Preis jetzt aktualisieren"
          className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCw size={14} />
          )}
        </button>
      </td>
    </tr>
  );
}
