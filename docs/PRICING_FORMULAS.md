# Preisformel-Cheatsheet

Referenz für alle Variablen, Operatoren und Funktionen die in den
BrickLink-Price-Tracker-Preisformeln verfügbar sind. Diese Datei ist so
strukturiert dass sie als **Prompt-Kontext für eine KI** (Claude, ChatGPT,
Gemini etc.) genutzt werden kann — kopiere den ganzen Inhalt in ein
Chat-Fenster mit einem Prompt wie *"Bau mir eine Preisformel die 5 % über
dem Sold-90-Tage-Median liegt aber nie unter 130 % meiner Einkaufskosten
und nie mehr als 20 % über dem aktuellen Marktdurchschnitt."*

---

## Wozu Preisformeln?

Der Tracker berechnet aus den aktuellen BL-Marktdaten (Sold-Historie +
aktuelle Stock-Angebote) einen **empfohlenen Verkaufspreis** für jedes Lot
in deiner Watchlist. Deine Preisformel bestimmt **wie** dieser Preis
berechnet wird — z.B. "5 % unter dem 90-Tage-Median" oder "der höhere von
Marktdurchschnitt und 30 % Aufschlag auf meine Kosten".

Formeln werden pro Regel definiert und über Filter zugewiesen (Item-Type,
Zustand, Farbe, Kategorie, SET-Completeness). Für jedes Lot wird die
**erste passende Regel** verwendet — Reihenfolge in den Einstellungen also
wichtig, spezifische Regeln oben, "Alle Typen / Alle Zustände" als
Fallback unten.

---

## Verfügbare Variablen

Alle Variablen sind Zahlen. Fehlende Werte (kein Crawl-Ergebnis, leere
DB-Aggregate) werden als **`0`** eingesetzt — deine Formel muss damit
umgehen können (z.B. mit `max(..., minimumFallback)`).

### Sold-Median (Zentralwert der letzten Verkäufe)

| Variable | Bedeutung |
|---|---|
| `sold7dMedian` | Median-Preis der Verkäufe in den letzten 7 Tagen |
| `sold30dMedian` | Median-Preis der Verkäufe in den letzten 30 Tagen |
| `sold60dMedian` | Median-Preis der Verkäufe in den letzten 60 Tagen |
| `sold90dMedian` | Median-Preis der Verkäufe in den letzten 90 Tagen |
| `sold6mMedian` | Median-Preis der Verkäufe der letzten 6 Monate (= alles was BL liefert) |
| `soldMedian` | **Alias** für `sold6mMedian` (Rückwärts-Kompat) |

### Sold-Durchschnitt (mengengewichtet)

| Variable | Bedeutung |
|---|---|
| `sold7dAvg` | Mengengewichteter Durchschnitt der Verkäufe der letzten 7 Tage |
| `sold30dAvg` | ... letzten 30 Tage |
| `sold60dAvg` | ... letzten 60 Tage |
| `sold90dAvg` | ... letzten 90 Tage |
| `sold6mAvg` | ... letzten 6 Monate |
| `soldAvg` | **Alias** für `sold6mAvg` |

### Sold-Extreme (nur 6M-Fenster)

| Variable | Bedeutung |
|---|---|
| `sold6mMin` | Niedrigster Verkaufspreis der letzten 6 Monate |
| `sold6mMax` | Höchster Verkaufspreis der letzten 6 Monate |

### Sold-Volumen (Anzahl Deals + Stückzahlen)

| Variable | Bedeutung |
|---|---|
| `sold30dCount` | Anzahl Verkäufe (Deals) in den letzten 30 Tagen |
| `sold90dCount` | Anzahl Verkäufe in den letzten 90 Tagen |
| `sold6mCount` | Anzahl Verkäufe in den letzten 6 Monaten |
| `sold30dQty` | Summe verkaufter Stückzahlen in den letzten 30 Tagen |
| `sold90dQty` | Summe verkaufter Stückzahlen in den letzten 90 Tagen |
| `sold6mQty` | Summe verkaufter Stückzahlen in den letzten 6 Monaten |

### Stock — aktuelle Angebote am Markt

Wichtig: der Tracker aggregiert nur den **neuesten Snapshot**. Wenn du
`stockMedian` in deiner Formel nutzt, ist das der Median der Angebote wie
sie beim letzten Crawl dieses Teils standen (typischerweise heute oder
gestern).

| Variable | Bedeutung |
|---|---|
| `stockMedian` | Median-Preis der aktuellen Angebote |
| `stockAvg` | Mengengewichteter Durchschnitt der aktuellen Angebote |
| `stockMin` | Niedrigster aktueller Angebotspreis |
| `stockMax` | Höchster aktueller Angebotspreis |
| `stockCount` | Anzahl distinct Angebote (Lots) am Markt |
| `stockQty` | Summe angebotener Stückzahlen |

### Deine eigenen Daten (aus der Watchlist)

