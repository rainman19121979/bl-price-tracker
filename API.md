# BrickLink Price Tracker — External API

REST-API für externe Tools (externe Inventar-Management-Tools, BrickSync, N8N, eigene Scripts). Bearer-Token-Auth, JSON-only, mit Live-Rate-Limit-Info in jeder Response.

**Base URL (lokal):** `http://localhost:3000`
**Base URL (Produktion):** `https://<dein-host>`

---

## Authentifizierung

Alle Endpoints verlangen einen **Bearer-Token** im `Authorization`-Header. Tokens werden pro Benutzer unter `/settings` → "API-Tokens" verwaltet.

```
Authorization: Bearer <TOKEN>
```

- Fehlt oder ungültig → `401 { "error": "Bearer token required or invalid" }`
- `last_used_at` wird bei jedem erfolgreichen Call aktualisiert
- Tokens haben keine Ablaufzeit — bei Verlust manuell löschen und neu erstellen

---

## `apiUsage` in jeder Response

Jede Antwort (Erfolg wie Fehler) enthält das aktuelle Rate-Limit-Fenster:

```json
"apiUsage": {
  "used": 772,       // BL-API-Calls in den letzten 24h (Crawler + Web + externe API)
  "external": 0,     // geschätzte externe Calls aus per-key externalCalls JSON
  "limit": 4000,     // konfigurierter dailyLimit
  "remaining": 3228  // limit - used - external
}
```

Nutze das um vor größeren Aktionen zu prüfen ob Budget da ist, oder um dein Client-Rate-Limiting anzupassen.

`null` wenn der User keinen gültigen BL-API-Key hinterlegt hat.

---

## Endpoint-Übersicht

| Methode | Pfad | Zweck | BL-Calls |
|---|---|---|---|
| GET | `/api/external/price` | Einzelpreis mit Empfehlung | 0-2 |
| POST | `/api/external/price/batch` | Mehrere Preise (max 100) | 0-2 pro neuem Teil |
| POST | `/api/external/watchlist/lots` | **Lots pushen** — Preistracker holt Inventar NICHT selbst | 0-2 pro neuem Teil |
| DELETE | `/api/external/watchlist/lots` | Lots entfernen | 0 |
| POST | `/api/external/inventory/sync` | Voller BL-Sync (Legacy — nur wenn nichts pusht) | 1+ |
| POST | `/api/external/inventory/recompute` | Nur Cache neu rechnen, kein BL | 0 |
| GET | `/api/external/sales` | Meine Verkäufe abrufen (aus BSX-Import) | 0 |

**Empfohlene Nutzung wenn ein externes Tool die Inventar-Hoheit hat:**
- Bei Änderungen: `POST /watchlist/lots` mit dem geänderten Lot
- Bei Löschung: `DELETE /watchlist/lots`
- Legacy Auto-Sync in `/settings` **ausschalten** (`autoSyncInventory=false`)

---

## 1. `GET /api/external/price` — Einzelner Preis

Liefert Empfehlungspreis + Markt-Daten für **ein** Teil. Legt Teile bei Bedarf on-demand an; holt frische Daten wenn `last_*_crawl` älter als `freshDays` (User-Setting, default 14) ist.

**Query-Parameter (alle Pflicht):**

| Parameter | Typ | Beispiel |
|---|---|---|
| `partNo` | string | `3024` |
| `colorId` | int | `1` |
| `itemType` | string | `PART`, `MINIFIG`, `SET` |
| `condition` | string | `N` (neu), `U` (gebraucht) |

