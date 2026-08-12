/**
 * Shared formatting and display utility functions.
 * Extracted from dashboard, watchlist, crawler, and part-detail pages.
 */

/** Human-readable relative time string (German). */
export function timeAgo(dateString: string | null): string {
  if (!dateString) return "\u2014";
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  if (diffHrs < 24) return `vor ${diffHrs} Std`;
  return `vor ${diffDays}d`;
}

/** Tailwind color class based on how stale a price update is. */
export function dataAgeColor(dateString: string | null): string {
  if (!dateString) return "text-red-500";
  const diffHrs = (Date.now() - new Date(dateString).getTime()) / 3600000;
  if (diffHrs < 24) return "text-green-600";
  if (diffHrs < 168) return "text-yellow-600";
  return "text-red-500";
}

/** Locale-formatted number (de-DE). */
export function fmt(n: number): string {
  return n.toLocaleString("de-DE");
}

/** Format a numeric value as "X.XXXX EUR". */
export function formatEur(val: string | number): string {
  return `${parseFloat(String(val)).toFixed(4)} EUR`;
}

/** Format an ISO date string as dd.MM.yyyy (German locale). */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Percentage difference between myPrice and marketPrice with color class. */
export function formatDiffPercent(
  myPrice: number,
  marketPrice: number,
): { text: string; colorClass: string } {
  if (marketPrice === 0) return { text: "N/A", colorClass: "text-gray-400" };
  const diff = ((myPrice - marketPrice) / marketPrice) * 100;
  const sign = diff > 0 ? "+" : "";
  const text = `${sign}${diff.toFixed(0)}%`;
  if (diff > 5) return { text, colorClass: "text-red-600" };
  if (diff < -5) return { text, colorClass: "text-green-600" };
  return { text, colorClass: "text-gray-400" };
}