| Variable | Bedeutung |
|---|---|
| `myPrice` | Dein aktueller Verkaufspreis für dieses Lot |
| `myQty` | Deine aktuelle Menge (Stück) |
| `myCost` | **Deine Einkaufskosten für den GANZEN Lot** (nicht per Stück!) |

> **Achtung `myCost`:** BL speichert Cost als Lot-Gesamtsumme, nicht als
> Stückpreis. Wenn du 100 Stück für 5.00 € eingekauft hast, ist
> `myCost = 5.00`, nicht `0.05`. Deine Formel muss `myCost / myQty` rechnen
> um auf den Stück-Einkaufspreis zu kommen. Beispiel:
> `max(sold90dMedian, myCost / myQty * 1.30)` — mindestens 30 % Marge auf
> deinen Stück-Einkaufspreis.

---

## Operatoren

Standard-Arithmetik + Vergleiche + Ternär (Wenn-Dann-Sonst).

### Arithmetik

| Operator | Bedeutung |
|---|---|
| `+` `-` `*` `/` | Grundrechenarten |
| `-x` | Vorzeichen-Umkehr (unär) |

Division durch 0 gibt `0` zurück (keine Exception).

### Vergleiche

Vergleiche liefern **`1` bei true, `0` bei false** — nutzbar in
Multiplikationen oder Ternär.

| Operator | Bedeutung |
|---|---|
| `>` `<` | Größer / Kleiner |
| `>=` `<=` | Größer-Gleich / Kleiner-Gleich |
| `==` `!=` | Gleich / Ungleich |

### Ternär (Wenn-Dann-Sonst)

`cond ? valueIfTrue : valueIfFalse`

Beispiel: `stockCount > 20 ? sold90dMedian * 0.95 : sold90dMedian`
(bei viel Konkurrenz 5 % unterbieten, sonst genau am Median bleiben)

---

## Funktionen

| Funktion | Signatur | Bedeutung |
|---|---|---|
| `min(a, b, ...)` | Beliebig viele Argumente | Kleinster Wert |
| `max(a, b, ...)` | Beliebig viele Argumente | Größter Wert |
| `avg(a, b, ...)` | Beliebig viele Argumente | Arithmetischer Mittelwert |
| `abs(x)` | 1 Argument | Absolutbetrag |
| `round(x)` | 1 Argument | Runde auf 2 Nachkommastellen |
| `round(x, n)` | 2 Argumente | Runde auf `n` Nachkommastellen |

Das Endergebnis der ganzen Formel wird automatisch auf **4 Nachkommastellen
gerundet** (`0.1234`) — der `round()`-Aufruf ist nur nötig wenn du gröbere
Rundung willst (z.B. `round(x, 3)` für 3 Nachkommastellen wie
BrickStore/BrickLink Standard).

---

## Häufige Formel-Bausteine

### 1. "Immer x % unter dem 90-Tage-Median"

```
sold90dMedian * 0.95
```

Einfachster Ansatz für Standard-Wettbewerbspreis.

### 2. "Der höhere von 90-Tage-Median und aktuellem Marktdurchschnitt"

```
max(sold90dMedian * 0.95, stockMedian)
```

Verhindert Preisverfall wenn ein neuer Anbieter mit zu niedrigem Preis
den Markt drückt.

### 3. "Mindestens 30 % Marge auf den Einkauf, sonst Marktpreis"

```
max(sold90dMedian * 0.95, myCost / myQty * 1.30)
```

Guardrail gegen Verlust-Verkäufe.

### 4. "Marktpreis, aber nicht mehr als 10 % über dem Marktmedian"

```
min(max(myCost / myQty * 1.30, sold90dMedian * 0.95),
    stockMedian * 1.10)
```

Kombiniert Cost-Untergrenze mit Markt-Obergrenze.

### 5. "Bei viel Konkurrenz aggressiv unterbieten"

```
stockCount > 30 ? stockMedian * 0.95 : sold90dMedian
```

Wenn > 30 Angebote am Markt sind, 5 % unter dem Marktmedian; sonst genau
am Sold-Median.

### 6. "Trend-based" — steigende Preise ausnutzen

```
sold30dMedian > sold90dMedian
  ? sold30dMedian * 1.02
  : sold90dMedian * 0.98
```

Wenn die letzten 30 Tage teurer waren als die letzten 90 Tage (Aufwärts-
trend), 2 % über dem 30d-Median. Sonst 2 % unter dem 90d-Median.

### 7. "Volumen-Check — verkaufe teurer wenn viel Umschlag ist"

```
sold30dCount > 10
  ? max(sold90dMedian * 1.05, stockMedian * 1.02)
  : sold90dMedian * 0.95
```

Hohe Nachfrage (>10 Verkäufe/Monat) → 5 % über Median oder 2 % über Markt.
Niedrige Nachfrage → 5 % unter Median.

### 8. "Fallback für Teile ohne Marktdaten"

```
max(sold90dMedian * 0.95, myPrice, myCost / myQty * 1.30)
```

Wenn `sold90dMedian` und `stockMedian` beide 0 sind (kein Markt-Signal),
fällt die Formel auf `myPrice` oder `myCost + 30 %` zurück — je nachdem
was höher ist.