**Beispiel:**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/external/price?partNo=3024&colorId=1&itemType=PART&condition=N"
```

**Response 200:**

```json
{
  "partNo": "3024",
  "colorId": 1,
  "itemType": "PART",
  "condition": "N",
  "suggestedPrice": 0.037,
  "rule": "Parts Neu",
  "stockMedian": 0.0371,
  "stockAvg": 0.0467,
  "stockMin": 0.01,
  "stockMax": 0.3645,
  "stockOffers": 734,
  "soldMedian": 0.0351,
  "soldAvg": 0.0312,
  "lastSoldFetch": "2026-07-20T11:14:36.158Z",
  "lastStockFetch": "2026-07-22T03:50:34.793Z",
  "freshlyCrawled": false,
  "apiUsage": {"used": 772, "external": 0, "limit": 4000, "remaining": 3228}
}
```

**Fehler:**

| Status | Bedingung |
|---|---|
| 400 | Fehlende / ungültige Parameter |
| 401 | Token fehlt / ungültig |
| 429 | BL Tageslimit erreicht |
| 502 | BL fetch fehlgeschlagen (Part existiert nicht auf BL) |
| 503 | Kein gültiger BL API-Key hinterlegt |

---

## 2. `POST /api/external/price/batch` — Mehrere Preise

Bis zu **100 Teile pro Request**. Verarbeitung sequentiell (respektiert BL API-Budget). Fehlerhafte Items bleiben im Response — der Gesamtstatus ist immer 200 sofern die Auth stimmt.

**Body:**

```json
{
  "items": [
    {"partNo": "3024", "colorId": 1, "itemType": "PART", "condition": "N"},
    {"partNo": "3023", "colorId": 5, "itemType": "PART", "condition": "U"}
  ]
}
```

**Response 200:**

```json
{
  "count": 2,
  "items": [
    { /* wie GET /price */ },
    { /* … oder {"partNo":"XXBAD", …, "error":"BL fetch failed"} */ }
  ],
  "apiUsage": {"used": 772, "external": 0, "limit": 4000, "remaining": 3228}
}
```

**Fehler:**

| Status | Bedingung |
|---|---|
| 400 | Body kein `{ items: [...] }` oder > 100 Items |
| 401 | Token fehlt / ungültig |

---

## 3. `POST /api/external/watchlist/lots` — Lots pushen (empfohlen für externe Inventar-Tools)

**Warum dieser Endpoint statt `/inventory/sync`?** Wenn ein anderes Tool die Inventar-Hoheit hat und alle Lot-Daten kennt, ist ein Preistracker-eigener `getInventory` Call an BrickLink verschwendet. Dieser Endpoint nimmt die Lot-Daten direkt entgegen und trägt sie in `user_watchlists` ein — **ohne eigenen Inventar-BL-Call**.

**Body:**

```json
{
  "lots": [
    {
      "blInventoryId": 123456789,
      "partNo": "3024",
      "colorId": 1,
      "itemType": "PART",
      "condition": "N",
      "myPrice": 0.045,
      "myQuantity": 100,
      "myCost": 2.50,
      "description": "Lot-Beschreibung",
      "remarks": "Interne Notiz",
      "saleRate": 10,
      "priceLocked": false
    }
  ]
}
```

**Pflichtfelder pro Lot:** `blInventoryId`, `partNo`, `colorId`, `itemType`, `condition`

**Optionale Felder:** `myPrice`, `myQuantity`, `myCost` (Lot-Gesamtkosten, NICHT per Stück!), `description`, `remarks`, `saleRate`, `priceLocked`

**Query-Parameter (optional):**

| Parameter | Default | Beschreibung |
|---|---|---|
| `skipPriceFetch` | `false` | Wenn `true`: Preistracker macht NIE BL-Calls, nur DB-Upsert. `suggestedPrice` bleibt bis zum nächsten Crawl null. Nützlich für Bulk-Imports. |

**Was passiert pro Lot:**

1. Part-Lookup nach `(partNo, colorId, itemType)`. Wenn nicht in DB: `parts` on-demand angelegt.
2. Preisdaten prüfen: wenn älter als `freshDays` oder fehlend → 2 BL-Calls (sold + stock). Bei Cache-Hit: **0 BL-Calls**.
3. Watchlist-Upsert nach `(userId, blInventoryId)` — insert oder update.
4. `recomputeLotPricing` → `suggestedPrice`, `marketStockMedian`, `marketSoldMedian`, `trend` berechnet.
5. Response mit allen Feldern.

**Beispiel:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"lots":[{"blInventoryId":123456789,"partNo":"3024","colorId":1,"itemType":"PART","condition":"N","myPrice":0.045,"myQuantity":100,"myCost":2.50}]}' \
  "http://localhost:3000/api/external/watchlist/lots"
```

**Response 200:**

```json
{
  "count": 1,
  "created": 1,
  "updated": 0,
  "errors": 0,
  "blApiCalls": 0,
  "durationMs": 145,
  "results": [
    {
      "blInventoryId": 123456789,
      "partNo": "3024",
      "colorId": 1,
      "itemType": "PART",
      "condition": "N",
      "wasCreated": true,
      "partWasCreated": false,
      "freshlyCrawled": false,
      "suggestedPrice": 0.037,
      "suggestedRuleName": "Parts Neu",
      "marketStockMedian": 0.0371,
      "marketSoldMedian": 0.0350,
      "trend": "stable"
    }
  ],
  "apiUsage": {"used": 772, "external": 0, "limit": 4000, "remaining": 3228}
}
```

