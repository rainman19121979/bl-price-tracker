"use client";

import { useState, useCallback, useEffect } from "react";
import { Trash2, ChevronUp, ChevronDown, Plus, ChevronRight, Code, Sparkles, Loader2 } from "lucide-react";
import {
  type PricingRule,
  validateFormula,
  PRICING_VARIABLES,
  PRICING_FUNCTIONS,
  PRICING_VAR_DOCS,
  PRICING_FUNC_DOCS,
} from "@/lib/pricing-engine";

interface PreviewSample {
  watchlistId: number;
  partNo: string;
  colorId: number;
  colorName: string | null;
  partName: string | null;
  newOrUsed: string;
  myPrice: number;
  myQuantity: number;
  myCost: number | null;
  vars: Record<string, number>;
  suggestedPrice: number | null;
  suggestedRounded: number | null;
  changePct: number | null;
}

interface AppliedFilters {
  sellerCountries: string[] | null;
  shippingCountries: string[] | null;
}

function varScope(varName: string): "seller+buyer" | "seller" | "none" {
  if (varName.startsWith("sold")) return "seller+buyer";
  if (varName.startsWith("stock")) return "seller";
  return "none";
}

function scopeBadge(scope: "seller+buyer" | "seller" | "none") {
  if (scope === "seller+buyer") return { label: "Verk. + Käufer", cls: "bg-blue-100 text-blue-700 border-blue-200" };
  if (scope === "seller") return { label: "nur Verk.", cls: "bg-purple-100 text-purple-700 border-purple-200" };
  return { label: "kein Filter", cls: "bg-gray-100 text-gray-600 border-gray-200" };
}

