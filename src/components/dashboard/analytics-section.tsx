"use client";

import { useEffect, useState } from "react";
import { Loader2, ChevronDown, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { PartImage } from "@/components/part-image";
import { formatEur, fmt } from "@/lib/formatters";
// Recharts removed — will be re-added for new analytics

// -- Types ------------------------------------------------------------------

interface PartStat {
  partNo: string; colorId: number; partName: string | null;
  colorName: string | null; itemType: string; newOrUsed: string;
}
interface SlowMover extends PartStat {
  myQuantity: number; myPrice: number; qtySold: number;
}
interface MarginItem extends PartStat {
  myPrice: number; marketAvg: number; diffPct: number;
}
interface TurnoverItem extends PartStat {
  myQuantity: number; qtySold: number; turnover: number; avgPrice: number;
}
interface AnalyticsData {
  slowMovers: SlowMover[];
  marginOverpriced: MarginItem[];
  marginUnderpriced: MarginItem[];
  turnoverRanking: TurnoverItem[];
}

// -- Main Component ---------------------------------------------------------

export function DashboardAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    turnover: true, slow: false, margin: false,
  });

  useEffect(() => {
    fetch("/api/dashboard/analytics")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: string) =>
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Marktanalyse (90 Tage)</h2>

      <Section title="Durchsatz-Ranking" subtitle="Schnellste Dreher"
        icon={<TrendingUp className="h-5 w-5 text-green-500" />}
        open={openSections.turnover} onToggle={() => toggle("turnover")}>
        <TurnoverTable data={data.turnoverRanking} />
      </Section>

      <Section title="Ladenhueter" subtitle="Wenigste Verkaeufe"
        icon={<AlertTriangle className="h-5 w-5 text-yellow-500" />}
        open={openSections.slow} onToggle={() => toggle("slow")}>
        <SlowMoverTable data={data.slowMovers} />
      </Section>

      <Section title="Margen-Analyse" subtitle="Groesste Preisabweichungen"
        icon={<TrendingDown className="h-5 w-5 text-red-500" />}
        open={openSections.margin} onToggle={() => toggle("margin")}>
        <MarginTable overpriced={data.marginOverpriced} underpriced={data.marginUnderpriced} />
      </Section>
    </div>
  );
}

// -- Collapsible Section ----------------------------------------------------

function Section({ title, subtitle, icon, open, onToggle, children }: {
  title: string; subtitle: string; icon: React.ReactNode;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <p className="font-semibold text-gray-900">{title}</p>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
        <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-gray-100 px-5 py-4">{children}</div>}
    </div>
  );
}

// -- Turnover Table ---------------------------------------------------------

