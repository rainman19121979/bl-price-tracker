# Getting-Started-Tutorial

**Ziel:** vom Fresh-Install zum ersten Empfehlungspreis in deiner Watchlist. Dauer ~30 Minuten (davon ~5 Min tatsächliches Klicken, Rest wartet der Crawler auf seine ersten API-Antworten von BrickLink).

> **Zu dieser Seite:** die Textstruktur ist da, aber **Screenshots fehlen noch**. Wenn du das Tutorial durchläufst und einen guten Screenshot schießt, PR gerne im Repo unter `docs/wiki-screenshots/` — dann bauen wir sie hier ein. Screenshot-Namen wie `01-register.png`, `02-api-key.png` etc.

---

## Vor dem Start

**Was du brauchst:**

- Ein Server / VM / Raspberry Pi mit Docker (2 GB RAM, 20 GB Platte, Ubuntu/Debian empfohlen). Falls du BrickSync schon lokal laufen hast, geht das genauso — der Tracker kommt daneben.
- Ein aktiver BrickLink-Store (nicht nur Käufer-Account — API-Keys werden nur für Seller ausgestellt)
- **BrickLink API OAuth-Zugangsdaten** — 4 Werte (Consumer Key, Consumer Secret, Access Token, Access Token Secret). Bekommst du unter https://www.bricklink.com/v3/api.page nach dem Aktivieren
- ~15 Min für Setup + ein paar Tage für den ersten Crawl-Durchlauf (Preise landen nach und nach in der Watchlist)

---

## Schritt 1: Installer laufen lassen

Auf einem frischen Ubuntu/Debian-Server (oder Raspberry Pi mit Raspberry Pi OS):

```bash
apt update && apt install -y curl
curl -fsSL https://raw.githubusercontent.com/rainman19121979/bl-price-tracker/main/scripts/install.sh -o install.sh
sudo bash install.sh
```

Der Installer:

- Prüft OS, RAM, Platte, freie Ports
- Installiert Docker falls nötig
- Klont das Repo nach `/opt/bl-price-tracker`
- Erzeugt zufällige Secrets in `/opt/bl-price-tracker/.env`
- Fragt nach dem Zugriffsmodus (Localhost + Tailscale empfohlen, oder Public-Domain + Caddy)
- Startet Docker-Compose-Stack + wartet bis App antwortet

> **Screenshot fehlt:** `01-installer-abschluss.png` — die Success-Meldung mit URL, Passwort-Hinweisen etc.

**Erwartete Dauer:** 3-5 Min (davon 30 Sek für Docker-Pull, Rest ist Setup).

---

## Schritt 2: Erst-User anlegen

Im Browser die URL aufrufen die der Installer angezeigt hat (z.B. `http://100.114.180.28:3000` bei Tailscale). Die App leitet dich automatisch auf **`/register`**.

> **Screenshot fehlt:** `02-register.png` — das Register-Formular mit den Feldern Email/Username/Passwort.

Trag ein:

- **E-Mail** (wird nicht verifiziert, nur für Login)
- **Benutzername** (3-100 Zeichen alphanumerisch)
- **Passwort** (mind. 8 Zeichen, Upper+Lower+Digit)

Klick "Registrieren" → wirst du auf `/login` weitergeleitet, meld dich mit den gerade angelegten Zugangsdaten an.

**Wichtig:** dein erster Account wird **automatisch Admin**. Nach dem ersten User ist die `/register`-Seite dauerhaft dicht (BL API TOS — mehr dazu in [NOTICE.md](../NOTICE.md)).

---

## Schritt 3: BrickLink-API-Key hinterlegen

Nach dem Login öffnet sich das Dashboard. Geh zu **Einstellungen → BrickLink API Keys → "Neuen Key hinzufügen"**.

> **Screenshot fehlt:** `03-api-key-anlegen.png`

Trag die 4 OAuth-Werte ein:

- **Consumer Key**
- **Consumer Secret**
- **Access Token (= Token Value)**
- **Access Token Secret**

**Tageslimit:** default 1000 Calls/Tag. BrickLink erlaubt bis zu 5000/Tag pro Account (nicht pro Key — mehrere Keys teilen sich das Kontingent). 1000 ist konservativ eingestellt damit BrickSync und andere Tools nicht ohne Budget dastehen. Bei einem Solo-Setup ohne externe Tools kannst du hoch auf 4500/Tag.

Klick **Speichern** → dann **Testen**. Muss grün werden ("API-Verbindung erfolgreich").

---

## Schritt 4: Länder-Filter setzen

**Einstellungen → Verkäuferländer + Versandländer**

