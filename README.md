# BrickLink Price Tracker

> **Privates Hobby-Projekt, per Vibe-Coding mit KI-Unterstützung entstanden.** Steht in keiner Verbindung zur **LEGO Group**, **BrickLink Limited**, **BrickOwl LLC** oder **BrickSync**. LEGO®, BrickLink® und BrickOwl® sind eingetragene Marken der jeweiligen Rechteinhaber, die dieses Projekt weder unterstützen noch autorisieren. Nutzung auf eigene Verantwortung — siehe [NOTICE.md](./NOTICE.md).

Ein selbstgehostetes Web-Tool, das deinem BrickLink-Store hilft, **faire und wettbewerbsfähige Preise** zu setzen. Es holt sich täglich echte Marktdaten von BrickLink (was aktuell angeboten wird und was tatsächlich verkauft wurde) und rechnet dir daraus Preisempfehlungen für jedes Teil in deinem Lager aus — nach Regeln, die du selbst festlegst.

Gebaut für kleine bis mittlere LEGO-Händler, die **datenbasiert** verkaufen wollen, ohne stundenlang manuell Preise zu recherchieren.

**Nichts wird zurück an BrickLink oder BrickOwl geschrieben.** Das Tool liest nur — Änderungen exportierst du als BSX, prüfst sie in BrickStore und lädst sie manuell hoch. So kann nichts kaputt gehen.

![Watchlist mit Empfehlungspreisen](docs/01-watchlist.png)
![Dashboard mit API-Budget und Fortschritts-KPIs](docs/07-dashboard.png)

---

## Was das Tool für dich macht

- **Preise beobachten:** Holt für jedes Teil in deinem Lager, was Konkurrenten aktuell dafür verlangen und zu welchen Preisen es tatsächlich verkauft wurde (6 Monate Historie)
- **Empfehlungspreise ausrechnen:** Wendet deine eigenen Formeln an (z.B. "5% unter dem Marktmedian" oder "10% Aufschlag auf den 90-Tage-Verkaufsdurchschnitt")
- **Länder filtern:** Auf Wunsch nur Verkäufer/Käufer aus bestimmten Ländern berücksichtigen (z.B. nur DE-Verkäufer für den deutschen Markt)
- **Deine Verkäufe tracken (optional):** BSX-Order-Dateien aus BrickSync/BrickStore reinschieben — per Ordner-Scan, SMB-Share oder manuellem Upload — und du kriegst KPI-Karten, 12-Monats-Chart und Top-10-Teile. Wenn du die Sales-Übersicht nicht brauchst, kannst du diesen Teil komplett ignorieren
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

Auf einem frischen Ubuntu- oder Debian-Server (z.B. bei Netcup, Hetzner, Contabo) — funktioniert genauso auf einem **Raspberry Pi 4/5** mit Raspberry Pi OS (Debian-basiert):

```bash
apt update && apt install -y curl
curl -fsSL https://raw.githubusercontent.com/rainman19121979/bl-price-tracker/main/scripts/install.sh | sudo bash
```

Das Docker-Image ist für `linux/amd64` UND `linux/arm64` gebaut — Docker zieht automatisch das richtige für deine Hardware.

> Warum die erste Zeile? Minimal-Installationen von Ubuntu 24 bringen `curl` nicht mehr per Default mit. Der Installer selbst installiert danach `git`, `iproute2` etc. automatisch nach — nur `curl` musst du kurz vorher haben, damit du den Installer überhaupt herunterladen kannst.

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

### Auf einem Raspberry Pi (Home-Server)

Läuft gut auf einem Pi im lokalen Netz — kein VPS, kein Tailscale nötig. Empfehlungen:

**Hardware:**
- **Raspberry Pi 5 (4 oder 8 GB RAM)** — ideal, alles läuft flott
- **Raspberry Pi 4 mit mindestens 4 GB** — geht gut. Bei 2 GB wird's eng (Postgres + Redis + Next.js + zwei Worker)
- **Pi 3 oder älter**: zu langsam, alte 32-bit-CPU, nicht empfohlen
- **USB-SSD statt SD-Karte** stark empfohlen — Postgres macht viele Writes, SD-Karten sterben nach einigen Monaten. Selbst ein günstiger USB3-SSD-Stick ist 10× schneller und deutlich langlebiger

