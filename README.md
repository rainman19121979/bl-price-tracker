# BrickLink Price Tracker

Self-hosted Web-Service für **BrickLink-Preisdaten** — sammelt aktuelle Angebote und historische Verkäufe, gleicht dein Store-Inventar mit dem deutschen Markt ab und generiert Empfehlungspreise nach frei konfigurierbaren Formeln.

Gebaut für kleine LEGO-Händler, die ihre Preise datenbasiert am Markt orientieren wollen und ihren eigenen Store betreiben.

## Was du damit machen kannst

- **BL-Inventar synchronisieren** — komplett von BrickLink, jedes Lot einzeln (per `bl_inventory_id`), Neu/Gebraucht getrennt
- **Preisempfehlungen** aus eigenen Formeln (26+ Variablen: Stock/Sold Median/Avg über 7/30/60/90/180d, eigene Kosten, Menge, …)
- **Historische Verkäufe** (6 Monate) + aktuelle Angebote — Median, mengengewichteter Durchschnitt, Trend-Pfeile (30d vs 60d)
- **Meine Verkäufe** (`/sales`) — KPI-Kacheln (30/90/180d/gesamt), 12-Monats-Balken, Top-10 verkaufte Teile, filterbare Liste
- **BSX-Import (optional)** — Order-Dateien aus BrickSync-Ordner werden alle 30 Min gelesen (read-only, Test-/Import-Buttons unter Settings)
- **Externe REST-API** — Bearer-Token für externe Tools (Inventar-Management, N8N o.ä.) unter `/api/external/*` (siehe `API.md`)

## Tech Stack

Next.js 14 (App Router) · TypeScript · PostgreSQL 15 + Prisma · Redis · Tailwind + shadcn/ui · Recharts · NextAuth v5

---

## Setup

