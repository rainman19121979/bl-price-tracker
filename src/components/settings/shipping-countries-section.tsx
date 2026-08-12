"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface ShippingCountriesSectionProps {
  initialCountries: string[] | null;
  availableCountries: { code: string; sales: number }[];
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function ShippingCountriesSection({
  initialCountries,
  availableCountries,
  onError,
  onSuccess,
}: ShippingCountriesSectionProps) {
  const [shippingCountries, setShippingCountries] = useState<string[] | null>(initialCountries);
  const [countrySaving, setCountrySaving] = useState(false);

  const handleSave = async () => {
    setCountrySaving(true);
    onError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shippingCountries }),
      });
      if (res.ok) {
        onSuccess(
          shippingCountries === null
            ? "Alle Laender aktiv"
            : `${shippingCountries.length} ${shippingCountries.length === 1 ? "Land" : "Laender"} gespeichert`
        );
      } else {
        onError("Fehler beim Speichern");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setCountrySaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Versandlaender</h2>
        <p className="mt-1 text-sm text-gray-500">
          Verkaeufer immer aus DE — waehle die Laender in die du versendest.
          Nur Verkaeufe an diese Laender werden fuer die Preisberechnung beruecksichtigt.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Stock-Angebote sind davon nicht betroffen (kein Kaeuferland verfuegbar).
        </p>
      </div>

      <div className="mt-4">
        <label className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            checked={shippingCountries === null}
            onChange={() => {
              if (shippingCountries === null) {
                setShippingCountries(["DE"]);
              } else {
                setShippingCountries(null);
              }
            }}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Alle Laender (kein Filter)</span>
        </label>

        {shippingCountries !== null && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {availableCountries.map((country) => (
              <label key={country.code} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shippingCountries.includes(country.code)}
                  onChange={() => {
                    setShippingCountries((prev) => {
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
            disabled={countrySaving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {countrySaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </section>
  );
}