**Installation** wie oben (der Installer erkennt ARM64 automatisch, das Multi-Arch-Docker-Image wird richtig gepullt). Beim Modus-Prompt "Localhost" wählen — im LAN brauchst du weder Tailscale noch HTTPS.

**Feste IP im Router einrichten** — bei den meisten Consumer-Routern (Fritz!Box, Speedport, …): "Diesem Gerät immer dieselbe IP zuweisen". Dann bleibt die URL stabil.

**Zugriff aus dem LAN:**
- Über die feste Raspi-IP: `http://192.168.1.42:3000`
- Oder wenn dein Netzwerk mDNS unterstützt: `http://raspberrypi.local:3000`

**Sicherheit im LAN:**
- Router-Firewall blockt eh alles Externe (NAT)
- SSH-Zugang zum Pi: Key-Auth statt Passwort einrichten
- Wenn Gäste ins WLAN kommen: nach Ersteinrichtung die Registrierung schließen (Admin-Panel), damit Fremde keine Accounts anlegen können

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

Beim ersten Aufruf leitet die Login-Seite einmalig auf `/register` — leg dir dort dein **Admin-Konto** an. Danach ist die Selbst-Registrierung dauerhaft geschlossen (`/register` ist per Design nur erreichbar solange null User in der DB stehen). Die Instanz ist für den Betrieb durch **eine** Person / einen Haushalt / einen BrickLink-Store gedacht — mehrere fremde BL-Accounts an einer Instanz sind laut BrickLink API TOS nicht zulässig.

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

> **Wichtig für aktuelle Angebote:** BrickLink liefert bei den *aktuellen Angeboten* (Stock) keine Ländercodes pro Angebot — deshalb crawlt der Tracker Stock pro Verkäuferland separat mit einem Server-seitigen BL-Filter (`country_code=DE`). Nach einer Änderung deines Verkäuferlands rotiert der Crawler alle Teile nach und nach auf das neue Land um — bei 10.000 Lots und 1000 Calls/Tag Limit ca. **10-14 Tage**. In der Zwischenzeit zeigt die Detail-Seite ehrlich `(weltweit — DE-Crawl steht noch aus)` für Teile die noch nicht rotiert sind. Bei den *Verkäufen* (Sold) ist der Filter sofort wirksam, weil BL dort pro Verkauf einen Länder-Code mitliefert.

![Länderfilter für Verkäufer und Käufer](docs/04-settings-countries.png)

**3. Preisformel definieren** (Einstellungen → Preisformeln → Regel)

Ein einfacher Einstieg:
- Name: "Standard"
- Alle Typen, Alle Zustände (Fallback für alles)
- Formel: `max(sold90dMedian, stockMedian) * 0.98`

Bedeutet: nimm das Höhere von 90-Tage-Verkaufsmedian und aktuellem Marktmedian, ziehe 2% ab. Damit unterbietest du den Markt leicht ohne unter Wert zu verkaufen.

Unter der Formel gibt's "Live-Vorschau" — die zeigt dir mit einem echten Teil aus deinem Lager, welchen Preis die Formel ausspucken würde vs. was du aktuell verlangst.

![Preisformeln mit Live-Vorschau](docs/03-settings-pricing.png)

> **Formel-Cheatsheet + KI-Prompt-Template:** [docs/PRICING_FORMULAS.md](./docs/PRICING_FORMULAS.md) listet alle verfügbaren Variablen (sold-Median/Avg über 7d/30d/60d/90d/6M, stock-Median/Avg, myCost/myPrice/myQty), Operatoren, Funktionen (min/max/round/avg/abs) und 9 Beispiel-Formeln mit Erklärung. Am Ende steht ein Prompt-Template das du zusammen mit dem Dokument in ein Claude/ChatGPT-Fenster kopieren kannst — dann baut dir die KI eine Formel nach deiner Beschreibung.

**4. Datenaktualität einstellen** (Einstellungen → Datenaktualität)

Standard: 6 Monate. Bedeutet: Teile werden alle 6 Monate neu vom Markt abgefragt. Das Tool zeigt dir live an, wie viele API-Aufrufe pro Tag das braucht — kürzere Zeiträume brauchen mehr. Wenn's dein API-Limit überschreiten würde, blockt es.

**5. Auto-Sync einschalten** (Einstellungen → Auto-Sync)

Holt einmal täglich dein BrickLink-Inventar. Neue Lots werden ergänzt, verschwundene entfernt.

