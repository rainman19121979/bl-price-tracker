"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

interface VolumeDataPoint {
  date: string;
  quantityNew?: number;
  quantityUsed?: number;
}

interface VolumeChartProps {
  data: VolumeDataPoint[];
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
    quantityNew: "Menge (Neu)",
    quantityUsed: "Menge (Gebraucht)",
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="mb-1 text-sm font-medium text-gray-700">{date}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-sm" style={{ color: entry.color }}>
          {labelMap[entry.name] ?? entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export function VolumeChart({ data }: VolumeChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-gray-200 bg-white">
        <p className="text-gray-400">Keine Daten verfügbar</p>
      </div>
    );
  }

  const hasNew = data.some(
    (d) => d.quantityNew !== undefined && d.quantityNew !== null
  );
  const hasUsed = data.some(
    (d) => d.quantityUsed !== undefined && d.quantityUsed !== null
  );

  return (
    <div className="min-h-[300px] w-full rounded-lg border border-gray-200 bg-white p-4">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            stroke="#d1d5db"
            tick={{ fill: "#6b7280", fontSize: 12 }}
            tickLine={{ stroke: "#d1d5db" }}
          />
          <YAxis
            stroke="#d1d5db"
            tick={{ fill: "#6b7280", fontSize: 12 }}
            tickLine={{ stroke: "#d1d5db" }}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ color: "#374151", fontSize: 13 }}
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                quantityNew: "Neu",
                quantityUsed: "Gebraucht",
              };
              return labels[value] ?? value;
            }}
          />
          {hasNew && (
            <Bar
              dataKey="quantityNew"
              stackId="volume"
              fill="#60a5fa"
              radius={[0, 0, 0, 0]}
            />
          )}
          {hasUsed && (
            <Bar
              dataKey="quantityUsed"
              stackId="volume"
              fill="#4ade80"
              radius={[2, 2, 0, 0]}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
