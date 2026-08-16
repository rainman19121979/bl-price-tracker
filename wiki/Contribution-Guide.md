# Contribution-Guide

Diese Seite ist für Entwickler die contributen wollen. Sie erklärt die Code-Struktur, wichtige Design-Entscheidungen, und typische Contribution-Muster.

**Vor jedem Beitrag:** einmal [`CLAUDE.md`](../CLAUDE.md) lesen — dort steht die vollständige Architektur-Übersicht. Diese Wiki-Seite ist die kurze Version fürs erste Aufnehmen.

---

## Repo-Struktur

```
/root/bl-price-tracker/
├── src/
│   ├── app/                       # Next.js 14 App-Router
│   │   ├── (auth)/                # Login + Register (Bootstrap-only)
│   │   ├── (dashboard)/           # Alle authentifizierten Seiten
│   │   └── api/                   # REST-Endpoints
│   │       ├── external/          # Bearer-Token API (für Extensions, N8N etc.)
│   │       ├── admin/             # Admin-only
│   │       └── prices/            # Preisdaten pro Part
│   ├── components/                # React-Components (feature-basiert)
│   ├── lib/                       # Shared Logic (Prisma, Crawler-Utils, etc.)
│   ├── workers/                   # Standalone-Prozesse (Crawler, Scheduler)
│   └── middleware.ts              # Auth-Guard, CSRF, publicPaths
├── prisma/
│   ├── schema.prisma              # Prisma-Schema (Source of Truth)
│   └── migrations/                # SQL-Migrations (numerisch nach Datum)
├── extensions/brickstore/         # QML-Extension für BrickStore
├── docs/                          # Deep-Dive-Docs (PRICING_FORMULAS.md, etc.)
├── wiki/                          # Diese Wiki-Seiten (Community-editierbar)
├── scripts/                       # install.sh, init-env.sh
└── docker-compose.yml + Dockerfile
```

---

## Tech-Stack (kurz)

- **Runtime:** Node.js 20+, TypeScript
- **Frontend:** Next.js 14 (App Router), Tailwind + shadcn/ui, Recharts für Charts
- **Backend:** Next.js API Routes (kein separater Backend-Prozess)
- **Auth:** NextAuth v5 (Credentials Provider, JWT-Session)
- **DB:** PostgreSQL 15+ mit Prisma ORM
- **Cache:** Redis (Rate-Limits, Crawler-State, Update-Version-Check)
- **Worker:** plain TypeScript-Loops via tsx (kein BullMQ, kein Queue-System)
- **Validierung:** Zod
- **BL-API-Client:** OAuth 1.0 (Custom-Implementation in `src/lib/bricklink-api.ts`)

---

## Häufige Contribution-Typen

### 1. Neue Preisformel-Variable hinzufügen

**Zweck:** eine neue Zahl die Nutzer in ihrer Preisformel verwenden können (z.B. `sold14dMedian` für ein 14-Tage-Fenster).

**Schritte:**

1. **Aggregation-SQL erweitern** in `src/lib/lot-pricing.ts` (Funktionen `fetchSoldStatsForParts` / `fetchStockStatsForParts`). Neuen Filter-Wert `PERCENTILE_CONT(...) FILTER (WHERE date_ordered >= $X)` einfügen.
2. **TypeScript-Interface** `SoldStats` / `StockStats` um neues Feld erweitern.
3. **`makeVars()`-Mapping** in `src/lib/lot-pricing.ts` — das neue Feld in `PricingVars` einsetzen (Kebab-Case aus DB → camelCase für Formel).
4. **`VAR_DESCRIPTIONS`** in `src/lib/pricing-engine.ts` — neuer Eintrag mit Beschreibung (wird in der UI-Tooltip angezeigt).
5. **`docs/PRICING_FORMULAS.md`** — Variable + Beschreibung in die Tabelle einfügen, ein Beispiel in "Bausteine" ergänzen.
6. **`wiki/Preisformel-Rezepte.md`** — falls sinnvoll ein neues Rezept mit der Variable.

Analog wenn du eine neue Funktion (`log`, `sqrt` etc.) hinzufügen willst — in `pricing-engine.ts` in `FUNCTIONS` eintragen.

### 2. Neue BrickStore-Extension bauen

**Zweck:** eine weitere .bs.qml die einen anderen Workflow abdeckt (z.B. "Preise aus Tracker holen UND direkt zu BL hochladen").

**Schritte:**

1. In `extensions/brickstore/` neue `.bs.qml` anlegen.
2. Als Vorlage die bestehende `bricklink-price-tracker.bs.qml` — sie zeigt: `ExtensionScriptAction` deklarieren, HTTP-Calls per XMLHttpRequest, schreibbare Lot-Refs per `doc.lots.at(i)` (NICHT `doc.selectedLots` — die sind const!).
3. Wichtige BrickStore-QML-Beschränkungen kennen:
   - **Keine Dialoge aus async-Kontext** — `MessageDialog.open()` wird stumm geblockt. Reports gehen nur per `console.log` in die Developer Console.
   - **Sync-`throw new Error()`** funktioniert in `actionFunction`, wird als Popup gezeigt (nur für Startup-Errors nutzbar).
   - **`import BrickStore 1.1`** ohne Namespace-Alias — Aliasing (`as BS`) crashed.
4. In README-Sektion "Preisempfehlungen übertragen" die neue Extension erwähnen, in der Extension-Wiki-Seite dokumentieren.

### 3. Neuen External-API-Endpoint hinzufügen

**Zweck:** eine neue Route unter `/api/external/*` für externe Tools (Inventar-Manager, Automation-Flows etc.).

**Schritte:**

