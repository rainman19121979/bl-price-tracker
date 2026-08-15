"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  List,
  Settings,
  Bot,
  Receipt,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { UpdateModal } from "./update-modal";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, adminOnly: false },
  { href: "/watchlist", label: "BL-Inventar", icon: List, adminOnly: false },
  { href: "/sales", label: "Verkäufe", icon: Receipt, adminOnly: false },
  { href: "/crawler", label: "Crawler", icon: Bot, adminOnly: true },
  { href: "/settings", label: "Einstellungen", icon: Settings, adminOnly: false },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface VersionCheckResult {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  error?: string;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin ?? false;
  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  const [versionInfo, setVersionInfo] = useState<VersionCheckResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;

    async function fetchVersion() {
      try {
        if (isAdmin) {
          // Admin: voller Update-Check inkl. GitHub
          const res = await fetch("/api/version/check");
          if (!res.ok) throw new Error("check failed");
          const data = await res.json();
          if (!cancelled) setVersionInfo(data);
        } else {
          // Non-Admin: nur aktuelle Version
          const res = await fetch("/api/version");
          if (!res.ok) throw new Error("version failed");
          const data = await res.json();
          if (!cancelled) setVersionInfo({
            current: data.version, latest: null, hasUpdate: false,
            releaseUrl: null, releaseName: null, publishedAt: null,
          });
        }
      } catch {
        // Fehlgeschlagen -- keine Anzeige ist besser als kaputte Anzeige
      }
    }

    fetchVersion();
    // Re-check jede Stunde (Cache serverseitig ist 6h, also faktisch alle 6h ein GitHub-Call)
    const interval = setInterval(fetchVersion, 3600 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [session?.user?.id, isAdmin]);

  return (
    <>
      <aside
        className={cn(
          "flex h-screen flex-col border-r border-gray-200 bg-white transition-all duration-200",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
          {!collapsed && (
            <span className="text-lg font-bold text-gray-900">BL Tracker</span>
          )}
          <button
            onClick={onToggle}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-2 py-4">
          {visibleItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={20} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 p-2">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            title={collapsed ? "Abmelden" : undefined}
          >
            <LogOut size={20} className="shrink-0" />
            {!collapsed && <span>Abmelden</span>}
          </button>

          {!collapsed && versionInfo && (
            <div className="mt-2 flex items-center justify-between px-2">
              <span className="font-mono text-[10px] text-gray-400">
                v{versionInfo.current}
              </span>
              {versionInfo.hasUpdate && versionInfo.latest && (
                <button
                  onClick={() => setModalOpen(true)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-50"
                  title="Update-Details anzeigen"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                  </span>
                  Update {versionInfo.latest.replace(/^v/, "v")}
                </button>
              )}
            </div>
          )}

          {!collapsed && (
            <p className="mt-2 px-2 text-[10px] leading-tight text-gray-400">
              Hobby-Projekt · nicht verbunden mit LEGO Group / BrickLink /
              BrickOwl / BrickSync
            </p>
          )}
        </div>
      </aside>

      {versionInfo?.hasUpdate && versionInfo.latest && (
        <UpdateModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          current={versionInfo.current}
          latest={versionInfo.latest}
          releaseUrl={versionInfo.releaseUrl}
          releaseName={versionInfo.releaseName}
          publishedAt={versionInfo.publishedAt}
        />
      )}
    </>
  );
}