> **History bleibt erhalten:** Wenn ein Lot beim Sync aus deiner Watchlist verschwindet (weil du es im Store gelöscht oder komplett verkauft hast), wird nur der Watchlist-Eintrag entfernt — die kompletten Preis- und Verkaufsdaten aus 6 Monaten BL-Historie **bleiben in der Datenbank** und hängen am Teil selbst, nicht an deinem Lot. Legst du dasselbe Teil (gleiche Part-Nr + Farbe + Zustand) später wieder in deinen Store, taucht es beim nächsten Sync mit **kompletter alter History** wieder auf — Chart, Medians, Trend sind sofort da, kein Neu-Crawl nötig.

**6. Inventar sofort holen** — beim ersten Mal willst du nicht bis zum nächsten Scheduler-Tick warten:

Auf `/watchlist` gibt's oben rechts einen **"Sync jetzt"-Button**. Klick drauf → holt sofort dein komplettes BL-Inventar. Bei einem leeren Konto zeigt die Seite außerdem einen blauen **Onboarding-Banner** mit demselben Button und Hinweisen — je nachdem was du noch nicht konfiguriert hast.

Das war's — der Crawler läuft ab jetzt im Hintergrund. Preise landen nach und nach in `/watchlist`.

![Detail-Ansicht eines Teils — Preis-Vergleich + 12-Monats-Chart](docs/02-parts-detail-1.png)
![Detail-Ansicht eines Teils — Angebote + Sales-Historie](docs/02-parts-detail-2.png)

### Was dich beim ersten Mal erwartet: **Geduld**

Wenn du deinen Store das erste Mal verbindest, ist die Watchlist erst mal **leer bei den Preisdaten**. Der Crawler muss für jedes Lot zweimal die BL-API anrufen (einmal für Sold-Historie, einmal für aktuelle Angebote).

Wie viele Aufrufe pro Tag möglich sind, gibt **dein BrickLink-API-Kontingent** vor. BrickLink limitiert **5.000 Aufrufe pro Tag pro BL-Account** (Stand 2026, kann sich ändern). Wichtig: **es zählt pro Account, nicht pro API-Consumer-Key** — mehrere Keys anzulegen bringt nichts, die teilen sich alle dieselben 5.000.

**Standard-Einstellung in dieser App: 1.000 Aufrufe/Tag** — konservativ gewählt, damit andere Tools (BrickSync, Inventar-Manager, Automations) nicht plötzlich ohne Kontingent dastehen. Damit sieht die Dauer für den Erst-Crawl so aus:

| Store-Größe | API-Aufrufe nötig | Bei 1.000/Tag (Standard) |
|---|---|---|
| 500 Lots | 1.000 | ~1 Tag |
| 2.000 Lots | 4.000 | ~4 Tage |
| 5.000 Lots | 10.000 | ~10 Tage |
| 10.000 Lots | 20.000 | ~3 Wochen |
| 20.000 Lots | 40.000 | ~6 Wochen |

Wenn du weißt dass keine anderen Tools mit deinem BL-Account sprechen, kannst du die Zahl unter **Einstellungen → API Keys → Tageslimit** hochsetzen (bis maximal 5.000). Bei 4.500/Tag halbieren/vierteln sich die Zeiten entsprechend.

**⚠ Andere Tools zählen mit — trag sie in der App ein!**

Damit der Crawler nicht mehr verbraucht als er darf, kannst du **grobe Schätzwerte für externe Tools** hinterlegen: **Einstellungen → API Keys → Externe Aufrufe**. Für **BrickSync ist bereits ein Standardwert eingetragen** (~288 Aufrufe/Tag bei 5-Min-Poll) — der wird automatisch vom Kontingent abgezogen. Du kannst weitere Tools ergänzen (Name + Intervall in Sekunden).

Realistische Werte zum Nachtragen:
- BrickSync 5-Min-Poll: 300s → ~288/Tag (schon eingetragen)
- Externer Inventar-Manager alle 10 Min: 600s → ~144/Tag
- N8N-/Automation-Flow: nach eigener Frequenz

Das Dashboard rechnet live: **Crawler-Verbrauch + Extern-Schätzung + Rest** = deine echte Auslastung. Wird das eingestellte Limit erreicht, paced sich der Crawler von selbst runter — nichts geht kaputt, der Erst-Crawl dauert dann eben länger.