1. `src/app/api/external/<dein-endpoint>/route.ts` anlegen.
2. **Immer** an `authenticateBearer()` (aus `src/lib/external-price.ts`) anbinden — kein External-Endpoint ohne Token-Auth.
3. **Immer** `enforceExternalRateLimit()` aufrufen für Rate-Limit (120/min, 20/5sec burst pro Token).
4. Response um `apiUsage: await getApiUsageFor(userId)` erweitern — dann sieht der Konsument sein Budget.
5. `API.md` mit Beispiel-Request + -Response ergänzen.
6. Middleware (`src/middleware.ts`) NICHT anfassen — `/api/external/*` ist bereits in `publicPaths` erlaubt (Token-Auth greift im Handler).

### 4. Neue Preis-Aggregation / Query

**Wichtig: das SQL-Performance-Muster** (siehe [`CLAUDE.md`](../CLAUDE.md) → "SQL performance"):

- **`WITH latest AS (SELECT DISTINCT ON ...)` + JOIN** — für "neuester Snapshot pro Part". Immer so.
- **NIEMALS korrelierte Subquery** `fetched_at = (SELECT MAX(...) FROM price_stock ps2 WHERE ...)` — das dauert 4-43 Sek bei vielen Parts.
- **Country-Filter:** siehe `getCountryFilters()` in `src/lib/user-settings.ts` — liefert `{shippingCountries, sellerCountries}` pro User. Sold nutzt beide, Stock nutzt nur sellerCountries + `'XX'`-Fallback (BL liefert keine seller_country_code pro Stock-Entry).
- **Completeness-Filter:** siehe `getStatsForLot()` in `src/lib/lot-pricing.ts` — matcht exakt + NULL als Fallback (für Alt-Sales und Minifig-SETs wo BL keinen Split macht).

### 5. Neue Dashboard-Karte

**Schritte:**

1. Response von `GET /api/dashboard/stats` (in `src/app/api/dashboard/stats/route.ts`) um neuen Wert erweitern.
2. `Stats`-Interface in `src/app/(dashboard)/page.tsx` synchron erweitern (optional `?` bei neuen Feldern für Backward-Compat).
3. Neue Karten-Component ins Dashboard einfügen (Muster: die bestehenden Karten kopieren, Tailwind-Klassen identisch halten).

---

## Testing

Aktuell **keine formalen Tests** — das ist ein Ein-Personen-Hobby-Projekt und der Testaufwand steht in keinem Verhältnis. Statt Unit-Tests:

- **`npm run check`** (= typecheck + lint + build) MUSS grün sein vor jedem PR.
- **Manuelle Smoke-Tests** auf der lokalen Prod-Instanz oder Test-VM. Bei Backend-Änderungen die Detail-Seite eines Parts durchklicken.
- **Fresh-Install-Test auf Test-VM** bei Änderungen an `install.sh` oder Migrations.

Wenn du Tests hinzufügen willst — gerne, aber als separate PR, nicht in feature-PRs mit reinmischen.

---

## Wichtige Design-Entscheidungen (Lesbarkeit)

Aus [`CLAUDE.md`](../CLAUDE.md) die wichtigsten für Contributors:

- **Kein Queue-System** — Crawler picked dynamisch aus `user_watchlists` basierend auf Staleness. Die `crawl_queue`-Tabelle existiert im Schema, wird aber nicht mehr aktiv genutzt.
- **Fetch-once, filter-many** — BL-API-Calls sind teuer, wir crawlen weltweit (ohne country_code) und filtern per SQL. Ausnahme: Stock, weil BL dort keine Country-Codes pro Entry liefert — da crawlen wir pro `sellerCountries[i]` separat mit `country_code=X`.
- **Deduplication per NULLS NOT DISTINCT** — Unique-Indizes auf `price_sales` und `price_stock` mit `completeness NULLS NOT DISTINCT` (Postgres 15+ Feature). Ohne das würden Non-SET-Zeilen (completeness=NULL) nicht dedupen.
- **Bootstrap-only Registration** — `/register` gated auf `userCount === 0`. Nach dem ersten User kein Selbst-Registrieren mehr (BL API TOS: keine Datenweitergabe zwischen fremden BL-Accounts).
- **Per-lot Watchlist** — `user_watchlists` per `blInventoryId` unique pro User. Ein Part kann mehrfach als getrennte Lots existieren (unterschiedliche Preise, Rabatte etc.).
- **AES-256-GCM Encryption** — BL-OAuth-Secrets + SMB-Passwörter in DB verschlüsselt (Env-Var `ENCRYPTION_KEY`, 64 hex chars).

---

## Git-Workflow

- **Branch aus `main`** — Feature-Branches heißen `feature/<name>` oder `fix/<name>`
- **Commit-Message:** deutsche Zusammenfassung ist ok, Convention: `<Bereich>: <Kurzbeschreibung>` in erster Zeile, dann Leerzeile, dann detaillierte Erklärung. Beispiele im `git log`.
- **PR gegen `main`** mit Beschreibung was + warum. Tests: "npm run check läuft grün" reicht als Bestätigung.
- **Kein Squash** — die Commit-Historie ist Doku, Feature-Commits mit Zwischenschritten sind ok.

---

## Wo Fragen stellen

Bevor du einen größeren Umbau anfängst:
- **Idee diskutieren:** [Discussions → Ideas](https://github.com/rainman19121979/bl-price-tracker/discussions/categories/ideas)
- **Architektur-Frage:** [Discussions → Q&A](https://github.com/rainman19121979/bl-price-tracker/discussions/categories/q-a)
- **Bug melden:** [Issues](https://github.com/rainman19121979/bl-price-tracker/issues)

Kleine Fixes (Typos, Doku-Ergänzungen, offensichtliche Bugs) einfach direkt als PR — kein Vorab-Talk nötig.