Beispiel für einen deutschen Händler der nach DE/AT/CH verkauft:

- **Verkäuferländer:** DE (nur DE-Anbieter werden für Marktvergleich betrachtet)
- **Versandländer:** DE, AT, CH (nur Verkäufe an Käufer in diesen Ländern zählen)

> **Screenshot fehlt:** `04-country-filter.png`

**Achtung nach Änderung:** die Empfehlungspreise werden sofort neu berechnet, aber die "Aktuelle Angebote"-Anzeige in der Detail-Seite fällt vorerst auf weltweit zurück bis der Crawler alle Lots mit dem neuen Country-Filter durchrotiert hat (~10 Tage bei 1000 Calls/Tag).

---

## Schritt 5: Erste Preisformel definieren

**Einstellungen → Preisformeln → "Neue Regel"**

Simpelster Einstieg:

- **Name:** "Standard"
- **Filter:** Alle Item-Typen, Alle Zustände (Fallback für alles)
- **Formel:** `max(sold90dMedian * 0.95, myCost * 1.30)`

Bedeutung: "5 % unter dem 90-Tage-Verkaufsmedian, aber nie unter 30 % Marge auf deinen Einkauf".

> **Screenshot fehlt:** `05-formel-erste-regel.png` mit der Live-Vorschau am unteren Rand.

**Live-Vorschau** unten in der Regel-Karte zeigt dir sofort mit einem echten Lot aus deiner Watchlist was die Formel ergeben würde vs. dein aktueller Preis.

Für erweiterte Formeln siehe [Preisformel-Rezepte](./Preisformel-Rezepte.md).

---

## Schritt 6: Auto-Sync + Inventar-Erst-Sync

**Einstellungen → Auto-Sync einschalten** (holt einmal täglich dein BL-Inventar, erkennt neue/verkaufte Lots automatisch).

Dann direkt: **Watchlist-Seite → oben rechts "Sync jetzt"-Button** klicken. Der holt sofort dein komplettes BL-Inventar (1 API-Call). Bei ~10.000 Lots dauert das ca. 30 Sek — dann steht deine ganze Watchlist da.

> **Screenshot fehlt:** `06-watchlist-nach-sync.png` mit "grau" markierten Lots (noch keine Preise) und "grün" wo schon welche da sind.

---

## Schritt 7: Warten — der Crawler läuft ab jetzt

Der Crawler startet automatisch. Er holt für jedes Lot 2 API-Calls (bei SETs 6 — pro Completeness getrennt) und rechnet dann per Formel den Empfehlungspreis.

Bei **1000 Calls/Tag und 10.000 Lots × 2 Calls = 20.000 Calls nötig** → **~3 Wochen** bis dein kompletter Bestand einmal frisch ist.

> **Screenshot fehlt:** `07-dashboard-erst-crawl.png` mit dem Dashboard das den Progress zeigt.

**In den ersten 24h siehst du:**

- Dashboard: "Crawler Status" zeigt wieviele Calls/Tag gemacht werden und wie lang die ETA für alle offenen Lots ist
- Watchlist: erste Lots werden farbig (grün = frische Preisdaten, grau = noch nicht gecrawlt)
- Detail-Seiten: Preis-Charts füllen sich

**Nach dem Erst-Crawl** (nach ~3 Wochen) schaltet der Crawler in den "Wartungsmodus" — nur ein Bruchteil des Budgets wird verwendet, Preise bleiben trotzdem alle im Rhythmus deiner `freshDays`-Einstellung frisch.

---

## Schritt 8: BrickStore-Extension installieren (optional aber empfohlen)

Damit du deine Empfehlungspreise mit einem Klick in deine BSX bekommst statt Copy-Werte-Umweg über BrickStore:

Detailliert in [README → Preisempfehlungen übertragen → Weg A](../README.md#weg-a-empfohlen-brickstore-extension--ein-klick-kein-copy-paste). Kurzform:

1. `bricklink-price-tracker.bs.qml` aus `extensions/brickstore/` runterladen
2. `trackerUrl` + `trackerToken` (unter Einstellungen → API-Tokens generieren) einsetzen
3. Datei nach `%APPDATA%\BrickStore\extensions\` (Windows) bzw. `~/.local/share/BrickStore/extensions/` (Linux) kopieren
4. BrickStore → Extras → Reload user scripts

> **Screenshot fehlt:** `08-extension-menu.png` — der Menü-Eintrag "Preise aus Price Tracker holen…" unter Extras.

---

## Wenn was schiefgeht

Siehe [Troubleshooting](./Troubleshooting.md).
