# BrickLink Price Tracker

> **Privates Hobby-Projekt, per Vibe-Coding mit KI-Unterstützung entstanden.** Steht in keiner Verbindung zur **LEGO Group**, **BrickLink Limited**, **BrickOwl LLC** oder **BrickSync**. LEGO®, BrickLink® und BrickOwl® sind eingetragene Marken der jeweiligen Rechteinhaber, die dieses Projekt weder unterstützen noch autorisieren. Nutzung auf eigene Verantwortung — siehe [NOTICE.md](./NOTICE.md).

Ein selbstgehostetes Web-Tool, das deinem BrickLink-Store hilft, **faire und wettbewerbsfähige Preise** zu setzen. Es holt sich täglich echte Marktdaten von BrickLink (was aktuell angeboten wird und was tatsächlich verkauft wurde) und rechnet dir daraus Preisempfehlungen für jedes Teil in deinem Lager aus — nach Regeln, die du selbst festlegst.

Gebaut für kleine bis mittlere LEGO-Händler, die **datenbasiert** verkaufen wollen, ohne stundenlang manuell Preise zu recherchieren.

**Nichts wird zurück an BrickLink oder BrickOwl geschrieben.** Das Tool liest nur — Änderungen exportierst du als BSX, prüfst sie in BrickStore und lädst sie manuell hoch. So kann nichts kaputt gehen.

![Watchlist mit Empfehlungspreisen](docs/screenshots/01-watchlist.png)

---

## Was das Tool für dich macht

- **Preise beobachten:** Holt für jedes Teil in deinem Lager, was Konkurrenten aktuell dafür verlangen und zu welchen Preisen es tatsächlich verkauft wurde (6 Monate Historie)
- **Empfehlungspreise ausrechnen:** Wendet deine eigenen Formeln an (z.B. "5% unter dem Marktmedian" oder "10% Aufschlag auf den 90-Tage-Verkaufsdurchschnitt")
- **Länder filtern:** Auf Wunsch nur Verkäufer/Käufer aus bestimmten Ländern berücksichtigen (z.B. nur DE-Verkäufer für den deutschen Markt)
- **Deine Verkäufe tracken:** Import aus BrickSync-Order-Dateien mit KPI-Karten, 12-Monats-Chart und Top-10-Teilen
- **Als BSX exportieren:** 1:1-Kopie deines Bestands mit den neuen Empfehlungspreisen — direkt in BrickStore importierbar
- **REST-API:** Bearer-Token-Endpoints für externe Tools (Inventar-Manager, Automatisierungen). Details in [API.md](./API.md)

## Für wen es sich lohnt

Wenn du…
- einen BrickLink-Store mit vielen Teilen hast und Preise nicht mehr manuell pflegen willst
- eine eigene Preisstrategie hast, die du konsistent auf alle Lots anwenden möchtest
- wissen willst, welche Teile gerade heiß laufen und welche liegenbleiben
- BrickStore für Uploads nutzt

…dann ist das dein Tool. Wenn du 20 Teile im Store hast, ist der Aufwand für Setup zu hoch — mach das dann lieber händisch.

---

## Was du vorbereiten musst

Bevor du loslegst:

