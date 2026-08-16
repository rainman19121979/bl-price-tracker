# Preisformel-Rezepte

Sammlung realer Preisformeln für verschiedene Store-Strategien. Kopier eine als Startpunkt und pass sie an deine Situation an.

**Vor dem Lesen** empfohlen: [`docs/PRICING_FORMULAS.md`](../docs/PRICING_FORMULAS.md) — dort stehen alle verfügbaren Variablen, Operatoren und Funktionen. Diese Seite hier zeigt Kombinationen für konkrete Szenarien.

---

## Kategorien

- [Aggressiv verkaufen (schnell Umschlag, dünne Marge)](#aggressiv)
- [Konservativ (auf Marge fokussiert, weniger Volumen)](#konservativ)
- [Cost-Guardrail (verhindert Verlust-Verkäufe)](#cost-guardrail)
- [Volumen-basiert (Trend-Reagiere)](#volumen-basiert)
- [Kombiniert / Multi-Regel-Setups](#kombiniert)
- [Spezialfälle](#spezialfaelle)

---

## Aggressiv

**Ziel:** möglichst schnell verkaufen, den niedrigsten Preis am Markt anbieten. Für Ausräum-Aktionen, saisonale Themen die weg müssen, Lagerbereinigung.

### 1. Immer 5 % unter dem Markt-Median
```
stockMedian * 0.95
```
Simpelster Preis-Krieg. Achtung: keine Untergrenze, kann unter Cost fallen. Nur mit Cost-Guardrail kombinieren (siehe unten).

### 2. Unter allen aktuellen Angeboten
```
stockMin * 0.99
```
Immer 1 % unter dem günstigsten aktuellen Angebot. **Extrem aggressiv**, ideal für "muss weg"-Ware. Aber Vorsicht: `stockMin` kann sehr niedrig sein wenn ein Anbieter drastisch unterbietet.

### 3. Zwischen Sold und Stock, tief
```
min(sold30dMedian * 0.90, stockMedian * 0.92)
```
10 % unter dem 30-Tage-Verkaufsmedian ODER 8 % unter dem aktuellen Marktmedian — je nachdem was niedriger ist.

---

## Konservativ

**Ziel:** solide Marge, dafür langsameren Umschlag akzeptieren. Für seltene Teile, langfristige Investments, Sammlermünzen etc.

### 4. Auf Marktmedian, ohne Rabatt
```
stockMedian
```
Läuft mit dem Mainstream mit, keine Preis-Krieg-Aktion.

### 5. Leicht über dem Markt (Premium-Positionierung)
```
max(stockMedian * 1.05, sold90dMedian)
```
5 % über dem aktuellen Marktmedian, aber mindestens auf dem 90-Tage-Verkaufsmedian. Für Ware wo du überzeugt bist dass jemand bald wieder zum höheren Preis kauft.

### 6. Auf dem qty-gewichteten Durchschnitt
```
stockAvg
```
Statt Median den mengengewichteten Durchschnitt der aktuellen Angebote. Reagiert auf große Lots die "Anker" setzen (5 Stück zum Preis X werden stärker gewichtet als 1 Stück zum Preis Y).

---

## Cost-Guardrail

**Ziel:** verhindert dass du unter deinen Einkaufspreis verkaufst, auch wenn der Markt kollabiert. Sollte in fast jeder Formel als Untergrenze eingebaut sein.

> **Wichtig:** `myCost` ist bereits der **Stück-Einkaufspreis** (BL liefert das so, wir speichern 1:1). Also NICHT durch `myQty` teilen.

### 7. Standard Cost-Untergrenze — 30 % Marge auf Einkauf
```
max(sold90dMedian * 0.95, myCost * 1.30)
```
Nutzt den 5-%-Unter-Median-Preis, aber nie unter 30 % Marge auf deinen Cost.

### 8. Kombinierte Formel — Markt-fair + Cost-Guardrail + Obergrenze
```
min(
  max(sold90dMedian * 0.95, myCost * 1.30),
  stockMedian * 1.10
)
```
Marktpreis mit 30-%-Cost-Guardrail, aber gedeckelt bei 10 % über dem aktuellen Marktmedian (verhindert dass du bei niedrigen Sales aber viel Cost total überteuert wirst).

### 9. Volle Sicherheit — alle drei Grenzen
```
min(
  max(
    min(myCost * 1.30, stockMedian * 1.05),
    sold6mMedian * 0.95,
    stockMedian * 1.00
  ),
  stockMedian * 1.10
)
```
Der aktuelle Standard aus der Demo-Konfig. Auslegung: nimm den **kleineren** von "Cost + 30 %" und "Markt + 5 %", dann den **größeren** mit dem 6M-Median und dem Marktmedian, insgesamt gedeckelt bei 10 % über dem Marktmedian. Sehr defensiv.

---

## Volumen-basiert

**Ziel:** je mehr Konkurrenz oder Nachfrage, desto anders reagieren.

### 10. Bei viel Konkurrenz aggressiv unterbieten
```
stockCount > 30 ? stockMedian * 0.95 : sold90dMedian
```
Wenn > 30 Angebote am Markt sind, 5 % unter Marktmedian; sonst genau am 90d-Verkaufsmedian.

### 11. Trend-based — steigende Preise ausnutzen
```
sold30dMedian > sold90dMedian
  ? sold30dMedian * 1.02
  : sold90dMedian * 0.98
```
Wenn die letzten 30 Tage teurer waren als die letzten 90 Tage (Aufwärtstrend), 2 % über dem 30d-Median. Sonst 2 % unter dem 90d-Median (Abwärtstrend, mit dem Markt runter).

### 12. Hohe Nachfrage → Premium
```
sold30dCount > 10
  ? max(sold90dMedian * 1.05, stockMedian * 1.02)
  : sold90dMedian * 0.95
```
> 10 Verkäufe/Monat → 5 % über Median oder 2 % über Markt. Sonst 5 % unter Median.

---

## Kombiniert

### 13. Multi-Regel-Setup: Sealed vs. Complete Sets

Zwei separate Regeln in deiner Formel-Kette, weil Sealed-Sets 3-5× teurer sind:

**Regel 1** — nur SET, completeness=S (Sealed):
```
max(sold90dMedian * 0.98, myCost * 1.50)
```
Sealed = Premium, 2 % unter Median, mindestens 50 % Marge.

**Regel 2** — nur SET, completeness=C (Complete):
```
max(sold90dMedian * 0.95, myCost * 1.30)
```
Complete = Standard-Set-Formel, 5 % unter Median, mindestens 30 % Marge.

Wichtig: Regel 1 (Sealed) muss VOR Regel 2 (Complete) in der Reihenfolge stehen — die erste passende Regel gewinnt.

### 14. Minifiguren-spezifisch (kleine Stückzahlen, hohes Volumen)

Regel nur für `MINIFIG`:
```
min(
  max(sold30dMedian * 1.00, myCost * 1.40),
  stockMedian * 1.10
)
```
Am 30-Tage-Median (Minifigs bewegen sich schnell), mindestens 40 % Marge, gedeckelt bei 10 % über Marktmedian.

### 15. Parts New vs. Used

**Regel für PART Neu (`condition=N`):**
```
max(sold90dMedian * 0.95, myCost * 1.30, stockMin * 1.10)
```
Standard-Formel plus Sicherheit dass du nicht unter 110 % vom Minimum-Angebot bist.

**Regel für PART Gebraucht (`condition=U`):**
```
min(
  max(sold90dMedian * 0.90, myCost * 1.20),
  stockMedian * 0.95
)
```
Aggressiver (10 % unter Median, 20 % Marge reicht) — Used ist meist schwerer verkäuflich als Neu.

---

## Spezialfälle

### 16. Preis nur ändern wenn Markt sich stark bewegt hat

Trick mit Bool-in-Zahl:

```
abs(stockMedian - myPrice) > (myPrice * 0.15)
  ? stockMedian * 0.98
  : myPrice
```

Wenn der Marktpreis > 15 % vom aktuellen `myPrice` abweicht, ziehe nach (auf 2 % unter Markt). Sonst lass `myPrice` unverändert. **Vorsicht:** funktioniert nur wenn du die Extension NICHT nutzt (die überschreibt immer `myPrice` mit dem Ergebnis).

### 17. Rundung auf glatte Preise

```
round(sold90dMedian * 0.95, 2) * 1.00
```
Round auf 2 Nachkommastellen — glatte Preise wie 0.15 € statt 0.147. BrickStore standard ist eh 3 Nachkommastellen, aber wenn du auf Cents runden willst.

### 18. Preis nie mehr als 3× dein Cost

```
min(
  max(sold90dMedian * 0.95, myCost * 1.30),
  myCost * 3.00
)
```
Verhindert dass du bei einem hyped Teil (100× Cost) mitziehst und dann keine Käufer findest.

### 19. Fallback für Teile ohne Marktdaten

Wenn `sold90dMedian = 0` UND `stockMedian = 0` (kein Markt-Signal):
```
max(sold90dMedian * 0.95, myPrice, myCost * 1.30)
```
Fällt auf deinen aktuellen `myPrice` oder auf Cost+30% zurück — je nachdem was höher ist.

### 20. Bulk-Discount

Wenn du große Mengen anbietest, willst du evtl. günstiger sein:
```
myQty > 100
  ? sold90dMedian * 0.90
  : sold90dMedian * 0.98
```
Über 100 Stück im Lot → 10 % Rabatt gegenüber Median. Sonst nur 2 %.

---

## Deine Formel-Kette gestalten

Reihenfolge der Regeln in `/settings/pricing-formulas` ist wichtig — die **erste passende Regel gewinnt**. Empfohlene Reihenfolge (spezifisch oben, generisch unten):

1. **Sealed Sets** — SET, completeness=S
2. **Complete Sets** — SET, completeness=C
3. **Minifiguren** — MINIFIG, alle Farben
4. **Spezifische Farb-Regeln** falls du welche hast (z.B. "Dark Red PART, U — extra Rabatt weil viel Bestand")
5. **Parts Neu** — PART, N
6. **Parts Gebraucht** — PART, U
7. **Fallback** — Alle Typen, Alle Zustände (Sicherheitsnetz)

---

## KI-Assistenz beim Formel-Bauen

Wenn du eine Formel für einen speziellen Fall brauchst, kannst du eine KI (Claude, ChatGPT, Gemini) fragen. Kopier den Inhalt von [`docs/PRICING_FORMULAS.md`](../docs/PRICING_FORMULAS.md) in einen Chat und stell deine Frage:

> "Ich will eine Formel die: 30 % Marge auf Cost, aber nie mehr als 2× über dem Marktmedian, und bei mehr als 20 Anbietern am Markt zusätzlich 5 % Rabatt. Gib mir die Formel als einzige Zeile."

Die KI baut dir das dann.