**Response-Felder pro Lot:**

| Feld | Bedeutung |
|---|---|
| `wasCreated` | true = Watchlist-Eintrag neu, false = update |
| `partWasCreated` | true = Part war unbekannt, wurde angelegt |
| `freshlyCrawled` | true = BL-Call wurde gemacht (2 Calls) |
| `suggestedPrice` | Empfehlungspreis aus deiner Formel, gerundet auf 3 Nachkommastellen |
| `suggestedRuleName` | Name der matchenden Regel (z.B. "Parts Neu") |
| `marketStockMedian` | Aktueller Markt-Median (Stock) |
| `marketSoldMedian` | Sold-Median 6 Monate |
| `trend` | `"up"`, `"down"`, `"stable"` — 30d vs 60d Sold-Median |

Bei Item-Fehler (z.B. BL 404):

```json
{"blInventoryId": 999, "partNo": "XXBAD", "error": "BL fetch failed"}
```

**Fehler:**

| Status | Bedingung |
|---|---|
| 400 | Body kein `{ lots: [...] }` oder > 100 Lots |
| 401 | Token fehlt / ungültig |

---

## 4. `DELETE /api/external/watchlist/lots` — Lots entfernen

Zwei Varianten:

**A) Einzeln per Query:**

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/external/watchlist/lots?blInventoryId=123456789"
```

**B) Batch per Body:**

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"blInventoryIds":[111,222,333]}' \
  "http://localhost:3000/api/external/watchlist/lots"
```

**Response 200:**

```json
{
  "deleted": 3,
  "requested": 3,
  "apiUsage": {"used": 772, "external": 0, "limit": 4000, "remaining": 3228}
}
```

`deleted` kann kleiner als `requested` sein wenn manche IDs nicht existieren (oder anderem User gehören — Multi-User-safe).

---

## 5. `POST /api/external/inventory/sync` — Voller BL-Sync

**Legacy-Endpoint** — nur nötig wenn KEIN externes Tool die Lots pusht. Wenn ein externes Tool `/watchlist/lots` nutzt, kannst du diesen Endpoint ignorieren und den Auto-Sync in Settings abschalten.

Triggert denselben Sync wie die automatische `autoSyncInventory` Funktion (Scheduler alle 5 Min).

**Was passiert:**

1. Holt komplettes BrickLink-Inventar (**1 BL API-Call** für `getInventory`)
2. Vergleicht mit lokalem Stand: added / updated / removed
3. **Optional:** holt für jedes neu hinzugekommene Teil sofort Preisdaten (kostet weitere BL-Calls, respektiert Tageslimit)
4. Recomputed am Ende alle Lot-Empfehlungen

**Query-Parameter (optional):**

| Parameter | Default | Beschreibung |
|---|---|---|
| `fetchNewParts` | `true` | Wenn `false` werden für neue Teile NUR die Lot-Einträge angelegt, KEINE Preisdaten geholt (1 BL-Call statt N+1) |

**Beispiel:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/external/inventory/sync"
```

**Response 200:**

```json
{
  "success": true,
  "durationMs": 18234,
  "totalLots": 9784,
  "added": 3,
  "updated": 124,
  "removed": 0,
  "errors": 0,
  "newParts": 3,
  "priceFetches": 3,
  "priceFetchErrors": 0,
  "apiUsage": {"used": 780, "external": 0, "limit": 4000, "remaining": 3220}
}
```

**Timeout:** `maxDuration=300s`. In Praxis 15-60s je nach Inventar-Größe.

**Fehler:**

| Status | Bedingung |
|---|---|
| 401 | Token fehlt / ungültig |
| 500 | Sync-Fehler (Details im `error`-Feld) |

---

## 6. `POST /api/external/inventory/recompute` — Nur Empfehlungspreise neu rechnen

**Kein BL-API-Call.** Rechnet für alle Lots des Users die Cache-Felder neu:
`suggested_price`, `suggested_rule_name`, `market_stock_median`, `market_sold_median`, `trend`, `pricing_computed_at`.

Basiert komplett auf bereits vorhandenen `price_sales` / `price_stock` Daten und den aktuellen Pricing-Formeln des Users.

**Anwendungsfälle:**
- Nach Änderung der Pricing-Formeln (im UI passiert das automatisch)
- Wenn ein externes Tool eine Preis-Neubewertung anstoßen möchte ohne BL-Daten neu zu holen
- Bulk-Refresh nach Import von Fremd-Preisdaten

**Beispiel:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/external/inventory/recompute"
```