### 9. Deine aktuelle Formel (aus dem Repo als Beispiel)

```
min(max(min(myCost / myQty * 1.30, stockMedian * 1.05),
        sold6mMedian * 0.95,
        stockMedian * 1.00),
    stockMedian * 1.10)
```

Auslegung: nimm den kleineren von (`myCost + 30 %` und `Markt + 5 %`),
dann den größeren mit dem 6M-Median und mit dem Marktmedian — insgesamt
gedeckelt bei 10 % über dem Marktmedian.

---

## Design-Prinzipien für gute Formeln

1. **Immer eine Untergrenze setzen** (`max(..., myCost / myQty * X.XX)`)
   — verhindert Verlust-Verkäufe wenn der Markt zusammenbricht.
2. **Immer eine Obergrenze setzen** (`min(..., stockMedian * X.XX)`) —
   verhindert dass du wegen fehlender Sales unrealistisch teuer bist und
   nichts mehr verkaufst.
3. **Median statt Durchschnitt bevorzugen** — Durchschnitt wird von
   Ausreißern verzerrt (ein 100 €-Verkauf bei sonst 1 €-Preisen).
4. **90d bevorzugen wenn nicht anders bekannt** — 30d hat oft zu wenig
   Datenpunkte, 6M kann veraltete Preise mitziehen.
5. **`stockMedian` sanity-check** — `stockMedian` kann 0 sein wenn beim
   letzten Crawl gerade niemand Angebote hatte. Immer eine `max()`- oder
   Fallback-Klausel dazu.
6. **Fehlende Marktdaten:** wenn `sold90dMedian = 0` UND `stockMedian = 0`,
   ist der Empfehlungspreis 0. Der Tracker überspringt solche Lots beim
   BSX-Export bzw. bei der Extension (`>0`-Guard). Wenn du das nicht willst:
   `max(..., myPrice)` als letzter Fallback.

---

## Regel-Filter (nicht Teil der Formel, aber wichtig für die Auswertung)

Regeln haben pro Regel ein Filter-Objekt das bestimmt welche Lots die
Regel matchen. Die **erste matchende Regel** in der Reihenfolge gewinnt.

| Filter | Werte | Bedeutung |
|---|---|---|
| `itemType` | `PART` / `MINIFIG` / `SET` / `*` | Item-Typ oder alle |
| `condition` | `N` / `U` / `*` | Neu / Gebraucht / alle |
| `colorId` | Array von Color-IDs (leer = alle) | z.B. `[1, 5]` für Weiß + Rot |
| `categoryId` | Array von Category-IDs (leer = alle) | z.B. `[26]` für Series-Minifigs |
| `completeness` | `C` / `I` / `S` / `*` (nur bei SET) | Complete / Incomplete / Sealed |

**Beispiel-Reihenfolge einer Regel-Kette:**

1. `Sealed Sets — SET, Completeness=S` → höherer Aufschlag
2. `Complete Sets — SET, Completeness=C` → Standard-Set-Formel
3. `Minifiguren — MINIFIG, alle` → Minifig-Formel
4. `Parts Neu — PART, N` → New-Parts-Formel
5. `Parts Gebraucht — PART, U` → Used-Parts-Formel
6. `Fallback — Alle Typen, Alle Zustände` → Sicherheits-Fallback

---

## Grenzen & Fehler-Verhalten

- **Fehler in der Formel** (Syntax, unbekannte Funktion) → `evaluateFormula`
  returned `null`, `suggestedPrice` wird `null`. Der Watchlist-Eintrag hat
  dann keine Empfehlung.
- **Unbekannte Variable** → wird als `0` behandelt (keine Exception). Also
  z.B. `sold180dMedian` (existiert nicht) evaluiert auf `0`.
- **Division durch 0** → returns `0`, keine Exception.
- **NaN/Infinity** (z.B. durch Division) → returned `null`.
- **Endergebnis > 0** ist Pflicht, sonst wird der Preis nicht in die
  Watchlist geschrieben (verhindert unbeabsichtigte Gratis-Angebote).

---

## KI-Prompt-Template

Wenn du eine KI eine Formel bauen lassen willst, ist dieser Prompt-Anfang
gut geeignet:

> Ich habe einen BrickLink-Preis-Tracker mit einem Preisformel-Feature.
> Bitte bau mir eine Preisformel die [Anforderung]. Die verfügbaren
> Variablen und Operatoren stehen im angehängten Dokument. Nutze möglichst
> `min()` und `max()` als Sicherheits-Klammern, bevorzuge Median statt
> Durchschnitt, und arbeite immer mit `myCost / myQty` (nicht nur `myCost`)
> weil BL Cost als Lot-Gesamtsumme speichert. Gib mir die Formel als
> einzige Zeile ohne Kommentar, und erkläre in 2-3 Sätzen darunter was sie
> tut.

Kopiere danach den ganzen Inhalt dieser Datei als Anhang / zweite Nachricht
mit. Die KI hat dann alles was sie braucht.
