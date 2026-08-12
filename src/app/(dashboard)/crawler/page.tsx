"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, Loader2 } from "lucide-react";
import { PartImage } from "@/components/part-image";
import { timeAgo } from "@/lib/formatters";

interface CrawlerData {
  recentlyUpdated: {
    partNo: string;
    colorId: number;
    colorName: string | null;
    partName: string | null;
    itemType: string;
    newOrUsed: string;
    updatedAt: string;
  }[];
}

export default function CrawlerPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [data, setData] = useState<CrawlerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session && !session.user?.isAdmin) {
      router.push("/");
    }
  }, [session, router]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/crawler/status");
      if (res.ok) setData(await res.json());
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

  if (!data) {
    return <p className="text-gray-500">Daten konnten nicht geladen werden</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Zuletzt aktualisiert</h1>
        <p className="mt-1 text-sm text-gray-500">Die letzten 20 gecrawlten Teile</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
                <th className="px-5 py-3">Teil</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Wann</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recentlyUpdated.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-400">Noch keine Teile aktualisiert</td></tr>
              ) : (
                data.recentlyUpdated.map((part, i) => (
                  <tr key={`${part.partNo}-${part.colorId}-${i}`} className="text-gray-600 hover:bg-gray-50">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <PartImage partNo={part.partNo} colorId={part.colorId} itemType={part.itemType} size="sm" />
                        <Link href={`/parts/${part.partNo}/${part.colorId}?condition=${part.newOrUsed}`} className="font-mono text-blue-600 hover:text-blue-700">
                          {part.partNo}
                        </Link>
                        <span className="text-xs text-gray-400">{part.colorName || `ID: ${part.colorId}`}</span>
                        <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${part.newOrUsed === "N" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {part.newOrUsed === "N" ? "N" : "G"}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-gray-500 max-w-[250px] truncate">{part.partName || "—"}</td>
                    <td className="px-5 py-2.5 text-gray-400">
                      <Clock size={12} className="mr-1 inline" />
                      {timeAgo(part.updatedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
