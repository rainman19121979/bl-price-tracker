"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface SellerCountriesSectionProps {
  initialCountries: string[] | null;
  availableCountries: { code: string; sales: number }[];
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function SellerCountriesSection({
  initialCountries,
  availableCountries,
  onError,
  onSuccess,
}: SellerCountriesSectionProps) {
  const [sellerCountries, setSellerCountries] = useState<string[] | null>(initialCountries);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    onError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerCountries }),
      });
      if (res.ok) {
        onSuccess(
          sellerCountries === null
            ? "Alle Verkaeuferlaender aktiv"
            : `${sellerCountries.length} ${sellerCountries.length === 1 ? "Land" : "Laender"} gespeichert`
        );
      } else {
        onError("Fehler beim Speichern");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Verkaeuferlaender</h2>
        <p className="mt-1 text-sm text-gray-500">
          Waehle die Verkaeuferlaender, die fuer Preisberechnung beruecksichtigt werden sollen
          (Sold + Stock). Beispiel: DE + CH nutzt nur Angebote aus diesen beiden Laendern.
        </p>
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Nach Aenderung:</strong> Empfehlungspreise werden sofort neu berechnet, aber die
          Anzeige <em>&quot;Aktuelle Angebote&quot;</em> auf der Teil-Detailseite faellt vorerst
          auf weltweite Daten zurueck. Erst nach dem naechsten Crawl-Durchlauf pro Teil sind die
          Angebote wirklich landspezifisch gefiltert. Bei deinem BrickLink-API-Budget dauert das
          ca. 10 Tage bis alle Teile durchrotiert sind (bei Standard-Setting 1000 Calls/Tag).
        </div>
      </div>

      <div className="mt-4">
        <label className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            checked={sellerCountries === null}
            onChange={() => {
              if (sellerCountries === null) {
                setSellerCountries(["DE"]);
              } else {
                setSellerCountries(null);
              }
            }}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Alle Laender (kein Filter)</span>
        </label>

        {sellerCountries !== null && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {availableCountries.map((country) => (
              <label key={country.code} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sellerCountries.includes(country.code)}
                  onChange={() => {
                    setSellerCountries((prev) => {
                      if (!prev) return [country.code];
                      return prev.includes(country.code)
                        ? prev.filter((c) => c !== country.code)
                        : [...prev, country.code];
                    });
                  }}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-gray-700">{country.code}</span>
                <span className="text-[10px] text-gray-400">({country.sales.toLocaleString("de-DE")})</span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </section>
  );
}