### Voraussetzungen

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Ein BrickLink-Store mit API-Zugang (Consumer Key/Secret + Access Token/Secret — Anleitung: [bricklink.com/v3/api.page](https://www.bricklink.com/v3/api.page))

### 1. Klonen & Dependencies

```bash
git clone https://github.com/rainman19121979/bl-price-tracker.git
cd bl-price-tracker
npm install
```

### 2. Datenbank + Redis

```bash
# Postgres-DB anlegen
sudo -u postgres createuser -P pricetracker    # Passwort setzen
sudo -u postgres createdb -O pricetracker pricetracker

# Redis läuft standardmäßig auf localhost:6379 — nichts weiter zu tun
```

### 3. .env

```bash
cp .env.example .env
```

Anpassen: `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_URL` (Produktions-URL), und Secrets generieren:

```bash
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

`ENCRYPTION_KEY` verschlüsselt deinen BrickLink-API-Key in der DB — **bewahre ihn auf**, sonst verlierst du den Zugriff auf gespeicherte Keys.

### 4. Migrationen

```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. Erststart

```bash
# Alle drei Prozesse
npm run build
npm start                    # Terminal 1: Web-Server (Port 3000)
npm run crawler              # Terminal 2: Crawler-Worker
npm run scheduler            # Terminal 3: Auto-Sync + BSX-Import
```

Öffne `http://localhost:3000` — die Login-Seite leitet dich beim ersten Aufruf automatisch nach `/register` (Setup-Modus). Lege dein Admin-Konto an, danach ist die Registrierung standardmäßig geschlossen.

### 6. Nach dem Login

1. **Einstellungen → API-Key** — BrickLink Consumer Key/Secret + Access Token/Secret eintragen, Tageslimit setzen
2. **Einstellungen → Pricing-Formeln** — mindestens eine Formel definieren (Beispiele in der UI)
3. **BL-Inventar → "Von BrickLink laden"** — dein komplettes Store-Inventar wird importiert
4. Crawler übernimmt ab dann automatisch die Preisdaten für alle Lots

---

## Systemd-Setup (Linux Produktion)

Beispiel-Service-Dateien unter `/etc/systemd/system/`:

```ini
# pricetracker-web.service
[Unit]
Description=BrickLink Price Tracker Web
After=network.target postgresql.service redis.service

[Service]
WorkingDirectory=/opt/bl-price-tracker
ExecStart=/usr/bin/npm start
Restart=always
User=pricetracker
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Analog `pricetracker-crawler.service` (`ExecStart=/usr/bin/npm run crawler`) und `pricetracker-scheduler.service` (`ExecStart=/usr/bin/npm run scheduler`).

```bash
sudo systemctl enable --now pricetracker-{web,crawler,scheduler}
```

**Wichtig:** Nach jedem `npm run build` den Web-Service neu starten (`systemctl restart pricetracker-web`), sonst fehlt CSS.

---

## Externe REST-API

Bearer-Token-authentifiziert unter `/api/external/*`. Tokens verwaltest du unter `/settings` → API-Tokens.

Endpoints (Auszug):

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/external/price` | Einzel-Preisabfrage |
| POST | `/api/external/price/batch` | Bis 100 Preise |
| POST | `/api/external/watchlist/lots` | Lots pushen (Upsert, ohne BL-Inventar-Fetch) |
| DELETE | `/api/external/watchlist/lots` | Lots entfernen |
| POST | `/api/external/inventory/sync` | Voller BL-Sync |
| POST | `/api/external/inventory/recompute` | Nur Empfehlungscache neu rechnen |
| GET | `/api/external/sales` | Verkäufe abrufen (paginiert, filter: platform/since/until) |

Jede Response enthält `apiUsage: {used, external, limit, remaining}` — dein aktuelles Rolling-24h-BL-API-Budget.

**Vollständige Doku:** [API.md](./API.md)

---

## Datenbank-Schema (Kurzübersicht)

- `users` — Konten + per-User Einstellungen (crawler on/off, pricing-formeln, shipping-countries, bsx-orders-dir)
- `user_api_keys` — BrickLink OAuth-Credentials (AES-256-GCM verschlüsselt), Tageslimit
- `parts` — Master-Daten aller getrackter Teile mit Per-Condition-Crawl-Timestamps
- `price_sales` — Einzel-Verkäufe (partitioniert nach Monat, Dedup via Unique-Index)
- `price_stock` — Aktueller Marktbestand-Snapshot pro Teil+Kondition
- `user_watchlists` — Deine Lots + gecachte Empfehlungspreise
- `my_sales` — Deine eigenen Verkäufe (aus BSX-Import)
- `external_tokens` — Bearer-Tokens für externe API
- `api_call_log` — Rolling 24h BL-Call-Tracking pro Key

Volles Schema in [`prisma/schema.prisma`](./prisma/schema.prisma).

---

## Architektur-Kurzabriss

- **Kein Queue-System.** Crawler-Worker pickt Teile dynamisch nach Staleness (per-User `freshDays`), alterniert `sold`/`stock`.
- **Dynamisches Pacing:** Voll-Speed für neue Teile, Wartungsmodus wenn alles frisch (`86400 / (lots × 2 / freshDays)` Sekunden Delay).
- **Rolling 24h Rate-Limit:** BrickLink zählt kein Mitternacht-Reset, jeder Call wird in `api_call_log` getrackt.
- **Lot-Pricing-Cache:** Empfehlungspreise liegen auf `user_watchlists` und werden bei Crawler-Update/Sync/Formel-Änderung neu berechnet — Inventar-Seite braucht keine Live-Aggregation.
- **BSX-Import (optional):** Scheduler scannt konfigurierten Ordner alle 30 Min, Dedup via Unique-Index. Read-only.

---

## Ports (Standard-Setup)

| Dienst | Port |
|---|---|
| Next.js Web | 3000 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| Prisma Studio (optional) | 5555 |

---

## Beitragen

Issues und Pull Requests willkommen. Für größere Änderungen bitte vorher ein Issue eröffnen.

## Lizenz

MIT — siehe [LICENSE](./LICENSE)
