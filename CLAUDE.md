# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BrickLink Price Tracker -- a web service that collects, historizes, and visualizes BrickLink LEGO price data. Multi-user capable, each user brings their own BrickLink API key. Price data is shared across users, watchlists are per-user.

## Tech Stack

- **Runtime:** Node.js 20+, TypeScript
- **Frontend:** Next.js 14 (App Router), Tailwind CSS + shadcn/ui, Recharts
- **Backend:** Next.js API Routes
- **Auth:** NextAuth.js (Auth.js v5), session-based with HTTPOnly cookies, Credentials provider
- **ORM:** Prisma with PostgreSQL 15+
- **State/Cache:** Redis (crawler state, pacing, registration toggle)
- **Validation:** Zod
- **Charts:** Recharts (sparklines, price history)
- **Workers:** Plain TypeScript loops via tsx (no BullMQ -- removed in favor of dynamic picking)

## Common Commands

```bash
npm install                    # Install dependencies
npm run dev                    # Dev server on port 3000
npm run build                  # Production build
npm start                      # Production server
npm run crawler                # Start crawler worker (sold/stock alternation loop)
npm run scheduler              # Start scheduler (cleanup + auto-sync + BSX-import)
npm run check                  # Run typecheck + lint + build
npx prisma migrate dev         # Run migrations (dev)
npx prisma migrate deploy      # Run migrations (prod)
npx prisma generate            # Regenerate Prisma client
npx prisma studio              # DB browser GUI
```

**Important:** After `npm run build`, restart `npm run dev` -- otherwise CSS may be missing.

## Architecture

### Data Flow
BrickLink API (OAuth 1.0, worldwide -- no `country_code`) -> Crawler loop (dynamic picking) -> PostgreSQL (upsert/dedup) -> Next.js API routes (per-user seller/buyer country filter) -> React frontend

### Key Design Decisions

- **No queue system:** Crawler picks dynamically from `user_watchlists` based on staleness (per-user `freshDays` setting, default 180 = 6 months, UI configurable in month steps). The `crawl_queue` table exists but is not actively used. Settings API blocks `freshDays` values that would require more calls than the user's `dailyLimit` (minus external estimate).
- **Sold + stock alternation:** Crawler alternates between `sold` (price history) and `stock` (current offers) via Redis `crawler:lastType`. If one side is all fresh, only the other is fetched.
- **Per-user crawler opt-in:** Each user has a `crawlerEnabled` boolean flag. No global toggle. Crawler only uses API keys from users with `crawlerEnabled=true`.
- **Per-lot inventory:** Watchlist entries are linked via `bl_inventory_id` (BrickLink lot ID), not just part+color+condition. This means the same part can appear multiple times if listed as separate lots. Unique constraint: `(userId, blInventoryId)`.
- **Median pricing:** Market prices shown as median (robust against outliers) alongside weighted average (`qty_avg`). Trend arrows compare 30-day median vs 60-day median.
- **Country filter (fetch-once, filter-many):** BL API is called **without** `country_code` -- data for all seller countries is stored in `price_sales` (`seller_country`, `buyer_country`) and `price_stock` (`seller_country`). Each user configures two filters in `/settings`: `sellerCountries` (default DE) restricts both sold + stock; `shippingCountries` restricts sold by buyer country. Toggle in UI at any time without re-crawling. `getCountryFilters()` in [src/lib/user-settings.ts](src/lib/user-settings.ts) returns both. `price_daily` rollup is stored under the sentinel `sellerCountry='XX'` (global across sellers); per-country daily aggregates would require re-splitting `price_detail` by seller -- callers use `price_sales` directly for country-filtered aggregation.
- **Dynamic pacing:** Crawler has two modes: Full-speed (parts without data, `86400/dailyLimit` delay) and maintenance (all parts have data, `86400/(totalLots*2/freshDays)` delay). Switches automatically.
- **Per-condition timestamps:** `parts` has 4 crawl timestamps: `lastSoldCrawlN/U`, `lastStockCrawlN/U`. Prevents marking Used as "fresh" when only New was crawled.
- **VAT included:** BL API called with `vat=Y` parameter for gross prices matching the website.
- **Priority crawling:** Parts with `changedAt` set (after sync detects sales) are crawled first.
- **Rolling 24h rate limit:** BrickLink uses a rolling 24h window (not midnight reset). Each API call is logged in `api_call_log` table. Budget = `dailyLimit - COUNT(calls in last 24h)`. Old entries cleaned up after 48h by scheduler.
- **External callers:** Users can register external tools (e.g. BrickSync) sharing the same API key with their polling interval. Estimated daily calls shown in dashboard.
- **External REST API:** Bearer-Token-authenticated endpoints under `/api/external/*` for third-party tools (external inventory managers, BrickSync, N8N). Tokens managed via `external_tokens` table + `/settings` UI. Endpoints:
  - `GET /price` — single lookup
  - `POST /price/batch` — up to 100 items
  - `POST /watchlist/lots` — push lots (upsert into user_watchlists WITHOUT BL inventory fetch — recommended for external inventory-manager integration; supports `?skipPriceFetch=true`)
  - `DELETE /watchlist/lots` — remove lots (query `?blInventoryId=N` or body `{blInventoryIds:[...]}`)
  - `POST /inventory/sync` — full BL sync (legacy, only when no external pusher)
  - `POST /inventory/recompute` — recompute suggested-price cache only, no BL calls
  - `GET /sales` — paginated sales list (filters: `platform=BL|BO`, `since=YYYY-MM-DD`, `until=`, `limit`, `offset`)
  - **`POST /price/batch` mit optionalem `blInventoryId` pro Item:** wenn mitgeschickt, matched der Handler den zugehoerigen `user_watchlists`-Eintrag und liefert zusaetzlich `saleRate`, `priceLocked`, `myPrice` im Response. Wird von der BrickStore-Extension (`extensions/brickstore/bricklink-price-tracker.bs.qml`) genutzt: bei `priceLocked=true` schreibt sie `myPrice`, sonst `suggestedPrice`, plus `saleRate` als Rabatt.
  
  Every response (success or error) includes `apiUsage: {used, external, limit, remaining}` — the rolling 24h BL API budget snapshot. Middleware allows `/api/external/*` through token-auth only. Shared logic in `src/lib/external-price.ts` (`authenticateBearer`, `validateRequest`, `computeExternalPrice`, `getApiUsageFor`) and `src/lib/watchlist-lots.ts` (`upsertLot`, `deleteLots`, `validateLot`). Full docs in `API.md`.