**Was du in dieser Anlaufphase sehen wirst:**
- Watchlist: Teile werden nach und nach farbig (grün = frische Preise, grau = noch nicht gecrawlt)
- Preisempfehlungen erscheinen sobald das jeweilige Lot vollständig gecrawlt ist
- Der Crawler priorisiert intelligent: neue Teile zuerst, dann die ältesten Preisdaten
- Sobald einmal alles da ist, hält der Crawler im "Wartungs-Modus" alle Preise alle 6 Monate frisch — das ist entspannt, verbraucht kaum was

---

## Preisempfehlungen in deinen Store übertragen

**Nichts passiert automatisch** — du behältst immer die Kontrolle. Es gibt zwei Wege wie die Preise vom Tracker in deinen BL-Store kommen:

### Weg A (empfohlen): BrickStore-Extension — ein Klick, kein Copy-Paste

Die **native BrickStore-Extension** unter [extensions/brickstore/bricklink-price-tracker.bs.qml](./extensions/brickstore/bricklink-price-tracker.bs.qml) macht den ganzen Workflow zu einem einzigen Klick: **Extras → Preise aus Price Tracker holen…** — BrickStore fragt in Batches beim Tracker die Empfehlungspreise + Rabatte + Lock-Zustand ab und schreibt sie direkt in die aktuell geöffnete BSX.

Die Extension ist QML/JavaScript, läuft nativ in BrickStore, kein Backend-Dienst, keine Abhängigkeit. Netzwerk-Zugriff zwischen BrickStore und deinem Tracker per Bearer-Token.

#### Installation (einmalig, Schritt für Schritt)

**1) Extension-Datei aus dem Repo holen** — Rechtsklick → "Speichern unter" auf diesen Roh-Datei-Link:
```
https://raw.githubusercontent.com/rainman19121979/bl-price-tracker/main/extensions/brickstore/bricklink-price-tracker.bs.qml
```

**2) Token im Tracker anlegen** — im Tracker: **Einstellungen → API-Tokens → Neuen Token anlegen** → 32-64-Zeichen-String kopieren. Gib dem Token einen Namen wie "BrickStore" damit du ihn später erkennst.

**3) Datei mit einem Text-Editor öffnen** (Windows: Notepad reicht; macOS: TextEdit; Linux: nano/gedit) und die zwei Zeilen am Anfang anpassen:

```qml
readonly property string trackerUrl: "http://YOUR_TRACKER_HOST:3000"
readonly property string trackerToken: "PASTE_YOUR_TOKEN_HERE"
```

- **`trackerUrl`**: die Adresse unter der du deinen Tracker vom BrickStore-Rechner aus erreichst. Beispiele: `http://100.114.180.28:3000` (Tailscale-IP), `http://192.168.1.42:3000` (LAN-IP), `https://tracker.deine-domain.de` (Public-Domain). Ohne trailing Slash.
- **`trackerToken`**: den kopierten Token einsetzen.

Speichern.

**4) Datei in den BrickStore-Extensions-Ordner kopieren** — plattformabhängig:

- **Windows:** `C:\Users\<DEIN_USERNAME>\AppData\Roaming\BrickStore\extensions\`
  - Kürzel im Explorer: `%APPDATA%\BrickStore\extensions\` in die Adresszeile eingeben und Enter drücken
  - Der `AppData`-Ordner ist standardmäßig versteckt — im Explorer unter Ansicht → "Ausgeblendete Elemente" aktivieren, oder direkt den Pfad in die Adresszeile eingeben
- **macOS:** `~/Library/Application Support/BrickStore/extensions/`
  - Im Finder: **Gehe zu → Ordner…** (Cmd+Shift+G), Pfad einfügen
  - `~/Library` ist standardmäßig versteckt
- **Linux:** `~/.local/share/BrickStore/extensions/`

Wenn der `extensions`-Ordner nicht existiert, einfach anlegen. Die `.bs.qml`-Datei muss direkt drin liegen (nicht in einem Unterordner).

**5) Extension in BrickStore laden** — **Extras → Reload user scripts** (kein Neustart nötig). In den Log-Meldungen sollte `[ ok ] bricklink-price-tracker.bs.qml` erscheinen.

#### Verwendung

1. BSX-Datei in BrickStore öffnen (oder Store-Bestand direkt runterladen: Datei → BrickLink-Store → Aktualisieren)
2. **Optional:** einzelne Lots markieren (Strg+Klick / Shift+Klick). Ohne Markierung: alle Lots im Dokument.
3. **Extras → Preise aus Price Tracker holen…**
4. Progress-Overlay läuft durch (bei 5000 Lots ca. 30-60 Sek je nach Netzwerk)
5. Zusammenfassungs-Report landet in **Extras → Developer Console** (BrickStore erlaubt in Extensions keinen Popup-Dialog aus dem async-Kontext — siehe FAQ unten)
6. BSX prüfen (Preis-Spalte hat neue Werte), speichern, zu BL hochladen wie gewohnt

#### Was die Extension pro Lot macht

- **Preis** (`Price`-Spalte): wenn im Tracker `priceLocked=true` (Schloss-Icon in der Watchlist) → schreibt deinen manuellen `myPrice`. Sonst → `suggestedPrice` aus deiner Preisformel.
- **Rabatt** (`Sale`-Spalte, 0-99%): schreibt `saleRate` aus dem Tracker.
- **Sicherheits-Guard:** Preise = 0 werden **nie** geschrieben (verhindert versehentliche Gratis-Angebote). Solche Lots werden übersprungen.
- **Angetastet werden nur `Price` und `Sale`** — `Cost`, `Comments`, `Remarks`, `Quantity`, `LotID`, `DateAdded` bleiben unverändert.
- Selection-aware: markierte Lots oder alle im Dokument.
- Batch-Größe 100 Lots pro API-Call. Fehler pro Lot (Part nicht im Tracker, API-Limit erschöpft) werden übersprungen und im Report gezählt.

#### FAQ

- **"Wo sehe ich das Ergebnis?"** — Die Preis-Spalte in BrickStore ist der schnellste Check. Für den detaillierten Report (Aktualisiert X, Übersprungen Y, API-Budget verbraucht): **Extras → Developer Console** öffnen. Warum kein Popup? BrickStore erlaubt Extensions keine QML-Dialoge aus async-Kontext (verifiziert 2026-08-16 — `MessageDialog.open()` wird stumm geblockt).
- **"Wie oft soll ich das laufen lassen?"** — Vor jedem BL-Upload. Der Tracker aktualisiert Preise kontinuierlich im Hintergrund, deine BSX bekommt aber nur den Wert der zum Zeitpunkt des Extension-Laufs im Tracker steht.
- **"Was wenn ich einen Lot in BrickStore neu anlege der noch nicht im Tracker ist?"** — Die Extension crawlt das Teil beim Backend automatisch nach (kostet 2 BL-Calls für PART/MINIFIG, 6 für SET) und schreibt den Empfehlungspreis rein. Praktisch als "Preisvorschau" für neue Teile bevor du sie zu BL hochlädst — verbraucht aber dein BL-API-Budget.
- **"Was passiert wenn ein Teil sowohl im Tracker als auch im BrickStore ist, aber die Inventar-ID sich geändert hat (nach Verkauf + Nachschub)?"** — Rabatt/Lock hängt am Watchlist-Eintrag (per `blInventoryId`). Bei einer neuen ID sind Rabatt/Lock nicht gesetzt, aber der `suggestedPrice` wird korrekt berechnet (matched über Part-Nr + Farbe + Zustand). Manuellen Rabatt/Lock musst du im Tracker für den neuen Lot einmal wieder setzen.
- **"Was wenn der Tracker gerade down ist?"** — Die Extension zeigt einen Netzwerk-Fehler in der Console, die BSX bleibt unverändert.

### Weg B (manuell): BSX-Export + Copy-Values in BrickStore

Falls du die Extension nicht installieren willst oder mal ohne sie arbeiten musst — der Original-Workflow funktioniert weiter:

1. **In dieser App:** `/watchlist` → oben rechts **"BSX-Export"** herunterladen → Datei `pricetracker-empf-preise.bsx` landet in deinen Downloads
2. **In BrickStore öffnen:** Datei → Öffnen → die heruntergeladene BSX-Datei
3. **Deinen aktuellen Shop-Bestand daneben öffnen:** in BrickStore auf den Store-Tab → Store-Bestand herunterladen (falls noch nicht offen)
4. **In das Shop-Bestand-Fenster wechseln** (nicht der Export!) — Ziel ist dorthin die Preise zu kopieren
5. **Alles im Shop-Bestand markieren** (Strg+A)
6. Menü **Bearbeiten → "Werte von anderem Dokument kopieren…"**
7. Im Dialog: die Export-Datei `pricetracker-empf-preise.bsx` auswählen → Weiter
8. Im Feld-Dialog: bei **Preis** auf **"Kopieren"** klicken, für **alle anderen Felder** auf **"Ignorieren"** klicken (muss aktiv gesetzt werden — Vorauswahl ist anders!) → **Abschließen**
9. BrickStore übernimmt nur die neuen Preise ins Shop-Bestand-Dokument, alles andere bleibt wie es war
10. Prüfen ob es passt, dann wie gewohnt: **BrickLink → Store → Upload / Aktualisieren** — deine Preise sind live

> **Sicherheitsnetz im Export:** Nur Lots mit BrickLink-Inventory-ID (also welche die per Sync kamen) werden exportiert. Manuell hinzugefügte Lots ohne ID bleiben draußen, weil sie beim Kopieren keinen Match-Partner im Shop-Bestand hätten.

---

## BSX-Order-Import (Verkäufe tracken) — optional

Die `/sales`-Seite zeigt deine eigenen Verkäufe (KPI-Karten, 12-Monats-Chart, Top-10). Drei Wege wie die BSX-Order-Dateien reinkommen: **manueller Upload**, **automatischer lokaler Ordner-Scan** oder **SMB/NAS-Freigabe** — je nach Setup.

**Vollständige Doku:** [Wiki → BSX-Import](./wiki/BSX-Import.md)

---

## Sicher auf einem VPS betreiben

Wenn du die App auf einem VPS (Netcup, Hetzner, Contabo, …) statt daheim betreibst, ist sie ohne extra Härtung öffentlich erreichbar. Die wichtigsten Schritte:

- **Reverse Proxy mit HTTPS** (Caddy o.ä.), Port 3000 nicht direkt exponieren
- **Firewall** nur 22/80/443 offen (`ufw`)
- **`NEXTAUTH_URL=https://tracker.deine-domain.de`** in `.env`
- **Selbst-Registrierung ist per Design geschlossen** nach dem ersten User (siehe [NOTICE.md](./NOTICE.md))
- **SSH-Härtung** (kein Passwort-Login), **OS-Auto-Updates** (`unattended-upgrades`)
- **Automatische Backups** via Cronjob mit `pg_dump`

