"use client";

interface InventoryValue {
  myValue: number;
  soldMedianValue: number;
  soldQtyAvgValue: number;
  stockMedianValue: number;
  stockQtyAvgValue: number;
  formulaValue: number | null;
}

interface InventoryValueCardsProps {
  value: InventoryValue | null;
}

export function InventoryValueCards({ value }: InventoryValueCardsProps) {
  if (!value) return null;

  const mv = value.myValue;
  const eur = (v: number) =>
    (v ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v: number) => {
    if (mv <= 0) return null;
    const d = ((v - mv) / mv) * 100;
    return { text: (d > 0 ? "+" : "") + d.toFixed(1) + "%", color: d < 0 ? "text-red-600" : "text-green-600" };
  };

  return (
    <div className={`grid grid-cols-1 gap-3 ${value.formulaValue !== null ? 'sm:grid-cols-6' : 'sm:grid-cols-5'}`}>
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-medium uppercase text-gray-400">Mein Wert</p>
        <p className="mt-1 text-xl font-bold text-gray-900">{eur(mv)}</p>
      </div>
      {value.formulaValue !== null && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <p className="text-[10px] font-medium uppercase text-blue-500">Formel</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{eur(value.formulaValue)}</p>
          {(() => { const d = pct(value.formulaValue); return d ? <p className={`mt-0.5 text-xs font-medium ${d.color}`}>{d.text}</p> : null; })()}
        </div>
      )}
      {[
        { label: "Verk. Median", value: value.soldMedianValue },
        { label: "Verk. Gew.", value: value.soldQtyAvgValue },
        { label: "Angeb. Median", value: value.stockMedianValue },
        { label: "Angeb. Gew.", value: value.stockQtyAvgValue },
      ].map((card) => {
        const diff = pct(card.value);
        return (
          <div key={card.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-medium uppercase text-gray-400">{card.label}</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{eur(card.value)}</p>
            {diff && <p className={`mt-0.5 text-xs font-medium ${diff.color}`}>{diff.text}</p>}
          </div>
        );
      })}
    </div>
  );
}