- **Deduplication:** BL returns 6 months of sales on every crawl -- use `INSERT ... ON CONFLICT DO NOTHING` with the extended dedup indexes. `idx_sales_dedup` = `(part_id, date_ordered, unit_price, quantity, buyer_country, new_or_used, seller_country, completeness) NULLS NOT DISTINCT` (migration `20260815120000`). `idx_stock_dedup` analog auf price_stock. `NULLS NOT DISTINCT` verlangt PG 15+ und behandelt zwei NULL-completeness-Werte als "gleich" — ohne das würden Non-SET-Zeilen (completeness=NULL) nicht dedupen.
- **API key encryption:** AES-256-GCM for stored BrickLink OAuth secrets.
- **Bootstrap-only registration:** `/register` (Page + API) sind nur erreichbar solange `userCount === 0`. Der erste Aufruf legt den Admin-Account an, danach 404 -- Selbst-Registrierung ist per Design dauerhaft dicht (BL API TOS-Risiko: geteilte Preis-DB mit fremden BL-Accounts). Zusätzliche User anlegen: aktuell nur per DB (`psql`/Prisma-Studio). Der frühere Redis-Toggle `app:registration_open` und `src/lib/app-settings.ts` sind entfernt.
- **Preisdaten Export/Import (`/api/admin/prices/{export,import}`):** Admin-only NDJSON-Endpoint für Instanz-Umzug oder Merge zwischen eigenen Instanzen. Export enthält nur Parts + Sales + Stock + Daily -- keine User/Watchlist/Keys/my_sales. Import ist additiv (`ON CONFLICT DO NOTHING`), partId wird über `(partNo, colorId, itemType)` remapped, betroffene daily-Rollups werden nach dem Sales-Merge via `recomputePriceDaily()` neu berechnet. UI in `PricesExportImportSection`, unter Settings → Backup & Restore.
- **Pricing formulas:** Per-user configurable pricing rules with filters (item type, condition, color, category). Safe expression parser with 26+ variables (incl. `myCost`). See `src/lib/pricing-engine.ts`. Formulas round output to 3 decimals (BrickStore/BrickLink standard). `myCost` from BL is **lot total cost**, not per-unit -- formulas must divide by `myQty`.
- **Price lock:** Watchlist items can have `priceLocked=true` to skip formula evaluation (for B-grade goods, closeouts etc.). BSX export uses `myPrice` for locked items regardless of formula.
- **Minimal feature set (Public-Release).** Nur Preis-Tracking + Empfehlungen + Sales-View. Alle AI-Features, Part-Out-Analyse, Restock-Recommendation und Insights sind entfernt.
- **Lot pricing cache:** `suggestedPrice`, `marketStockMedian`, `marketSoldMedian`, `trend` are **persisted on `user_watchlists`** and recomputed by triggers (Crawler after sold/stock update, Inventory-Sync, Watchlist PUT, Settings update on formula change). Watchlist API reads cached values directly — no live aggregation. See `src/lib/lot-pricing.ts`. Backfill script: `scripts/backfill-lot-pricing.ts`.
- **Sales page (`/sales`):** shows imported BSX orders — KPI cards (30/90/180d + total), 12-month bars, top-10 parts by quantity, paginated + filterable list (platform, part-no/color search). Data source is exclusively BSX-import into `my_sales`. Customer field stays in DB but is not shown.
- **BSX-Export (`/api/watchlist/export-bsx`):** 1:1 round-trip mirror of the user's BL inventory with only the recommended price differing. Field mapping is critical: `<Remarks>` gets `user_watchlists.remarks` (private storage location like `TA039`), `<Comments>` gets `description` (public BL description). `<Cost>` = `myCost/myQuantity` (per-unit — DB stores lot total). `<LotID>` = `blInventoryId` — BrickStore matches by this on re-upload and preserves everything else. `<DateAdded>` from `bl_date_added` (BL `date_created`). Only lots with `bl_inventory_id` are exported (safety — no round-trip anchor otherwise). Locked-price lots (`priceLocked=true`) use `myPrice` regardless of formula.
- **External API:** `/api/external/price?partNo=…&colorId=…&itemType=…&condition=…` with Bearer token (table `external_tokens`). Returns suggested price + market medians, creates parts on-demand if not in DB, deletes them on BL 404. Middleware allows `/api/external` through token-auth-only. See `src/app/api/external/price/route.ts`.
- **HTML entities:** BL API returns names with `&#40;` etc. — always decode via `decodeHtmlEntities()` from `src/lib/html-entities.ts` before storing.
- **SQL performance:** When aggregating `price_stock` for "latest snapshot", use `WITH latest AS (SELECT DISTINCT ON ...)` + JOIN, **never** correlated subquery `fetched_at = (SELECT MAX(...) FROM price_stock ps2 WHERE ...)` — that pattern caused 4-43s queries when scanning multiple parts.

