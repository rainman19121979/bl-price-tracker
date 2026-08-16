# Troubleshooting / FAQ

Sammlung bekannter Probleme + Lösungen. Ergänze gerne bei neuen Fällen (PR im Repo).

---

## Installation / Docker

### App startet nach `docker compose up` nicht, "service migrate didn't complete"

**Ursache:** eine der Prisma-Migrations schlug fehl. Meistens:
- `relation "price_stock" does not exist` — fehlende Init-Migration (behoben ab v0.2.0)
- `column user_watchlists.new_or_used does not exist` — analog (behoben ab v0.2.0)

**Fix:** aktuelle Version pullen (`git pull && docker compose pull`), Migration-Container läuft dann sauber durch.

Falls du auf einer alten Instanz stecken bleibst mit einem konkreten Migration-Fehler: `docker compose logs migrate 2>&1 | tail -40` posten in Discussions Q&A.

### Fresh Install: "Nur X MB frei" — Docker fressen zu viel Speicher

**Ursache:** Docker sammelt alte Images/Container/Volumes im Lauf der Zeit an. Bei mehreren Test-Installs schnell 4-5 GB.

**Fix:**
```bash
cd /opt/bl-price-tracker 2>/dev/null && docker compose down -v --remove-orphans; cd /
sudo rm -rf /opt/bl-price-tracker
docker system prune -af --volumes
```

**Achtung:** `--volumes` löscht auch Volumes anderer Docker-Anwendungen auf dem Host. Bei Test-VM egal, auf Prod-Host vorher überlegen.

### GitHub-Actions-Build crasht mit "Illegal instruction" beim ARM64-Build

**Ursache:** QEMU-Version-Bug (SWC/esbuild crasht unter ARM64-Emulation mit neueren QEMU-Versionen).

**Fix:** ist ab v0.3.1 in `.github/workflows/docker-publish.yml` gepinnt auf `qemu-v7.0.0-28`. Wenn du einen eigenen Fork hast der crasht, den QEMU-Setup-Step so anpassen:
```yaml
- uses: docker/setup-qemu-action@v3
  with:
    platforms: arm64
    image: tonistiigi/binfmt:qemu-v7.0.0-28
```

---

## Login / Auth

### Nach Update auf v0.3.0: `/register` gibt 404 obwohl niemand registriert ist

**Ursache:** wenn du VOR dem Update schon einen User in der DB hattest, ist die Bootstrap-Registrierung schon durch. Neue User kannst du nicht mehr per `/register` anlegen.

**Fix:** entweder direkt in der DB (`psql`) einen zusätzlichen User anlegen, oder — wenn wirklich niemand da sein sollte — mit `docker compose exec db psql -U pricetracker -d pricetracker -c "SELECT COUNT(*) FROM users;"` prüfen. Ist die Zahl >0, gab's schon einen User (evtl. wurde er wieder gelöscht — Bootstrap-Register-Route gilt trotzdem als abgeschlossen weil `userCount>0` in der Vergangenheit).

### Login auf Tailscale-IP zeigt "UntrustedHost 500"

**Fix:** in `.env` `NEXTAUTH_URL` leer lassen. NextAuth leitet dann von der aktuellen Request-URL ab. Ab v0.1.1 default so eingerichtet, bei alten Instanzen manuell prüfen.

### Login redirected auf localhost:3000 obwohl ich per Tailscale-IP komme

**Fix:** analog zum vorigen — `NEXTAUTH_URL` in `.env` löschen (oder auf leere Zeile setzen) + `docker compose up -d` (Neustart des web-Containers).

---

## Preise / Crawler

### `suggestedPrice = 0` bei einigen Lots

**Häufige Ursachen (nach Wahrscheinlichkeit):**

1. **Marktdaten fehlen komplett** — Part wurde noch nie gecrawlt (`last_sold_crawl_*` und `last_stock_crawl_*` sind NULL). Warten bis Crawler-Rotation dran ist, oder in Watchlist manuell "Refresh" triggern.
2. **Formel liefert 0** weil `stockMedian * X` und `sold*Median * Y` beide auf 0 evaluieren (Marktdaten waren leer beim letzten Crawl). Formel mit Fallback anpassen: `max(sold90dMedian * 0.95, myCost * 1.30, myPrice)`.
3. **Country-Filter matcht nichts** — dein `sellerCountries='DE'` + die aktuellsten Stock-Zeilen sind `'XX'` (weltweit-Fallback nach BL-Änderung). Ab v0.3.1 gibt es den XX-Fallback im Filter — trotzdem: der Country-spezifische Crawl braucht ~10 Tage bis alle Lots durchrotiert sind.
4. **Bei SETs (v.a. Minifig-Serie col*):** BL implementiert den Completeness-Split für Minifigs nicht — alle Marktdaten liegen als `completeness=NULL` in DB. Der `getStatsForLot()`-Fallback ab v0.3.1 matcht das, aber wenn dein Cache stale ist, siehst du noch die alten 0-Werte. `recomputeAllLotsForUser` triggern (per DB-Query oder per Formel-Änderung in Settings).

### "Aktuelle Angebote (DE)" zeigt "Keine Daten" trotz vieler Angebote

**Ursache:** BL liefert bei Stock keine `seller_country`-Codes pro Angebot. Vor dem Fix in v0.3.1 wurde alles als `'XX'` gespeichert, dein DE-Filter matchte nichts.

**Fix:** ab v0.3.1 automatisch — Aggregation-Query erlaubt `'XX'` als Fallback. Nach dem Country-Rotation-Cycle (~10 Tage) werden die Zeilen mit echtem `seller_country='DE'` (Server-seitiger BL-Filter) neu gecrawlt.

