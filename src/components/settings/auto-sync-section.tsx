"use client";

import { RefreshCw } from "lucide-react";

interface AutoSyncSectionProps {
  autoSync: boolean;
  loading: boolean;
  saving: boolean;
  onToggle: () => void;
}

export function AutoSyncSection({ autoSync, loading, saving, onToggle }: AutoSyncSectionProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <RefreshCw className="h-5 w-5 text-gray-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Auto-Sync</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              BL-Inventar einmal taeglich automatisch synchronisieren. Nicht mehr vorhandene Teile werden aus deinem Inventar entfernt.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoSync}
          disabled={loading || saving}
          onClick={onToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
            autoSync ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              autoSync ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </section>
  );
}