**Response 200:**

```json
{
  "success": true,
  "recomputed": 9753,
  "durationMs": 11751,
  "apiUsage": {"used": 772, "external": 0, "limit": 4000, "remaining": 3228}
}
```

**Timeout:** `maxDuration=120s`. In Praxis ~10-15s für ~10.000 Lots.

---

## 7. `GET /api/external/sales` — Meine Verkäufe abrufen

Liefert die aus BSX importierten eigenen Verkäufe. Kein BL-Call, keine Nebenwirkungen — reine Read-API.

**Query-Parameter (alle optional):**

| Parameter | Default | Beschreibung |
|---|---|---|
| `platform` | alle | `BL` oder `BO` — nur der genannte Marktplatz |
| `since` | keiner | ISO-Datum `YYYY-MM-DD` — nur Verkäufe ab diesem Datum |
| `until` | keiner | ISO-Datum — nur Verkäufe vor diesem Datum |
| `limit` | 100 | max 500 Zeilen pro Response |
| `offset` | 0 | für Pagination |

**Beispiel:**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/external/sales?since=2026-01-01&platform=BL&limit=200"
```

**Response 200:**

```json
{
  "count": 1247,
  "limit": 200,
  "offset": 0,
  "sales": [
    {
      "id": 3412434,
      "soldAt": "2026-08-11T20:58:07.000Z",
      "platform": "BL",
      "orderId": "20851234",
      "partNo": "3024",
      "colorId": 1,
      "colorName": "White",
      "itemType": "PART",
      "condition": "N",
      "quantity": 5,
      "unitPrice": 0.04
    }
  ],
  "apiUsage": {"used": 42, "external": 0, "limit": 4000, "remaining": 3958}
}
```

Der Kundenname (`customer`) wird bewusst NICHT über die API ausgeliefert (DSGVO).

**Fehler:**

| Status | Bedingung |
|---|---|
| 400 | `since`/`until` nicht als Datum parsebar |
| 401 | Token fehlt / ungültig |

---

## Rate Limits & Best Practices

**Zwei getrennte Limit-Ebenen — beide können 429 zurückliefern:**

**1. Per-Token Request-Rate (dieser API-Layer, seit v0.1.1):**
- **120 Requests / Minute** pro Bearer-Token (rollierendes 60-Sek-Fenster)
- **Burst-Schutz: 20 Requests / 5 Sekunden** — schnellere Bursts blocken
- Beide Buckets pro Token unabhängig. Bei Überschreitung: HTTP 429 mit `Retry-After` Header und JSON-Body `{error, retryAfterSec, limits}`
- Redis-backed, überlebt keinen Redis-Ausfall (Fail-Open: bei Redis-down werden Requests durchgelassen)

**2. BrickLink API Tageslimit** (dein hinterlegtes `dailyLimit` auf dem BL-API-Key, Standard 1000 — bei BL bis auf 5000 max erhöhbar). Wird geteilt zwischen Crawler, Web-App, externer API und externen Tools die du in Settings deklarierst. Bei Überschreitung: HTTP 429 mit `error: "API daily limit exhausted"`.

**Best Practices:**
- **Batch statt Einzel:** `POST /price/batch` und `POST /watchlist/lots` mit bis zu 100 Items statt N × GET — spart Rate-Limit-Slots (1 Request statt 100)
- **`skipPriceFetch=true`** beim Lot-Push wenn Preise ohnehin per Crawler kommen — spart alle BL-Calls dieses Requests
- **`fetchNewParts=false`** beim Inventar-Sync wenn du Preise separat via `/price/batch` holst
- **Fresh Data:** Ergebnisse aus dem Cache wenn `lastSoldFetch`/`lastStockFetch` innerhalb `freshDays` liegen. Erhöhe `freshDays` in Settings um mehr Cache-Hits (Default 180 Tage / 6 Monate)
- **`apiUsage` monitoren:** In jeder Response steht `apiUsage.remaining`. Verwende das um vor Bulk-Aktionen zu prüfen ob genug BL-Budget da ist
- **Idempotent:** Alle POST-Endpoints sind idempotent — mehrfaches Aufrufen ist unproblematisch (außer BL API-Budget-Verbrauch)
- **Bei 429 wegen Rate-Limit:** `Retry-After`-Header respektieren. Bei kurzen Bursts einfach `sleep(retryAfterSec)`; bei langen Batch-Jobs die Anzahl der parallelen Requests reduzieren (aus 10-parallel machen 3-parallel)

---

## Fehler-Behandlung

Alle Fehler kommen als JSON `{ "error": "...", "apiUsage": {...} }` mit passendem HTTP-Status.

**Zwei verschiedene 429-Fälle unterscheiden:**

```jsonc
// Fall 1: dein Bearer-Token hat die Request-Rate überschritten (120/min oder 20/5s Burst)
HTTP 429  Retry-After: 42
{
  "error": "Rate limit exceeded",
  "retryAfterSec": 42,
  "limits": { "perMinute": 120, "burst5s": 20 }
}
// → warte retryAfterSec Sekunden, dann nochmal
// → für Bulk-Jobs: Parallelität reduzieren
```

```jsonc
// Fall 2: dein BL-Tageslimit (dailyLimit auf dem API-Key) ist aufgebraucht
HTTP 429
{
  "error": "API daily limit exhausted",
  "apiUsage": { "used": 5000, "external": 0, "limit": 5000, "remaining": 0 }
}
// → warte aufs Rolling-24h-Fenster (siehe apiUsage.remaining recovering)
// → oder erhöhe dailyLimit in Einstellungen (max was BL erlaubt)
```

Bei `502 BL fetch failed` mit "not found" wird das Part automatisch aus der DB gelöscht (wenn es on-demand angelegt wurde).

---

## Empfohlener Flow für externe Inventar-Tools

**Für neues Teil das eingestellt wird:**

```python
BASE = "https://tracker.example.com"
TOKEN = os.environ["BL_PRICE_TRACKER_TOKEN"]
headers = {"Authorization": f"Bearer {TOKEN}"}