Was die App bereits an Härtung mitbringt: bcrypt für Passwörter, AES-256-GCM für BL-Keys + SMB-Passwörter, HTTPOnly/SameSite-Session-Cookies, Rate-Limits auf Login/Registration/Key-Tests, CSP-Header, Middleware-Auth-Guard.

**Vollständige Checkliste + Caddy-Config-Beispiel + Backup-Cronjob:** [Wiki → Deployment + Security](./wiki/Deployment-Security.md)

Wenn du die Instanz doch für andere zugänglich machen willst (Community-Instanz, mehrere BL-Stores, Familie): du musst dann selbst dafür sorgen dass die BrickLink API TOS für Publikums-Anwendungen erfüllt sind (Attribution-Notice, Kontakt-Email, ToS/Privacy). Details im Wiki-Deployment-Kapitel.

---

## Backup & Restore

Als **Admin** unter Einstellungen → "Backup & Restore":

- **Backup herunterladen** — kompletter Datenbank-Dump (SQL) als Download. Enthält Watchlist, Preisformeln, verschlüsselte API-Keys, Marktdaten, deine Verkäufe. Der `ENCRYPTION_KEY` aus `.env` ist **nicht** dabei — sichere ihn separat, sonst sind die Keys nach dem Restore unlesbar.
- **Restore hochladen** — SQL-Datei per Upload einspielen. Fragt nach Bestätigung (`ERSETZEN` tippen), ersetzt komplett die aktuelle DB, loggt dich danach automatisch aus.

**Wichtig — BrickLink-Nutzungsbedingungen beachten:** Die Backup-Datei enthält Preis-, Verkaufs- und Angebots-Daten aus der BrickLink-API. Laut BrickLink API Terms of Use darfst du **diese Daten nicht an Dritte weitergeben, veröffentlichen oder verkaufen**. Das Backup ist ausschließlich für deinen eigenen Wiederherstellungs-Zweck. Wenn du das Tool jemandem anderen zur Nutzung überlässt, muss diese Person einen eigenen BrickLink-Account und eigene API-Zugangsdaten benutzen — geteilte Nutzung mit einem BL-Account ist nicht erlaubt. Siehe [NOTICE.md](./NOTICE.md).

