"use client";

import { useState, useCallback } from "react";
import { Trash2, ChevronUp, ChevronDown, Plus, ChevronRight, Code } from "lucide-react";
import { type PricingRule, validateFormula, PRICING_VARIABLES, PRICING_FUNCTIONS } from "@/lib/pricing-engine";

interface Props {
  initialFormulas: PricingRule[];
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

const EMPTY_RULE: PricingRule = {
  name: "",
  filters: { itemType: "*", condition: "*", colorId: [], categoryId: [] },
  formula: "stockMedian",
};

export function PricingFormulasSection({ initialFormulas, onError, onSuccess }: Props) {
  const [rules, setRules] = useState<PricingRule[]>(initialFormulas);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const save = useCallback(async (newRules: PricingRule[]) => {
    setSaving(true);
    onError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricingFormulas: newRules }),
      });
      if (res.ok) {
        const data = await res.json();
        setRules(data.pricingFormulas || []);
        onSuccess("Preisformeln gespeichert");
      } else {
        const data = await res.json();
        onError(data.error || "Fehler beim Speichern");
      }
    } catch {
      onError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }, [onError, onSuccess]);

  const updateRule = (idx: number, patch: Partial<PricingRule>) => {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const updateFilters = (idx: number, patch: Partial<PricingRule["filters"]>) => {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, filters: { ...r.filters, ...patch } } : r));
  };

  const moveRule = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= rules.length) return;
    const copy = [...rules];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setRules(copy);
  };

  const removeRule = (idx: number) => {
    setRules(prev => prev.filter((_, i) => i !== idx));
  };

  const addRule = () => {
    setRules(prev => [...prev, { ...EMPTY_RULE, name: `Regel ${prev.length + 1}` }]);
  };

  const getFormulaStatus = (formula: string): { ok: boolean; msg?: string } => {
    if (!formula.trim()) return { ok: false, msg: "Leer" };
    const result = validateFormula(formula);
    return result.valid ? { ok: true } : { ok: false, msg: result.error };
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <Code className="h-5 w-5 text-gray-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Preisformeln</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Regeln werden von oben nach unten geprueft — erste passende gewinnt
            </p>
          </div>
        </div>
        <button onClick={addRule} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Regel
        </button>
      </div>

      {/* Help toggle */}
      <button
        onClick={() => setShowHelp(!showHelp)}
        className="mt-4 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showHelp ? "rotate-90" : ""}`} />
        Verfuegbare Variablen & Funktionen
      </button>

      {showHelp && (
        <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="font-semibold text-gray-700 mb-1">Verkaufsdaten (Zeitraeume)</p>
              <div className="space-y-0.5 text-gray-600 font-mono">
                {PRICING_VARIABLES.filter(v => v.startsWith("sold")).map(v => (
                  <div key={v}>{v}</div>
                ))}
              </div>
            </div>
            <div>
              <p className="font-semibold text-gray-700 mb-1">Angebotsdaten</p>
              <div className="space-y-0.5 text-gray-600 font-mono">
                {PRICING_VARIABLES.filter(v => v.startsWith("stock")).map(v => (
                  <div key={v}>{v}</div>
                ))}
              </div>
              <p className="font-semibold text-gray-700 mt-3 mb-1">Eigene Daten</p>
              <div className="space-y-0.5 text-gray-600 font-mono">
                {PRICING_VARIABLES.filter(v => v.startsWith("my")).map(v => (
                  <div key={v}>{v}</div>
                ))}
              </div>
              <p className="font-semibold text-gray-700 mt-3 mb-1">Funktionen</p>
              <div className="space-y-0.5 text-gray-600 font-mono">
                {PRICING_FUNCTIONS.map(f => (
                  <div key={f}>{f}(a, b, ...)</div>
                ))}
              </div>
              <p className="font-semibold text-gray-700 mt-3 mb-1">Ternary</p>
              <div className="text-gray-600 font-mono">bedingung ? wert1 : wert2</div>
            </div>
          </div>
          <div className="mt-3 border-t border-blue-200 pt-2">
            <p className="font-semibold text-gray-700 mb-1">Beispiele</p>
            <div className="space-y-0.5 text-gray-600 font-mono">
              <div>stockMedian * 0.95</div>
              <div>max(sold90dMedian, stockMedian) * 1.1</div>
              <div>stockCount &gt; 3 ? stockMedian : sold90dMedian</div>
              <div>round(soldAvg * 1.05, 2)</div>
            </div>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="mt-4 space-y-3">
        {rules.length === 0 && (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-400">
            Keine Regeln definiert — klicke &quot;+ Regel&quot; um zu starten
          </div>
        )}

        {rules.map((rule, idx) => {
          const status = getFormulaStatus(rule.formula);
          return (
            <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-start gap-3">
                {/* Priority arrows */}
                <div className="flex flex-col gap-0.5 pt-1">
                  <button onClick={() => moveRule(idx, -1)} disabled={idx === 0}
                    className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <span className="text-center text-xs text-gray-400">{idx + 1}</span>
                  <button onClick={() => moveRule(idx, 1)} disabled={idx === rules.length - 1}
                    className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>

                {/* Rule content */}
                <div className="flex-1 space-y-3">
                  {/* Row 1: Name + Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text" value={rule.name}
                      onChange={(e) => updateRule(idx, { name: e.target.value })}
                      placeholder="Regelname"
                      className="w-40 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                    />
                    <select value={rule.filters.itemType}
                      onChange={(e) => updateFilters(idx, { itemType: e.target.value })}
                      className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none">
                      <option value="*">Alle Typen</option>
                      <option value="PART">Part</option>
                      <option value="MINIFIG">Minifig</option>
                      <option value="SET">Set</option>
                    </select>
                    <select value={rule.filters.condition}
                      onChange={(e) => updateFilters(idx, { condition: e.target.value })}
                      className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none">
                      <option value="*">Alle Zustaende</option>
                      <option value="N">Neu</option>
                      <option value="U">Gebraucht</option>
                    </select>
                    <input
                      type="text"
                      value={rule.filters.colorId.join(",")}
                      onChange={(e) => updateFilters(idx, {
                        colorId: e.target.value ? e.target.value.split(",").map(Number).filter(n => !isNaN(n)) : []
                      })}
                      placeholder="Farb-IDs (z.B. 7,85)"
                      className="w-36 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={rule.filters.categoryId.join(",")}
                      onChange={(e) => updateFilters(idx, {
                        categoryId: e.target.value ? e.target.value.split(",").map(Number).filter(n => !isNaN(n)) : []
                      })}
                      placeholder="Kategorie-IDs"
                      className="w-36 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Row 2: Formula */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">=</span>
                    <input
                      type="text" value={rule.formula}
                      onChange={(e) => updateRule(idx, { formula: e.target.value })}
                      placeholder="z.B. stockMedian * 0.95"
                      className={`flex-1 rounded border bg-white px-3 py-1.5 font-mono text-sm focus:outline-none ${
                        status.ok ? "border-green-300 focus:border-green-500" : rule.formula ? "border-red-300 focus:border-red-500" : "border-gray-300 focus:border-blue-500"
                      } text-gray-900 placeholder-gray-400`}
                    />
                    {!status.ok && rule.formula && (
                      <span className="text-xs text-red-500 whitespace-nowrap">{status.msg}</span>
                    )}
                  </div>
                </div>

                {/* Delete */}
                <button onClick={() => removeRule(idx)}
                  className="mt-1 rounded p-1.5 text-gray-400 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save button */}
      {rules.length > 0 && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => save(rules)}
            disabled={saving || rules.some(r => !getFormulaStatus(r.formula).ok)}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Speichern..." : "Formeln speichern"}
          </button>
        </div>
      )}
    </section>
  );
}