function TurnoverTable({ data }: { data: TurnoverItem[] }) {
  if (data.length === 0) return <p className="text-sm text-gray-400">Keine Daten</p>;

  const maxQty = Math.max(...data.map(d => d.qtySold));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-xs text-gray-500">
          <th className="py-2 text-left">Teil</th>
          <th className="py-2 text-center">Zust.</th>
          <th className="py-2 text-right">Bestand</th>
          <th className="py-2 text-right">Verkauft (90T)</th>
          <th className="py-2 text-left pl-3">Nachfrage</th>
          <th className="py-2 text-right">Rate</th>
          <th className="py-2 text-right">Avg Preis</th>
        </tr></thead>
        <tbody>
          {data.map((t, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-1.5">
                <Link href={`/parts/${t.partNo}/${t.colorId}?condition=${t.newOrUsed}`}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-800">
                  <PartImage partNo={t.partNo} colorId={t.colorId} itemType={t.itemType} size="sm" />
                  <div>
                    <div className="text-xs font-medium">{t.partNo}</div>
                    <div className="text-[10px] text-gray-400 truncate max-w-[200px]">{t.partName}</div>
                  </div>
                </Link>
              </td>
              <td className="py-1.5 text-center">
                <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                  t.newOrUsed === "N" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                }`}>{t.newOrUsed === "N" ? "N" : "G"}</span>
              </td>
              <td className="py-1.5 text-right font-mono text-gray-600">{t.myQuantity}</td>
              <td className="py-1.5 text-right font-mono text-green-600">{fmt(t.qtySold)}</td>
              <td className="py-1.5 pl-3 w-28">
                <div className="h-2 w-full rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(100, (t.qtySold / maxQty) * 100)}%` }} />
                </div>
              </td>
              <td className="py-1.5 text-right font-mono text-xs text-gray-400">{t.turnover.toFixed(1)}x</td>
              <td className="py-1.5 text-right font-mono text-gray-600">{formatEur(t.avgPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -- Slow Mover Table -------------------------------------------------------

function SlowMoverTable({ data }: { data: SlowMover[] }) {
  if (data.length === 0) return <p className="text-sm text-gray-400">Keine Ladenhueter</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-xs text-gray-500">
          <th className="py-2 text-left">Teil</th>
          <th className="py-2 text-center">Zust.</th>
          <th className="py-2 text-right">Bestand</th>
          <th className="py-2 text-right">Mein Preis</th>
          <th className="py-2 text-right">Verkauft (90T)</th>
        </tr></thead>
        <tbody>
          {data.map((s, i) => (
            <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 ${s.qtySold === 0 ? "bg-red-50" : ""}`}>
              <td className="py-1.5">
                <Link href={`/parts/${s.partNo}/${s.colorId}?condition=${s.newOrUsed}`}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-800">
                  <PartImage partNo={s.partNo} colorId={s.colorId} itemType={s.itemType} size="sm" />
                  <div>
                    <div className="text-xs font-medium">{s.partNo}</div>
                    <div className="text-[10px] text-gray-400 truncate max-w-[200px]">{s.partName}</div>
                  </div>
                </Link>
              </td>
              <td className="py-1.5 text-center">
                <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                  s.newOrUsed === "N" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                }`}>{s.newOrUsed === "N" ? "N" : "G"}</span>
              </td>
              <td className="py-1.5 text-right font-mono text-gray-600">{s.myQuantity}</td>
              <td className="py-1.5 text-right font-mono text-gray-600">{formatEur(s.myPrice)}</td>
              <td className="py-1.5 text-right font-mono">
                <span className={s.qtySold === 0 ? "text-red-600 font-medium" : "text-gray-600"}>
                  {s.qtySold}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -- Margin Table -----------------------------------------------------------

function MarginTable({ overpriced, underpriced }: { overpriced: MarginItem[]; underpriced: MarginItem[] }) {
  if (overpriced.length === 0 && underpriced.length === 0) {
    return <p className="text-sm text-gray-400">Keine grossen Abweichungen</p>;
  }

  const MarginRow = ({ items, label, color }: { items: MarginItem[]; label: string; color: string }) => (
    items.length > 0 ? (
      <div className="mb-4">
        <p className={`mb-2 text-xs font-semibold ${color}`}>{label} ({items.length})</p>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-xs text-gray-500">
            <th className="py-2 text-left">Teil</th>
            <th className="py-2 text-center">Zust.</th>
            <th className="py-2 text-right">Mein Preis</th>
            <th className="py-2 text-right">Empf. Preis</th>
            <th className="py-2 text-right">Abweichung</th>
          </tr></thead>
          <tbody>
            {items.map((m, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-1.5">
                  <Link href={`/parts/${m.partNo}/${m.colorId}?condition=${m.newOrUsed}`}
                    className="flex items-center gap-2 text-blue-600 hover:text-blue-800">
                    <PartImage partNo={m.partNo} colorId={m.colorId} itemType={m.itemType} size="sm" />
                    <div>
                      <div className="text-xs font-medium">{m.partNo}</div>
                      <div className="text-[10px] text-gray-400 truncate max-w-[200px]">{m.partName}</div>
                    </div>
                  </Link>
                </td>
                <td className="py-1.5 text-center">
                  <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                    m.newOrUsed === "N" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                  }`}>{m.newOrUsed === "N" ? "N" : "G"}</span>
                </td>
                <td className="py-1.5 text-right font-mono text-gray-600">{formatEur(m.myPrice)}</td>
                <td className="py-1.5 text-right font-mono text-gray-600">{formatEur(m.marketAvg)}</td>
                <td className="py-1.5 text-right font-mono">
                  <span className={m.diffPct > 0 ? "text-red-600" : "text-green-600"}>
                    {m.diffPct > 0 ? "+" : ""}{m.diffPct.toFixed(0)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null
  );

  return (
    <div>
      <MarginRow items={overpriced} label="Zu teuer (du verlierst Verkaeufe)" color="text-red-600" />
      <MarginRow items={underpriced} label="Zu guenstig (du verschenkst Marge)" color="text-green-600" />
    </div>
  );
}