### Preisdaten-only Export/Import (für Instanz-Umzug)

Direkt unter Backup & Restore in den Einstellungen: **Preisdaten Export / Import**. Ein schmalerer Export der **nur** die Markt-Tabellen enthält (Parts + Sales + Stock + Daily-Rollups) — keine User, keine Watchlist, keine API-Keys.

- **Exportieren** — NDJSON-Datei zum Download. Bei einer aktiv genutzten Instanz oft mehrere hundert MB, aber das Streaming-Format macht daraus kein RAM-Problem.
- **Importieren** — additiver Merge: bereits vorhandene Zeilen bleiben unangetastet (Dedup-Index mit `NULLS NOT DISTINCT` beachtet auch die completeness-Dimension bei SETs), nur echt neue Zeilen kommen dazu. Die Daily-Rollups werden für alle betroffenen Kombinationen anschließend aus den Sales neu berechnet — konsistente Charts sofort, kein "warten bis der nächste Crawler-Lauf den Cache rechnet".

Zweck: Instanz-Umzug (VPS → Raspberry Pi), Merge zwischen deinen eigenen Instanzen, Datenrettung nach Neuinstallation ohne vollständigen SQL-Dump zurückzuspielen.

**Auch hier gilt:** Die exportierten Daten stammen aus der BrickLink-API. Weitergabe an Dritte ist laut BrickLink API TOS unzulässig — der Export ist ausschließlich für den eigenen Instanz-Umzug oder den Merge zwischen den **eigenen** Instanzen gedacht.

---

## Wartung

```bash
docker compose logs -f web        # Logs live mitlesen
docker compose logs -f crawler    # Crawler-Aktivität
docker compose ps                 # Status aller Services
docker compose down               # Alles stoppen
docker compose pull && docker compose up -d   # Update auf neuste GHCR-Version
```

Daten (Postgres, Redis) liegen in Docker-Volumes und überleben `down` und `up`.

**Update ziehen:**

```bash
cd /opt/bl-price-tracker
git pull                          # Neue Compose-Datei & Migrations holen
docker compose pull               # Neustes Image von ghcr.io ziehen (~30 Sek)
docker compose up -d              # Container mit neuem Image starten
```

**Update-Anzeige in der App:** In der Sidebar unten steht die aktuelle Version. Sobald auf GitHub eine neuere Release veröffentlicht ist, erscheint neben der Versionsnummer ein pulsierender gelber Punkt mit dem Text "Update vX.Y.Z". Klick darauf öffnet ein Popup mit Release-Notes-Link und dem fertigen Update-Befehl zum Kopieren. Der Check läuft admin-seitig alle 6 Stunden gegen die GitHub-API (Redis-cached, kein Traffic-Impact).

**Crawler-Priorisierung:** der Crawler arbeitet mit drei Prioritätsebenen — Watchlist-Änderungen (höchste), Missstände (Teile die nicht deinem aktuellen Setting entsprechen, z.B. Country-Mismatch), Baseline-Freshness-Rotation. Budget-Aufteilung: 80% des freien Rests für Missstand-Boost, 20% Reserve für Spikes. Details + Dashboard-Erklärung: [Wiki → Advanced Crawler](https://github.com/rainman19121979/bl-price-tracker/wiki/Advanced-Crawler)

**Lokal bauen statt GHCR-Image nutzen** (nur für Devs / Forks):
```bash
docker compose up -d --build      # überschreibt das GHCR-Image mit lokalem Build
```

---

## Ohne Docker (Bare Metal)

Für Fortgeschrittene ohne Docker — Node.js 20+, PostgreSQL 15+, Redis 7+ auf dem Host. Systemd-Services für Web + Crawler + Scheduler. Vollständige Anleitung inkl. systemd-Unit-Files: [Wiki → Bare-Metal-Install](https://github.com/rainman19121979/bl-price-tracker/wiki/Bare-Metal-Install)

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

![API-Tokens verwalten mit Copy-Paste-Curl-Beispielen](docs/05-settings-api.png)

**Volle Dokumentation mit Beispielen:** [API.md](./API.md) — inkl. der BrickStore-Extension die auf diesen Endpoints aufsetzt (Installation und Verwendung sind oben unter *[Preisempfehlungen in deinen Store übertragen — Weg A](#weg-a-empfohlen-brickstore-extension--ein-klick-kein-copy-paste)* beschrieben).

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