const fmtEur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 3, maximumFractionDigits: 4 });

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
        <div className="mt-2 space-y-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-xs">
          <div>
            <p className="mb-2 text-sm font-semibold text-gray-800">So funktioniert die Preisberechnung</p>
            <p className="text-gray-700 leading-relaxed">
              Für jedes Lot in deiner Watchlist wird die <strong>erste passende Regel</strong> ausgewertet
              (Reihenfolge von oben nach unten, mit den Pfeilen sortierbar). Regeln mit engeren Filtern
              (Farbe/Kategorie) sollten <em>oben</em> stehen, allgemeine Fallbacks unten. Die Formel liefert
              einen EUR-Preis, der auf 3 Nachkommastellen gerundet als <strong>Empfehlungspreis</strong>
              gespeichert wird — sichtbar in Watchlist, BSX-Export und Margen-Analyse.
              Lots mit <code className="rounded bg-white px-1">Preis fixiert</code> überspringen die Formel.
            </p>
          </div>

          <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
            <strong>Länder-Filter:</strong> Verkaufsdaten (<code>sold*</code>) werden von <em>beiden</em> Filtern
            (Verkäufer + Käufer) beschnitten, Angebotsdaten (<code>stock*</code>) nur vom Verkäuferland.
            Eigene Daten (<code>my*</code>) sind ungefiltert. Konfiguration in den zwei Sektionen oben.
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-2 font-semibold text-gray-800">
              Verkaufsdaten (was auf BL wirklich weggegangen ist)
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-normal ${scopeBadge("seller+buyer").cls}`}>Filter: {scopeBadge("seller+buyer").label}</span>
            </p>
            <div className="space-y-1">
              {PRICING_VARIABLES.filter((v) => v.startsWith("sold")).map((v) => (
                <div key={v} className="flex gap-2">
                  <code className="w-32 shrink-0 rounded bg-white px-1 py-0.5 font-mono text-[11px] text-blue-700">{v}</code>
                  <span className="text-gray-600">{PRICING_VAR_DOCS[v]}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-2 font-semibold text-gray-800">
              Angebotsdaten (was aktuell am Markt liegt)
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-normal ${scopeBadge("seller").cls}`}>Filter: {scopeBadge("seller").label}</span>
            </p>
            <div className="space-y-1">
              {PRICING_VARIABLES.filter((v) => v.startsWith("stock")).map((v) => (
                <div key={v} className="flex gap-2">
                  <code className="w-32 shrink-0 rounded bg-white px-1 py-0.5 font-mono text-[11px] text-purple-700">{v}</code>
                  <span className="text-gray-600">{PRICING_VAR_DOCS[v]}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-2 font-semibold text-gray-800">
              Deine Daten (aus BL-Inventar-Sync)
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-normal ${scopeBadge("none").cls}`}>Filter: {scopeBadge("none").label}</span>
            </p>
            <div className="space-y-1">
              {PRICING_VARIABLES.filter((v) => v.startsWith("my")).map((v) => (
                <div key={v} className="flex gap-2">
                  <code className="w-32 shrink-0 rounded bg-white px-1 py-0.5 font-mono text-[11px] text-emerald-700">{v}</code>
                  <span className="text-gray-600">{PRICING_VAR_DOCS[v]}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-semibold text-gray-800">Funktionen &amp; Operatoren</p>
            <div className="space-y-1">
              {PRICING_FUNCTIONS.map((f) => (
                <div key={f} className="flex gap-2">
                  <code className="w-32 shrink-0 rounded bg-white px-1 py-0.5 font-mono text-[11px] text-gray-700">{f}(...)</code>
                  <span className="text-gray-600">{PRICING_FUNC_DOCS[f]}</span>
                </div>
              ))}
              <div className="flex gap-2">
                <code className="w-32 shrink-0 rounded bg-white px-1 py-0.5 font-mono text-[11px] text-gray-700">a ? b : c</code>
                <span className="text-gray-600">Wenn a wahr ist, nimm b, sonst c (z.B. <code className="text-[10px]">stockCount &gt; 3 ? stockMedian : sold90dMedian</code>)</span>
              </div>
              <div className="flex gap-2">
                <code className="w-32 shrink-0 rounded bg-white px-1 py-0.5 font-mono text-[11px] text-gray-700">+ - * / %</code>
                <span className="text-gray-600">Rechenoperationen und Modulo</span>
              </div>
              <div className="flex gap-2">
                <code className="w-32 shrink-0 rounded bg-white px-1 py-0.5 font-mono text-[11px] text-gray-700">&lt; &gt; == != &amp;&amp; ||</code>
                <span className="text-gray-600">Vergleiche und Boolesche Logik</span>
              </div>
            </div>
          </div>

          <div className="border-t border-blue-200 pt-2">
            <p className="mb-1.5 font-semibold text-gray-800">Kochbuch</p>
            <div className="space-y-1.5 text-gray-700">
              <div><code className="rounded bg-white px-1 py-0.5 font-mono">stockMedian * 0.95</code> — 5% unter aktuellem Markt-Median unterbieten</div>
              <div><code className="rounded bg-white px-1 py-0.5 font-mono">max(sold90dMedian, stockMedian) * 1.1</code> — 10% über dem höheren von 90-Tage-Verkauf oder Markt (aggressive Marge)</div>
              <div><code className="rounded bg-white px-1 py-0.5 font-mono">stockCount &gt; 3 ? stockMedian * 0.98 : sold90dMedian</code> — wenn genug Konkurrenz, leicht unterbieten, sonst Verkaufsmedian als Anker</div>
              <div><code className="rounded bg-white px-1 py-0.5 font-mono">max(myCost * 1.5, stockMin)</code> — mindestens 50% Marge auf Einkauf, aber nie unter dem günstigsten Angebot</div>
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
                    <select value={rule.filters.completeness ?? "*"}
                      onChange={(e) => updateFilters(idx, { completeness: e.target.value })}
                      title="Completeness — nur relevant wenn Typ=SET (Bei anderen Typen wird der Filter ignoriert)"
                      className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none">
                      <option value="*">Alle Completeness</option>
                      <option value="C">Complete (SET)</option>
                      <option value="I">Incomplete (SET)</option>
                      <option value="S">Sealed (SET)</option>
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

                  {/* Live preview */}
                  {status.ok && <RulePreview rule={rule} />}
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

function RulePreview({ rule }: { rule: PricingRule }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [samples, setSamples] = useState<PreviewSample[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({ sellerCountries: null, shippingCountries: null });

  // Debounced fetch when panel is open and rule changes
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true); setErr(null); setNote(null);
      try {
        const res = await fetch("/api/settings/pricing-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule }),
        });
        const data = await res.json();
        if (!res.ok) { setErr(data.error || "Fehler"); setSamples([]); return; }
        if (data.error) setErr(data.error);
        setSamples(data.samples || []);
        setNote(data.note || null);
        setSampleIdx(0);
        if (data.filters) setAppliedFilters(data.filters);
      } catch {
        setErr("Netzwerkfehler");
      } finally { setLoading(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [open, rule]);

  const sellerTxt = appliedFilters.sellerCountries ? appliedFilters.sellerCountries.join(",") : "weltweit";
  const buyerTxt = appliedFilters.shippingCountries ? appliedFilters.shippingCountries.join(",") : "weltweit";

  const s = samples[sampleIdx];
  const usedVars = s ? extractUsedVariables(rule.formula) : [];

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
      >
        <Sparkles className="h-3 w-3" />
        {open ? "Vorschau ausblenden" : "Live-Vorschau mit Beispiel aus deinem Inventar"}
      </button>

      {open && (
        <div className="mt-2 rounded border border-blue-200 bg-white p-3 text-xs">
          {loading && (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Berechne...
            </div>
          )}
          {!loading && err && <div className="text-red-600">{err}</div>}
          {!loading && !err && note && <div className="text-gray-500">{note}</div>}
          {!loading && s && (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-gray-700">
                  <span className="font-semibold">{s.partNo}</span>
                  {s.colorName && <span className="text-gray-500"> · {s.colorName}</span>}
                  <span className="text-gray-400"> · {s.newOrUsed === "N" ? "Neu" : "Gebraucht"}</span>
                  {s.partName && <div className="text-[11px] text-gray-500">{s.partName}</div>}
                </div>
                {samples.length > 1 && (
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      onClick={() => setSampleIdx((sampleIdx - 1 + samples.length) % samples.length)}
                      className="rounded border border-gray-200 px-1.5 py-0.5 hover:bg-gray-50"
                    >‹</button>
                    <span className="text-gray-500">{sampleIdx + 1}/{samples.length}</span>
                    <button
                      onClick={() => setSampleIdx((sampleIdx + 1) % samples.length)}
                      className="rounded border border-gray-200 px-1.5 py-0.5 hover:bg-gray-50"
                    >›</button>
                  </div>
                )}
              </div>

              {/* Applied filters */}
              <div className="mb-2 rounded border border-amber-100 bg-amber-50 p-1.5 text-[10px] text-amber-900">
                <span className="font-semibold">Aktive Filter:</span>{" "}
                Verkäufer <code className="rounded bg-white px-1">{sellerTxt}</code>{" "}
                · Käufer <code className="rounded bg-white px-1">{buyerTxt}</code>{" "}
                <span className="text-amber-700">
                  → wirkt auf {usedVars.some((v) => v.startsWith("sold")) && "sold*"}
                  {usedVars.some((v) => v.startsWith("sold")) && usedVars.some((v) => v.startsWith("stock")) && " + "}
                  {usedVars.some((v) => v.startsWith("stock")) && "stock*"}
                  {!usedVars.some((v) => v.startsWith("sold") || v.startsWith("stock")) && "keine Variable in dieser Formel"}
                </span>
              </div>

              {/* Variable values (only those referenced in formula) */}
              {usedVars.length > 0 && (
                <div className="mb-2 rounded bg-gray-50 p-2">
                  <div className="mb-1 text-[10px] uppercase text-gray-500">Werte für dieses Lot</div>
                  <div className="grid grid-cols-1 gap-y-0.5 font-mono sm:grid-cols-2 sm:gap-x-3">
                    {usedVars.map((v) => {
                      const scope = varScope(v);
                      const badge = scopeBadge(scope);
                      return (
                        <div key={v} className="flex items-center justify-between gap-1">
                          <span className="flex items-center gap-1 truncate">
                            <span className={scope === "seller+buyer" ? "text-blue-700" : scope === "seller" ? "text-purple-700" : "text-emerald-700"}>{v}</span>
                            <span className={`shrink-0 rounded border px-1 py-0 text-[9px] font-normal ${badge.cls}`} title={
                              scope === "seller+buyer" ? `Filter: Verk. ${sellerTxt} + Käufer ${buyerTxt}` :
                              scope === "seller" ? `Filter: Verk. ${sellerTxt}` :
                              "keine Filter"
                            }>{badge.label}</span>
                          </span>
                          <span className="text-gray-900">{formatVarValue(v, s.vars[v] ?? 0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Result */}
              <div className="flex items-center gap-4 border-t border-gray-100 pt-2">
                <div>
                  <div className="text-[10px] uppercase text-gray-500">Aktuell (myPrice)</div>
                  <div className="font-semibold text-gray-700">{fmtEur(s.myPrice)}</div>
                </div>
                <div className="text-gray-300">→</div>
                <div>
                  <div className="text-[10px] uppercase text-gray-500">Empf. (Formel)</div>
                  <div className={`font-semibold ${
                    s.suggestedRounded === null ? "text-red-600" :
                    s.changePct !== null && s.changePct > 5 ? "text-green-600" :
                    s.changePct !== null && s.changePct < -5 ? "text-red-600" : "text-gray-900"
                  }`}>
                    {s.suggestedRounded === null ? "—" : fmtEur(s.suggestedRounded)}
                  </div>
                </div>
                {s.changePct !== null && s.suggestedRounded !== null && (
                  <div>
                    <div className="text-[10px] uppercase text-gray-500">Δ</div>
                    <div className={`font-semibold ${s.changePct > 0 ? "text-green-600" : s.changePct < 0 ? "text-red-600" : "text-gray-700"}`}>
                      {s.changePct > 0 ? "+" : ""}{s.changePct.toFixed(1)}%
                    </div>
                  </div>
                )}
                <div className="ml-auto text-[10px] text-gray-400">
                  Bestand: {s.myQuantity}
                  {s.myCost != null && s.myCost > 0 && ` · EK: ${fmtEur(s.myCost / s.myQuantity)}/Stk`}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function extractUsedVariables(formula: string): string[] {
  const set = new Set<string>();
  const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const name = m[1];
    if ((PRICING_VARIABLES as readonly string[]).includes(name)) set.add(name);
  }
  return Array.from(set);
}

function formatVarValue(varName: string, value: number): string {
  if (varName.endsWith("Count") || varName.endsWith("Qty") || varName === "myQty") {
    return value.toLocaleString("de-DE");
  }
  return fmtEur(value);
}
