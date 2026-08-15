"use client";

import { useState } from "react";
import { AlertCircle, Copy, Check, ExternalLink } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  current: string;
  latest: string;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
}

const UPDATE_COMMAND = "cd /opt/bl-price-tracker && git pull && docker compose pull && docker compose up -d";

export function UpdateModal({ open, onClose, current, latest, releaseUrl, releaseName, publishedAt }: Props) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-API kann in unsicheren Kontexten (HTTP ohne HTTPS) fehlschlagen
      // Fallback: Text markieren
    }
  };

  const pubDate = publishedAt ? new Date(publishedAt).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-amber-300 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="h-6 w-6 shrink-0 text-amber-600" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">Update verfügbar</h3>
            <p className="mt-1 text-sm text-gray-700">
              <span className="font-mono text-gray-500">v{current}</span>
              <span className="mx-2 text-gray-400">→</span>
              <span className="font-mono font-semibold text-amber-700">{latest.replace(/^v/, "v")}</span>
              {releaseName && releaseName !== latest && (
                <span className="ml-2 text-gray-600">— {releaseName}</span>
              )}
              {pubDate && <span className="ml-2 text-xs text-gray-500">({pubDate})</span>}
            </p>

            {releaseUrl && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Release-Notes auf GitHub anzeigen
                <ExternalLink size={14} />
              </a>
            )}

            <div className="mt-4">
              <div className="mb-1 text-xs font-medium text-gray-700">Update-Befehl (auf dem Host ausführen):</div>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
                  {UPDATE_COMMAND}
                </code>
                <button
                  onClick={doCopy}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  title="In Zwischenablage kopieren"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  {copied ? "Kopiert" : "Kopieren"}
                </button>
              </div>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Führt einen kurzen Neustart aus — ~15 Sekunden Downtime, keine Datenverluste. Migrations laufen automatisch mit.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