1. **Einen Server** — dein eigener Linux-PC, ein Mini-PC daheim, oder ein günstiger VPS. Braucht: 2 GB RAM, 20 GB Platte, Docker installiert
2. **Einen BrickLink-Account** mit aktivierten API-Credentials — [Anleitung bei BrickLink](https://www.bricklink.com/v3/api.page). Du brauchst am Ende 4 Werte: Consumer Key, Consumer Secret, Access Token, Access Token Secret
3. **~15 Minuten** für Setup + erste Konfiguration

---

## Installation

### One-Command-Install (empfohlen)

Auf einem frischen Ubuntu- oder Debian-Server (z.B. bei Netcup, Hetzner, Contabo):

```bash
curl -fsSL https://raw.githubusercontent.com/rainman19121979/bl-price-tracker/main/scripts/install.sh | sudo bash
```

Der Installer macht alles automatisch:
- Prüft OS, RAM, Platte, Port-Konflikte (bricht ab bei Problemen — nichts wird "einfach so überschrieben")
- Installiert Docker falls fehlt
- Klont das Repo nach `/opt/bl-price-tracker`
- Erzeugt die drei Sicherheits-Secrets zufällig (kein Copy-Paste nötig)
- Erkennt eine bestehende **BrickSync-Installation** und bietet an, den Orders-Ordner einzubinden
- Fragt einmal nach dem Zugriffsmodus (Localhost via Tailscale, oder öffentlich via Caddy+HTTPS)
- Startet den kompletten Stack + wartet bis die App antwortet

**Was der Installer NICHT anfasst:** SSH-Config, Firewall (UFW), bestehende Web-Server, BrickSync-Dateien. Bei jedem Konflikt wird abgebrochen, damit du selbst entscheidest.

**Vorsichtig? Installer erst inspizieren, dann laufen lassen:**

```bash
curl -fsSL https://raw.githubusercontent.com/rainman19121979/bl-price-tracker/main/scripts/install.sh -o install.sh
less install.sh        # anschauen — ist kommentiertes Bash
sudo bash install.sh   # ausführen
```

> **Ein Merkzettel für später:** Nach der Installation sichere dir den `ENCRYPTION_KEY` aus `/opt/bl-price-tracker/.env` in einem Passwortmanager. Damit werden deine BrickLink-Zugangsdaten verschlüsselt — verlierst du ihn, musst du sie neu eintragen.

### Wie komme ich auf meine App? (nach der Installation)

Der Installer empfiehlt und richtet standardmäßig den **Localhost-Modus** ein — die App ist von außen unsichtbar. Für den Zugriff nutzt du **Tailscale** (kostenlos, 5-Min-Setup, sicherer als eigenes HTTPS):

**Auf dem VPS** (nach der Installation):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# → Link im Browser öffnen, mit Google/GitHub/Microsoft-Account einloggen
```

**Auf deinem Laptop + Handy:**
1. [tailscale.com/download](https://tailscale.com/download) → App installieren
2. Mit demselben Konto einloggen
3. VPS-Tailscale-IP anzeigen: auf dem VPS `tailscale ip -4` (z.B. `100.64.1.5`)
4. Im Browser (egal wo du bist): `http://100.64.1.5:3000`

Fertig. Kein Zertifikat, keine Domain, keine Portfreigabe. Server bleibt für Fremde unsichtbar (nur SSH auf Port 22).

**Alternative ohne Tailscale — SSH-Tunnel** (nur vom eigenen Rechner):
```bash
ssh -L 3000:localhost:3000 root@dein-vps
# Dann im Browser: http://localhost:3000
```

**Alternative mit eigener Domain** — beim Installer statt Modus 1 einfach Modus 2 wählen. Er richtet dann Caddy mit ein und macht HTTPS via Let's-Encrypt automatisch. Braucht: Domain, DNS-A-Record auf VPS-IP, Ports 80/443 offen.

### Manuelle Installation (ohne install.sh)

<details>
<summary>Ausklappen — falls du das Skript nicht laufen lassen willst</summary>

```bash
git clone https://github.com/rainman19121979/bl-price-tracker.git
cd bl-price-tracker
./scripts/init-env.sh && docker compose up -d --build
```

Was passiert:
1. Repo wird heruntergeladen
2. `init-env.sh` erzeugt die `.env` und würfelt die drei Sicherheits-Secrets
3. Docker baut das Image, startet Datenbank + App

Für HTTPS via Caddy: nach dem `init-env.sh` in `.env` `DOMAIN=...` und `EMAIL=...` ergänzen, dann statt `docker compose up`:
```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

</details>

Beim ersten Start baut sich das Image, richtet Datenbank + Redis ein und startet alle Services. Dauert 2–3 Minuten. Danach ist die Weboberfläche unter **http://localhost:3000** erreichbar.

### Erster Login

Beim ersten Aufruf leitet die Login-Seite auf `/register` — leg dir einen Account an. Der **erste Account wird automatisch Admin** und kann später weitere User freigeben.

---

## Erste Schritte nach der Installation

In dieser Reihenfolge:

**1. BrickLink API-Key eintragen** (Einstellungen → BrickLink API Keys → hinzufügen)

Du brauchst alle 4 OAuth-Werte. Speichere. Danach "Testen" klicken — muss grün werden.

Wenn du BrickSync parallel nutzt, ist es unter "Externe Aufrufe" schon vorbelegt (5-Minuten-Poll = ~288 Calls/Tag). Anpassen wenn nötig.

**2. Länder-Filter setzen** (Einstellungen → Verkäuferländer + Versandländer)

Beispiel: du bist deutscher Händler und verkaufst nur nach DE, AT, CH.
- **Verkäuferländer:** DE (nur DE-Verkäufer werden für Marktpreis-Berechnung angeschaut — deine echte Konkurrenz)
- **Versandländer:** DE, AT, CH (nur Verkäufe an Käufer in diesen Ländern zählen)

Kannst du jederzeit umstellen ohne neu zu crawlen — die Daten werden immer weltweit geholt und nur bei der Anzeige gefiltert.

**3. Preisformel definieren** (Einstellungen → Preisformeln → Regel)

Ein einfacher Einstieg:
- Name: "Standard"
- Alle Typen, Alle Zustände (Fallback für alles)
- Formel: `max(sold90dMedian, stockMedian) * 0.98`

Bedeutet: nimm das Höhere von 90-Tage-Verkaufsmedian und aktuellem Marktmedian, ziehe 2% ab. Damit unterbietest du den Markt leicht ohne unter Wert zu verkaufen.

Unter der Formel gibt's "Live-Vorschau" — die zeigt dir mit einem echten Teil aus deinem Lager, welchen Preis die Formel ausspucken würde vs. was du aktuell verlangst.

![Preisformeln mit Live-Vorschau](docs/screenshots/03-settings-pricing.png)

**4. Datenaktualität einstellen** (Einstellungen → Datenaktualität)

Standard: 6 Monate. Bedeutet: Teile werden alle 6 Monate neu vom Markt abgefragt. Das Tool zeigt dir live an, wie viele API-Aufrufe pro Tag das braucht — kürzere Zeiträume brauchen mehr. Wenn's dein API-Limit überschreiten würde, blockt es.

**5. Auto-Sync einschalten** (Einstellungen → Auto-Sync)

Holt einmal täglich dein BrickLink-Inventar. Neue Lots werden ergänzt, verschwundene entfernt, Mengenänderungen werden als Verkäufe erkannt.

Das war's — der Crawler läuft ab jetzt im Hintergrund. Preise landen nach und nach in `/watchlist`.

![Detail-Ansicht eines Teils mit Preisverlauf](docs/screenshots/02-parts-detail.png)

### Was dich beim ersten Mal erwartet: **Geduld**

Wenn du deinen Store das erste Mal verbindest, ist die Watchlist erst mal **leer bei den Preisdaten**. Der Crawler muss für jedes Lot zweimal die BL-API anrufen (einmal für Sold-Historie, einmal für aktuelle Angebote).

Wie viele Aufrufe pro Tag möglich sind, gibt **dein BrickLink-API-Kontingent** vor. BrickLink limitiert **5.000 Aufrufe pro Tag pro BL-Account** (Stand 2026, kann sich ändern). Wichtig: **es zählt pro Account, nicht pro API-Consumer-Key** — mehrere Keys anzulegen bringt nichts, die teilen sich alle dieselben 5.000.

Realistische Beispiele — Dauer bis alle Lots einmal gecrawlt sind:

| Store-Größe | API-Aufrufe nötig | Bei 5.000/Tag |
|---|---|---|
| 500 Lots | 1.000 | wenige Stunden |
| 2.000 Lots | 4.000 | ~1 Tag |
| 5.000 Lots | 10.000 | ~2 Tage |
| 10.000 Lots | 20.000 | ~4 Tage |
| 20.000 Lots | 40.000 | ~8 Tage |

> **Standard-Einstellung in dieser App:** 1.000/Tag als Sicherheitspuffer, damit andere Tools nicht plötzlich kein Kontingent mehr haben. Nach der Installation musst du das entsprechend hochsetzen (siehe unten).

**⚠ WICHTIG: Andere Tools zählen mit in dieselbe API-Quote!**

Alle Tools die deinen BL-Account benutzen (**BrickSync**, externe Inventar-Manager, N8N-Automationen usw.) fressen aus demselben 5.000er-Topf — egal ob sie eigene Consumer-Keys haben oder nicht. Realistischer Alltag:

- BrickSync mit 5-Min-Poll: ~288 Aufrufe/Tag
- Dein externer Inventar-Manager: je nach Konfiguration
- N8N-/Automation-Flows: variabel

Das musst du bei **Einstellungen → API Keys → Tageslimit** berücksichtigen:
- Trage nur das **Kontingent ein, das du für den Crawler übrig lässt** — nicht die vollen 5.000
- Beispiel: BrickSync verbraucht 300/Tag, andere Tools 200/Tag → trage 4.500 als Limit für den Tracker ein
- Zur Sicherheit lieber etwas Puffer lassen (z.B. 4.000 statt 4.500) — falls mal ein externes Tool mehr braucht als erwartet, kollidiert nichts

Im Dashboard siehst du live: Crawler-Verbrauch + geschätzter Extern-Verbrauch + Rest. Der Crawler paced sich automatisch runter wenn er das eingestellte Limit erreicht — es passiert also nichts Schlimmes, aber wenn du zu wenig einträgst wird der Erst-Crawl länger.

**Was du in dieser Anlaufphase sehen wirst:**
- Watchlist: Teile werden nach und nach farbig (grün = frische Preise, grau = noch nicht gecrawlt)
- Preisempfehlungen erscheinen sobald das jeweilige Lot vollständig gecrawlt ist
- Der Crawler priorisiert intelligent: neue Teile zuerst, dann die ältesten Preisdaten
- Sobald einmal alles da ist, hält der Crawler im "Wartungs-Modus" alle Preise alle 6 Monate frisch — das ist entspannt, verbraucht kaum was

---

## Preisempfehlungen in deinen Store übertragen

**Nichts passiert automatisch** — du behältst immer die Kontrolle:

1. Öffne `/watchlist` → oben rechts **"BSX-Export"** herunterladen
2. Öffne diese Datei in BrickStore (Datei → Öffnen)
3. Prüfe die neuen Preise, ändere manuell falls nötig
4. In BrickStore: **BrickLink → Store → Upload** — BrickStore schreibt die Änderungen zurück an deinen Shop

Die BSX-Datei enthält dein Inventar **exakt so wie es aktuell in deinem Store ist** (Lagerplatz, öffentlicher Kommentar, Einkaufspreis, Lot-ID, alles) — nur mit dem neuen Empfehlungspreis. BrickStore matcht per Lot-ID und ändert nichts anderes als den Preis.

> **Sicherheitsnetz:** Nur Lots mit BrickLink-Inventory-ID (also welche die per Sync kamen) werden exportiert. Manuell hinzugefügte Lots ohne ID bleiben draußen, weil sie beim Upload Chaos anrichten könnten.

---

## BSX-Order-Import (Verkäufe tracken)

Für die `/sales`-Seite (KPI-Karten, 12-Monats-Chart) importiert das Tool BSX-Order-Dateien, die BrickSync automatisch anlegt.

**Einrichten:**

1. In der UI: Einstellungen → BSX-Ordner → Pfad eintragen (Admin-only)
2. Der Scheduler scannt diesen Ordner alle 30 Minuten und liest neue Dateien
3. **Nichts wird verändert oder gelöscht** — reiner Lesezugriff

**Netzwerkfreigabe (SMB/NAS) — komplett im Frontend:**

Wenn deine BrickSync-Orders auf einem NAS liegen: **keine Docker-Config, keine Host-Vorbereitung, kein `cifs-utils`**. Die App spricht SMB direkt über eine Node.js-Library.

In der UI (Einstellungen → BSX-Import) auf **"Netzwerkfreigabe (SMB)"** klicken und ausfüllen:

- **Host:** `nas.local` oder `192.168.1.20`
- **Share:** `lego` (der Freigabename)
- **Unterordner:** `bricksync/orders` (optional)
- **Benutzer + Passwort:** SMB-Zugangsdaten

Passwort wird AES-256 verschlüsselt in der Datenbank abgelegt (gleicher Mechanismus wie deine BrickLink-Keys). "Verbindung testen" zeigt sofort ob es klappt.

**Lokaler Ordner (Docker):** Der Container sieht nur was du bind-mountest. Setze in `.env`:

```bash
BSX_HOST_PATH=/home/holger/bricksync/orders
```

Nach `docker compose up -d --build` erscheint der Ordner als `/bsx-orders` im Container — genau das trägst du in der UI unter "Lokaler Ordner" ein.

**Bare Metal:** einfach den lokalen Pfad in der UI eintragen. Für Netzwerkfreigaben entweder auf dem Host mounten (`mount -t cifs …`) und Mount-Pfad eintragen, oder direkt SMB in der UI benutzen.

![BSX-Import mit SMB-Formular](docs/screenshots/05-settings-bsx-smb.png)
![Deine Verkäufe: KPI und 12-Monats-Chart](docs/screenshots/06-sales.png)

---

## Sicher auf einem VPS betreiben

Wenn du die App auf einem VPS (Netcup, Hetzner, Contabo, …) statt daheim betreibst, ist sie ohne extra Härtung öffentlich erreichbar. Diese Checkliste macht das Setup produktionsreif:

**1. Reverse Proxy mit HTTPS statt Port 3000 direkt.** Caddy ist am einfachsten — hier ein `Caddyfile` (nur diese eine Datei, sonst nix nötig):

```
tracker.deine-domain.de {
    reverse_proxy localhost:3000
}
```

Caddy holt automatisch ein Let's-Encrypt-Zertifikat, terminiert HTTPS und leitet an die App weiter. Alternative: nginx + certbot (aufwändiger).

**2. Firewall — nur 22/80/443 offen.** Auf einem Ubuntu-VPS:

```bash
ufw default deny incoming
ufw allow 22/tcp        # SSH
ufw allow 80/tcp        # HTTP (Caddy für Let's-Encrypt-Redirect)
ufw allow 443/tcp       # HTTPS
ufw enable
```

**Port 3000 NICHT direkt aufmachen** — der ist nur intern für Caddy. Postgres (5432) und Redis (6379) sowieso nicht.

**3. In `.env` die Public-URL setzen:**

```bash
NEXTAUTH_URL=https://tracker.deine-domain.de
```

Sonst funktionieren Login-Cookies nicht. Nach Änderung: `docker compose up -d`.

**4. Registrierung schließen sobald deine User da sind.** Standardmäßig ist `/register` offen und jeder mit deiner URL kann sich anmelden. Als Admin schließen: unter `/settings` → Registrierung ausschalten (nutzt Redis-Flag, kein Neustart nötig).

**5. SSH-Härtung.** Passwort-Login raus, nur Key-basiert:

```bash
# In /etc/ssh/sshd_config:
PasswordAuthentication no
PermitRootLogin prohibit-password
# dann: systemctl restart ssh
```

**6. Auto-Updates.** Unattended-Upgrades für's OS:

```bash
apt install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

Für die App selbst: `git pull && docker compose up -d --build` — kein Auto-Update, du entscheidest wann.

**Was die App selbst schon macht (musst du nicht extra tun):**
- Passwörter mit bcrypt (cost 12) gehasht
- BrickLink-API-Keys AES-256-GCM verschlüsselt
- SMB-Passwörter (falls konfiguriert) AES-256-GCM verschlüsselt
- Session-Cookies HTTPOnly + SameSite
- Rate-Limits auf Login + Registrierung + Key-Tests (Redis-backed)
- Content-Security-Policy Header
- Middleware blockt alle nicht-öffentlichen Routen ohne Session

**Was ich NICHT empfehle:**
- Öffentliche Registrierung dauerhaft offen lassen
- Ohne HTTPS betreiben (Passwörter im Klartext übers Netz)
- Port 3000 direkt exponieren
- Ohne Backups laufen lassen (`docker exec pricetracker-db-1 pg_dump ...` in Cronjob)

Wenn du das umsetzt, ist der VPS-Betrieb genauso sicher wie andere selbstgehostete Web-Anwendungen — nicht bank-grade, aber solide für ein Ein-Personen-Tool oder eine kleine Nutzergruppe.

---

## Wartung

```bash
docker compose logs -f web        # Logs live mitlesen
docker compose logs -f crawler    # Crawler-Aktivität
docker compose ps                 # Status aller Services
docker compose down               # Alles stoppen
docker compose up -d --build      # Nach Update neu bauen + starten
```

Daten (Postgres, Redis) liegen in Docker-Volumes und überleben `down` und `up`.

**Update ziehen:**

```bash
git pull
docker compose up -d --build
```

Migrations werden beim Start automatisch angewendet.

---

## Ohne Docker (Bare Metal)

<details>
<summary>Für Fortgeschrittene — ausklappen</summary>

Voraussetzungen: Node.js 20+, PostgreSQL 15+, Redis 7+.

```bash
git clone https://github.com/rainman19121979/bl-price-tracker.git
cd bl-price-tracker
npm install

# DB anlegen
sudo -u postgres createuser -P pricetracker
sudo -u postgres createdb -O pricetracker pricetracker

# .env: aus .env.example kopieren, DATABASE_URL + REDIS_URL setzen, Secrets generieren
cp .env.example .env
# Am Ende der Datei die "Bare-metal only"-Zeilen aktivieren

npx prisma migrate deploy
npm run build

# Drei Prozesse — je in eigenem Terminal oder als systemd-Services (siehe unten):
npm start                    # Web (Port 3000)
npm run crawler              # Crawler
npm run scheduler            # Scheduler
```

**systemd-Services (Produktion):**

Beispiel `/etc/systemd/system/pricetracker-web.service`:

```ini
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

Nach jedem `npm run build` den Web-Service neu starten (`systemctl restart pricetracker-web`), sonst fehlt CSS.

</details>

---

## Externe REST-API

Bearer-Token-authentifiziert unter `/api/external/*`. Tokens verwaltest du unter Einstellungen → API-Tokens.

Wichtigste Endpoints:

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/external/price` | Einzel-Preisabfrage |
| POST | `/api/external/price/batch` | Bis 100 Preise auf einmal |
| POST | `/api/external/watchlist/lots` | Lots pushen (für externe Inventar-Manager) |
| DELETE | `/api/external/watchlist/lots` | Lots entfernen |
| GET | `/api/external/sales` | Deine Verkäufe abrufen (paginiert, filterbar) |

Jede Response enthält `apiUsage: {used, external, limit, remaining}` — dein aktuelles BrickLink-API-Budget.

**Volle Dokumentation mit Beispielen:** [API.md](./API.md)

---

## Ports

| Dienst | Port | Zweck |
|---|---|---|
| Web-UI | 3000 | Der Browser-Zugang |
| PostgreSQL | 5432 | Datenbank (nur bei Bare-Metal von außen sichtbar) |
| Redis | 6379 | Cache (nur intern) |

---

## Tech Stack (für Interessierte)

Next.js 14 (App Router) · TypeScript · PostgreSQL 15 + Prisma · Redis · Tailwind + shadcn/ui · Recharts · NextAuth v5. Details zur Architektur in [CLAUDE.md](./CLAUDE.md).

## Beitragen

Issues und Pull Requests willkommen. Für größere Änderungen bitte vorher ein Issue eröffnen.

## Lizenz

**AGPL v3** — siehe [LICENSE](./LICENSE) für den vollen Text.

Kurz zusammengefasst:
- Du darfst den Code **frei nutzen, ändern, weitergeben** — auch für kommerzielle Zwecke
- Wenn du eine veränderte Version **als Web-Service anbietest** (auch für Kunden gegen Geld), musst du deine Änderungen **auch als AGPL open-source zurückgeben**
- Damit wird verhindert, dass jemand das Projekt forkt, hinter verschlossenen Türen erweitert und als proprietäres SaaS-Produkt verkauft — die Community bekommt Verbesserungen zurück

Für Contributions, Bug-Fixes und PRs gilt: mit dem Einreichen stimmst du zu, dass dein Beitrag unter AGPL v3 gestellt wird.
