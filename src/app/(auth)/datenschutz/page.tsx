import Link from "next/link";

export default function DatenschutzPage() {
  return (
    <div className="w-full max-w-2xl">
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">
          Datenschutzerklaerung
        </h1>

        <div className="space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              1. Verantwortlicher
            </h2>
            <p className="text-gray-500 italic">
              [Name und Anschrift des Betreibers hier einfuegen]
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              2. Welche Daten werden gespeichert
            </h2>
            <ul className="ml-4 list-disc space-y-1">
              <li>E-Mail-Adresse und Benutzername (Registrierung)</li>
              <li>
                BrickLink API-Zugangsdaten (AES-256-GCM verschluesselt
                gespeichert)
              </li>
              <li>
                BrickLink Store-Inventar (Teile, Preise, Mengen)
              </li>
              <li>
                Marktpreisdaten von BrickLink (oeffentlich verfuegbar)
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              3. Zweck der Verarbeitung
            </h2>
            <ul className="ml-4 list-disc space-y-1">
              <li>Preisvergleich fuer LEGO-Teile</li>
              <li>Inventarverwaltung</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              4. Speicherdauer
            </h2>
            <ul className="ml-4 list-disc space-y-1">
              <li>Solange das Konto aktiv ist</li>
              <li>
                Nach Loeschung: sofortige Entfernung aller Nutzerdaten
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              5. Rechte der Nutzer (DSGVO Art. 15-21)
            </h2>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <strong>Auskunft:</strong> Daten-Export unter Einstellungen
              </li>
              <li>
                <strong>Loeschung:</strong> Konto-Loeschung unter Einstellungen
              </li>
              <li>Keine Weitergabe an Dritte</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              6. Cookies
            </h2>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                Nur Session-Cookie (technisch notwendig, kein Tracking)
              </li>
              <li>
                Kein Cookie-Banner noetig (nur technisch notwendige Cookies)
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              7. BrickLink API
            </h2>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                Daten werden von BrickLink abgerufen (oeffentliche Preisdaten)
              </li>
              <li>
                API-Zugangsdaten werden verschluesselt gespeichert
              </li>
            </ul>
          </section>
        </div>

        <div className="mt-8 border-t border-gray-200 pt-4">
          <Link
            href="/login"
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            Zurueck zum Login
          </Link>
        </div>
      </div>
    </div>
  );
}