Manuell forcieren: Detail-Seite → "Aktualisieren"-Button → macht sofort einen neuen Crawl mit `country_code=DE`.

### Empfehlungspreis ist deutlich unter meinem Cost

**Ursache:** deine Formel hat keine Cost-Untergrenze, oder du hast fälschlich `myCost / myQty * X` verwendet (das war die alte Doku, ist ab v0.3.1 korrigiert — `myCost` ist bereits per-Stück).

**Fix:** in deiner Formel `max(..., myCost * 1.30)` als Cost-Untergrenze einbauen. Siehe [Preisformel-Rezepte → Cost-Guardrail](./Preisformel-Rezepte.md#cost-guardrail).

### Crawler crawlt nicht — steht bei "Nichts zu tun"

**Ursachen:**

1. **Kein API-Key hinterlegt** — Einstellungen → BL API Keys prüfen
2. **`crawlerEnabled=false`** in Users — Einstellungen → Crawler-Toggle
3. **Tageslimit erreicht** — Dashboard "API Calls (24h)" zeigt Wert am Limit
4. **Alle Parts fresh** — nichts stale gemäß `freshDays`-Setting. Crawler wartet auf Rotation.

---

## BrickStore-Extension

### Nach Klick auf "Preise aus Price Tracker holen" passiert nichts

**Diagnose:** in BrickStore **Extras → Developer Console** öffnen und Extension nochmal triggern. Dort steht was schiefging:

- `[BL Price Tracker] Netzwerk-Fehler beim Kontakt mit dem Tracker` → `trackerUrl` in der Datei falsch, oder Tracker down
- `Tracker-API antwortete mit HTTP 401` → Token falsch/abgelaufen — neuen in `/settings/api-tokens` generieren
- Kein Log-Eintrag überhaupt → `Extras → Reload user scripts` machen, Datei liegt evtl. nicht im richtigen Ordner (siehe README für Pfade)

### "Cannot modify a const Lot" im Log

**Fix:** in v0.3.0 alt. Ab v0.3.0-final gefixt — Extension speichert Indexes statt Lot-Referenzen und holt beim Schreiben schreibbare Refs per `doc.lots.at(i)`. Aktuelle Extension-Datei aus `extensions/brickstore/` ziehen.

### Preise werden auf 0.000 gesetzt

**Fix:** in einer alten Extension-Version passierte das wenn suggestedPrice=0 zurückkam. Ab v0.3.1 gibt es einen `>0`-Guard — solche Lots werden übersprungen, nie mit 0 überschrieben. Aktuelle Extension-Datei ziehen.

### Zusammenfassungs-Dialog kommt nicht — Extension endet stumm

**Erwartetes Verhalten** — nicht behebbar ohne BrickStore-Upstream-Änderung. BrickStore erlaubt Extensions keinen QML-Dialog aus async-Kontext (verifiziert 2026-08-16). Der Report landet in **Extras → Developer Console** — bitte dort nachsehen.

### `myCost`-Werte im BL-Store zerschrödert (Micro-Cent-Werte)

**Ursache:** in Versionen vor v0.3.1 teilte der BSX-Export `myCost` durch `myQuantity` — beim Round-Trip zu BL wurden Cost-Werte durch die Menge geteilt.

**Fix:** Update auf v0.3.1+. Für schon zerschrödelte Cost-Werte: die musst du manuell in BL wiederherstellen. Siehe [Discussion / Ideas](https://github.com/rainman19121979/bl-price-tracker/discussions) falls jemand einen Automatismus dafür braucht.

---

## Sonstiges

### BSX-Order-Import läuft nicht — "Ordner nicht gefunden"

**Ursache:** der Pfad in Einstellungen → BSX-Import ist aus Docker-Container-Sicht nicht erreichbar.

**Fix:** in `.env` `BSX_HOST_PATH=/dein/host/pfad/zu/bricksync/orders` setzen, `docker compose up -d --build`. Dann in der UI unter "Lokaler Ordner" `/bsx-orders` eintragen (das ist der bind-mounted Pfad im Container).

### SMB-Verbindung fürs BSX-Import scheitert mit "SMB Auth Failed"

**Häufige Ursachen:**
- **Windows/Samba-Version-Konflikt** — moderne SMB2/3 vs. alte SMB1. Muss auf beiden Seiten kompatibel sein.
- **Domain-Feld falsch** — meistens leer lassen. Nur bei Windows-Domain-Umgebungen einen Wert setzen.
- **Passwort-Sonderzeichen** — testweise ein Test-Passwort ohne Sonderzeichen probieren um Encoding-Problem auszuschließen.

Test-Aufruf im Container: `docker compose exec web smbclient -L //nas.local -U user` — zeigt ob überhaupt Verbindung geht.

### Auto-Sync erkennt einen verkauften Lot nicht als "verkauft"

**Ursache:** wir nutzen aktuell **keine** quantity-diff-Detection mehr (die produzierte unzuverlässige Sales). Sales werden nur aus BSX-Order-Import (`my_sales`-Tabelle) gefüllt.

**Fix:** BSX-Order-Import einrichten (Einstellungen → BSX-Import), damit du eine echte Verkaufs-Historie hast. Der Auto-Sync entfernt zwar den verkauften Lot aus der Watchlist, aber ohne BSX-Import gibt es keinen Sales-Eintrag.

---

## Ich finde meinen Fall hier nicht

- **Bug melden:** [GitHub Issues](https://github.com/rainman19121979/bl-price-tracker/issues) mit: Version (Sidebar links unten), Steps to reproduce, Logs
- **Frage stellen:** [GitHub Discussions Q&A](https://github.com/rainman19121979/bl-price-tracker/discussions/categories/q-a)
