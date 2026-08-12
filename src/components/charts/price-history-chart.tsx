"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

interface PriceHistoryDataPoint {
  date: string;
  avgPriceNew?: number;
  avgPriceUsed?: number;
  minPriceNew?: number;
  maxPriceNew?: number;
  minPriceUsed?: number;
  maxPriceUsed?: number;
}

interface PriceHistoryChartProps {
  data: PriceHistoryDataPoint[];
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const date = label
    ? new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(label))
    : "";

  const labelMap: Record<string, string> = {
    avgPriceNew: "Durchschnitt (Neu)",
    avgPriceUsed: "Durchschnitt (Gebraucht)",
    maxPriceNew: "Max (Neu)",
    minPriceNew: "Min (Neu)",
    maxPriceUsed: "Max (Gebraucht)",
    minPriceUsed: "Min (Gebraucht)",
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="mb-1 text-sm font-medium text-gray-700">{date}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-sm" style={{ color: entry.color }}>
          {labelMap[entry.name] ?? entry.name}: {formatEur(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function PriceHistoryChart({ data }: PriceHistoryChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center rounded-lg border border-gray-200 bg-white">
        <p className="text-gray-400">Keine Daten verfügbar</p>
      </div>
    );
  }

  const hasNew = data.some(
    (d) => d.avgPriceNew !== undefined && d.avgPriceNew !== null
  );
  const hasUsed = data.some(
    (d) => d.avgPriceUsed !== undefined && d.avgPriceUsed !== null
  );
  const hasNewRange = data.some(
    (d) => d.minPriceNew !== undefined && d.maxPriceNew !== undefined
  );
  const hasUsedRange = data.some(
    (d) => d.minPriceUsed !== undefined && d.maxPriceUsed !== undefined
  );

  return (
    <div className="min-h-[400px] w-full rounded-lg border border-gray-200 bg-white p-4">
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            stroke="#d1d5db"
            tick={{ fill: "#6b7280", fontSize: 12 }}
            tickLine={{ stroke: "#d1d5db" }}
          />
          <YAxis
            tickFormatter={(v: number) => formatEur(v)}
            stroke="#d1d5db"
            tick={{ fill: "#6b7280", fontSize: 12 }}
            tickLine={{ stroke: "#d1d5db" }}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ color: "#374151", fontSize: 13 }}
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                avgPriceNew: "Durchschnitt (Neu)",
                avgPriceUsed: "Durchschnitt (Gebraucht)",
              };
              return labels[value] ?? value;
            }}
          />

          {/* New condition: min/max shaded area */}
          {hasNewRange && (
            <Area
              type="monotone"
              dataKey="maxPriceNew"
              stroke="none"
              fill="#3b82f6"
              fillOpacity={0.1}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          )}
          {hasNewRange && (
            <Area
              type="monotone"
              dataKey="minPriceNew"
              stroke="none"
              fill="#ffffff"
              fillOpacity={1}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          )}

          {/* Used condition: min/max shaded area */}
          {hasUsedRange && (
            <Area
              type="monotone"
              dataKey="maxPriceUsed"
              stroke="none"
              fill="#22c55e"
              fillOpacity={0.1}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          )}
          {hasUsedRange && (
            <Area
              type="monotone"
              dataKey="minPriceUsed"
              stroke="none"
              fill="#ffffff"
              fillOpacity={1}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          )}

          {/* Average price lines */}
          {hasNew && (
            <Line
              type="monotone"
              dataKey="avgPriceNew"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#3b82f6" }}
            />
          )}
          {hasUsed && (
            <Line
              type="monotone"
              dataKey="avgPriceUsed"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#22c55e" }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
