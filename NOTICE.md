# NOTICE

BrickLink Price Tracker
Copyright (C) 2026 rainman19121979

Dieses Projekt ist per **Vibe-Coding mit KI-Unterstützung** entstanden — die
Idee, die Feature-Entscheidungen und das Testing kommen vom Autor, große
Teile des Codes wurden mit Claude (Anthropic) generiert und iteriert. Das
ist ein bewusster Ansatz und wird hier offen kommuniziert.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
details: <https://www.gnu.org/licenses/agpl-3.0.html>

## Disclaimer / Haftungsausschluss

**English**

This project is a private hobby project. It is **not affiliated with, endorsed
by, or connected to** the LEGO Group, LEGO System A/S, BrickLink Limited,
BrickOwl LLC, or any related entity.

- **LEGO®** is a registered trademark of the LEGO Group of companies, which
  does not sponsor, authorize, or endorse this project.
- **BrickLink®** is a registered trademark of BrickLink Limited (a subsidiary
  of the LEGO Group), which does not sponsor, authorize, or endorse this
  project.
- **BrickOwl®** is a trademark of BrickOwl LLC, which does not sponsor,
  authorize, or endorse this project.
- **BrickSync** is an independent tool by Alexis Naveros; this project does
  not represent or maintain BrickSync.

This tool interacts with the BrickLink API using credentials supplied by the
user. Users are responsible for ensuring their use complies with the
BrickLink API Terms of Service (<https://www.bricklink.com/v3/api.page>).

**Data usage restrictions (BrickLink API Terms of Use):** Data retrieved
from the BrickLink API — including price history, current offers, inventory
and sales — must not be distributed, disclosed, uploaded, or transferred to
any third party. It is exclusively for personal use of the account holder
whose API credentials fetched it. Do not share database backups or price-
data exports produced by this tool, do not publish price data harvested via
the tool, do not resell it as a price service.

**Single-account per instance.** This tool is designed for operation by
**one person / household / BrickLink store per instance**. Self-registration
of new users is disabled by design (the `/register` page returns 404 once
the first admin account exists) — no stranger can join an instance and gain
access to price data fetched with your BL account. The optional
"Preisdaten Export/Import" feature is intended for **your own** instance
migration (VPS → Raspberry Pi) or merging between your own instances —
never for sharing data with third parties.

The author accepts no liability for any losses, incorrect prices, banned
accounts, or any other damages arising from use of this software. Use at
your own risk.

---

**Deutsch**

Dieses Projekt ist ein privates Hobby-Projekt. Es steht in **keiner
Verbindung** zur LEGO Group, LEGO System A/S, BrickLink Limited, BrickOwl
LLC oder verwandten Unternehmen und wird von diesen nicht unterstützt oder
autorisiert.

- **LEGO®** ist eine eingetragene Marke der LEGO Group of companies. Diese
  hat dieses Projekt nicht autorisiert oder unterstützt.
- **BrickLink®** ist eine eingetragene Marke der BrickLink Limited
  (Tochterunternehmen der LEGO Group). Diese hat dieses Projekt nicht
  autorisiert oder unterstützt.
- **BrickOwl®** ist eine Marke der BrickOwl LLC. Diese hat dieses Projekt
  nicht autorisiert oder unterstützt.
- **BrickSync** ist ein unabhängiges Tool von Alexis Naveros; dieses Projekt
  ist keine Vertretung und keine Wartung von BrickSync.

Das Tool nutzt die BrickLink-API mit den Zugangsdaten des Anwenders. Nutzer
sind selbst dafür verantwortlich, die Nutzungsbedingungen der BrickLink-API
einzuhalten (<https://www.bricklink.com/v3/api.page>).

**Datennutzungs-Einschränkungen (BrickLink API Terms of Use):** Daten die
über die BrickLink-API abgerufen werden — inklusive Preishistorie, aktueller
Angebote, Inventar und Verkäufe — dürfen **nicht an Dritte weitergegeben,
veröffentlicht, hochgeladen oder verkauft** werden. Sie sind ausschließlich
für den privaten Gebrauch des Account-Inhabers dessen API-Zugangsdaten sie
abgerufen haben. Datenbank-Backups oder Preisdaten-Exports die dieses Tool
erstellt niemals mit anderen teilen, Preisdaten nicht öffentlich stellen,
keinen Preis-Service mit den Daten aufbauen.

**Ein Account pro Instanz.** Das Tool ist für den Betrieb durch **eine
Person / einen Haushalt / einen BrickLink-Store pro Instanz** konzipiert.
Selbst-Registrierung fremder Nutzer ist per Design deaktiviert (`/register`
antwortet mit 404 sobald der erste Admin-Account existiert) — kein Fremder
kann sich auf deiner Instanz einen Account anlegen und auf die mit deinem
BL-Account gecrawlten Preisdaten zugreifen. Das optionale "Preisdaten
Export/Import"-Feature ist ausschließlich für den **eigenen** Instanz-Umzug
(VPS → Raspberry Pi) oder den Merge zwischen **deinen eigenen** Instanzen
gedacht — niemals zum Teilen mit Dritten.

Der Autor übernimmt keinerlei Haftung für Verluste, falsche Preise, gesperrte
Accounts oder sonstige Schäden, die durch die Nutzung dieser Software
entstehen. Nutzung auf eigene Verantwortung.