# 1. (Optional) Preise vorab abrufen um Einkaufsentscheidung zu treffen
r = requests.post(f"{BASE}/api/external/price/batch",
    json={"items": [{"partNo": "3024", "colorId": 1, "itemType": "PART", "condition": "N"}]},
    headers=headers)
suggested = r.json()["items"][0]["suggestedPrice"]

# 2. Teil bei BL einstellen (via BL-eigener API), du kennst blInventoryId
bl_inv_id = create_lot_on_bricklink(part_no="3024", price=suggested, qty=100)

# 3. Bei uns registrieren — 0 BL-Calls wenn Part bekannt (Schritt 1 hat Preise geholt)
requests.post(f"{BASE}/api/external/watchlist/lots",
    json={"lots": [{
        "blInventoryId": bl_inv_id,
        "partNo": "3024", "colorId": 1, "itemType": "PART", "condition": "N",
        "myPrice": suggested, "myQuantity": 100, "myCost": 2.50
    }]},
    headers=headers)
```

**Für Änderung (Preis/Menge/Cost geändert):**

```python
requests.post(f"{BASE}/api/external/watchlist/lots",
    json={"lots": [{"blInventoryId": 123, "partNo":..., ..., "myPrice": 0.05, "myQuantity": 80}]},
    headers=headers)
# 0 BL-Calls, nur DB-Upsert + Recompute
```

**Für Verkauf/Löschung:**

```python
requests.delete(f"{BASE}/api/external/watchlist/lots",
    params={"blInventoryId": 123}, headers=headers)
```

**Nach Formel-Änderung:**

```python
requests.post(f"{BASE}/api/external/inventory/recompute", headers=headers)
# Rechnet alle Empfehlungen neu, ohne BL zu kontaktieren
```

**Wichtig:** in `/settings` `autoSyncInventory=false` setzen wenn ein externes Tool die Lot-Hoheit hat — sonst schreibt der Auto-Sync alle 5 Min mit BL-Daten drüber.

---

## Beispiel: N8N Workflow

1. **HTTP Request** Node — Authentication: Header Auth, Name `Authorization`, Value `Bearer YOUR_TOKEN`
2. URL: `https://tracker.example.com/api/external/price/batch`
3. Method: POST, Body Content-Type: JSON
4. Body: `{"items": [{...aus vorherigem Node...}]}`
5. Optional: Prüfe `{{$json.apiUsage.remaining}}` vor dem nächsten Call