### Key Helpers

- **`src/lib/find-part.ts`** -- `findPart(partNo, colorId)`: Looks up a part trying item types in order PART -> MINIFIG -> SET. Used by `/api/prices/[partNo]/[colorId]/*` routes.
- **`src/lib/session-helpers.ts`** -- `getUserId(session)`: safely extract numeric user id from a NextAuth session. Prefer over `parseInt(session.user.id)` in new code (validates shape, returns null on invalid).
- **`src/lib/formatters.ts`** -- Shared formatting utilities: `timeAgo`, `dataAgeColor`, `fmt`, `formatEur`, `formatDate`, `formatDiffPercent`. Always import from here instead of duplicating formatting logic.
- **`src/lib/user-settings.ts`** -- Per-user shipping country filter.
- **`src/lib/price-daily-rollup.ts`** -- `recomputePriceDaily(keys)`: rechnet Aggregat-Zeilen in `price_daily` fuer betroffene `(partId,date,newOrUsed)`-Kombinationen neu aus `price_sales`. Nur Non-SET-Parts (SETs bleiben ausserhalb des daily-Caches, wie im Crawler). Genutzt vom Preisdaten-Import.
- **`src/lib/semver-compare.ts`** -- `isVersionNewer(latest, current)`: minimaler Semver-Vergleich fuer die Update-Anzeige. Kein npm-`semver`-Package, ~30 Zeilen.
- **`/api/version` (public) + `/api/version/check` (admin-only)** -- Version-Endpoints fuer die Update-Anzeige. `check` cached 6h in Redis, ruft GitHub Releases API, timeout 5s, fail-open (UI zeigt nur aktuelle Version wenn GitHub down). Sidebar-Component `src/components/layout/sidebar.tsx` fetcht beim Mount + jede Stunde, zeigt Update-Badge wenn `hasUpdate=true`, oeffnet `UpdateModal` mit Copy-Command.
- **`src/lib/encryption.ts`** -- AES-256-GCM encrypt/decrypt for API key secrets.
- **`src/lib/bricklink-api.ts`** -- BrickLink OAuth 1.0 client with getPriceGuide and getInventory.
- **`src/lib/api-usage.ts`** -- Rolling 24h API call tracking: getUsage, logApiCall, cleanupOldLogs, getExternalCallCount (estimates external calls from per-key `externalCalls` JSON).
- **`src/lib/pricing-engine.ts`** -- Safe expression parser for pricing formulas: evaluateFormula, findMatchingRule, validateFormula.
- **`src/lib/lot-pricing.ts`** -- Pricing-cache compute: `recomputeLotPricing(watchlistId)`, `recomputeAllLotsForPart(partId, condition)`, `recomputeAllLotsForUser(userId)`. Last variant uses UNNEST batch-update for ~9k lots in ~12s.
- **`src/lib/fetch-prices.ts`** -- `fetchPriceData(part, condition, apiKeyId)`: BL sold + stock fetch + DB save + per-condition timestamp update. Reused by `/api/external/price`, `/api/inventory/sync-and-fetch`, `/api/external/watchlist/lots`.
- **`src/lib/inventory-sync.ts`** -- `syncBricklinkInventory(userId)`: shared inventory sync logic. Calls `recomputeAllLotsForUser` at the end.
- **`src/lib/html-entities.ts`** -- `decodeHtmlEntities(str)`: decodes `&#nnn;`, `&amp;`, `&lt;`, etc. from BL responses.

### Database

- `users` -- accounts with `crawlerEnabled`, `autoSyncInventory`, `freshDays`, `pricingFormulas`, `shippingCountries` (buyer filter), `sellerCountries` (seller filter, default `DE`), `isAdmin`
- `user_api_keys` -- encrypted BrickLink OAuth credentials per user, daily limit, `externalCalls` (JSON)
- `api_call_log` -- rolling 24h API call tracking per key (id, apiKeyId, createdAt)
- `parts` -- master data with per-condition crawl timestamps (`lastSoldCrawlN/U`, `lastStockCrawlN/U`)
- `price_daily` -- daily aggregates per part/condition (min, max, avg, qty_avg)
- `price_sales` -- individual sales, **partitioned by month** on `date_ordered`, dedup via unique index
- `price_stock` -- current offers snapshot, replaced daily per part/condition
- `user_watchlists` -- per-user tracked parts with `bl_inventory_id`, `description` (public BL description), `remarks` (private BL storage location like `TA039`), `myPrice`, `myQuantity`, `saleRate`, `myCost` (**lot total**, not per-unit), `bulk` (BL bulk qty, default 1), `blDateAdded` (BL `date_created`), `prevQuantity`, `changedAt`, `priceLocked`, alert thresholds, **and the pricing cache: `suggestedPrice`, `suggestedRuleName`, `marketStockMedian`, `marketSoldMedian`, `trend`, `pricingComputedAt`**
- `my_sales` -- detected own sales (quantity decrease during sync), tracks price, quantity, timestamp
- `external_tokens` -- API tokens for external integrations (`/api/external/*`), managed via `/settings`
- `crawl_queue` -- legacy table (exists in schema but crawler picks dynamically instead)

### Crawler

Simple `while(true)` loop in `src/workers/crawler.ts`. No BullMQ, no queue table. Per-user `crawlerEnabled` flag controls which users' parts get crawled. Alternates sold/stock. Dynamic pacing: full-speed for new parts, maintenance mode when all have data. Per-user `freshDays` setting controls staleness threshold. Priority crawling for recently changed items (`changedAt`).

### Scheduler

Simple `while(true)` loop in `src/workers/scheduler.ts`, runs every 5 minutes:
- Cleanup of old `api_call_log` entries (>48h)
- Auto-sync BrickLink inventory for users with `autoSyncInventory=true` (detects sales via quantity changes → `my_sales`)
- Import new BSX order files from each user's configured `bsxOrdersDir` (read-only, 30-min interval)
- Market report check (hourly): weekly Sunday 06:00 or threshold-based trigger (`detectSignificantChange`)

### Admin Features

- Crawler page (`/crawler`) -- admin-only, shows recently crawled parts with condition badge
- Admin flag set directly in database (`isAdmin` on users table)

### Services (systemd)

All three processes run as systemd services with auto-restart:
```bash
systemctl restart pricetracker-web       # Dev server (port 3000)
systemctl restart pricetracker-crawler   # Crawler worker
systemctl restart pricetracker-scheduler # Scheduler + BSX-import
systemctl status pricetracker-web        # Check status
journalctl -u pricetracker-crawler -f    # Live log
```

### Port Layout (Local)

- Price Tracker (Next.js): 3000
- PostgreSQL: 5432 (database: `pricetracker`)
- Redis: 6379
- Prisma Studio: 5555 (optional, `npx prisma studio`)
- Picklist-App (existing): 5000
