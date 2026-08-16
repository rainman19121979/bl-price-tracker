// BrickLink Price Tracker -- BrickStore Extension
// Zieht Preise + Rabatte + Lock-Zustand aus dem Tracker und schreibt sie in
// das aktuell geoeffnete Dokument.
//
// Installation (Datei einmal editieren, dann in den Extensions-Ordner kopieren):
//   Linux:   ~/.local/share/BrickStore/extensions/
//   macOS:   ~/Library/Application Support/BrickStore/extensions/
//   Windows: %APPDATA%\BrickStore\extensions\
// Danach in BrickStore: Extras -> Reload user scripts
//
// Konfiguration: die zwei Werte unten (URL + TOKEN) EINMAL setzen.
// Token gibt es in der Tracker-UI unter Einstellungen -> API-Tokens.
//
// Was passiert bei einem Klick auf "Preise aus Tracker holen":
//   1) Alle Lots (oder nur die selektierten) werden ans Tracker-Batch-API geschickt
//   2) Tracker liefert pro Lot: suggestedPrice, saleRate, priceLocked, myPrice
//   3) Extension schreibt in BrickStore:
//        priceLocked=true  -> lot.price = myPrice (der im Tracker manuell gesetzte)
//        priceLocked=false -> lot.price = suggestedPrice (aus der Formel)
//        lot.sale = saleRate  (0-99%)
//   4) Zusammenfassung: "X von Y Preisen aktualisiert, Z uebersprungen"

import BrickStore 1.1
import BrickLink 1.1
import QtQuick
import QtQuick.Dialogs

Script {
    name: "BrickLink Price Tracker"
    author: "BL Price Tracker"
    version: "1.0"

    // ===== EINMAL ANPASSEN =====
    readonly property string trackerUrl: "http://YOUR_TRACKER_HOST:3000"
    readonly property string trackerToken: "PASTE_YOUR_TOKEN_HERE"
    // ===========================

    readonly property int batchSize: 100  // Tracker akzeptiert bis 100 pro Batch

    // Info-Dialog fuer Zusammenfassung + async-Fehler.
    // BrickStore's `throw new Error()` funktioniert nur bei synchronen
    // Fehlern im actionFunction-Kontext (Script.cpp:91 fangt exceptions und
    // reicht sie an UIHelpers::warning weiter). Async-Handler (xhr) laufen
    // ausserhalb des Try-Catch -- deshalb brauchen wir hier ein echtes
    // MessageDialog.
    //
    // ACHTUNG -- unverifiziert bei bestimmten BrickStore-Builds: bei einem
    // ersten Test triggerte der Dialog nicht (Progress-Overlay schliesst sich
    // stumm). Moegliche Ursachen: Qt6-vs-Qt5-Modulname-Unterschied fuer
    // QtQuick.Dialogs, oder MessageDialog-Properties heissen anders in Qt6.
    // Falls's bei dir auch nicht triggert: `console.log(msg)` in showInfo()
    // aktivieren -- dann ist der Text zumindest in Extras -> Developer
    // Console sichtbar.
    MessageDialog {
        id: infoDialog
        title: qsTr("BrickLink Price Tracker")
        buttons: MessageDialog.Ok
    }
    function showInfo(msg) {
        infoDialog.text = msg
        infoDialog.open()
        console.log("[BL Price Tracker] " + msg)  // Fallback wenn Dialog nicht triggert
    }

    ExtensionScriptAction {
        text: qsTr("Preise aus Price Tracker holen...")
        actionFunction: () => syncPrices()
    }

    function isConfigured() {
        return trackerUrl.indexOf("YOUR_TRACKER_HOST") < 0
            && trackerToken.indexOf("PASTE_YOUR_TOKEN") < 0
            && trackerToken.length > 0
    }

    function conditionCode(lot) {
        return lot.condition === BrickLink.Condition.New ? "N" : "U"
    }

    function itemTypeCode(lot) {
        // BrickStore-ItemType-ID ist bereits ein Buchstabe (P/M/S/etc.),
        // aber der Tracker erwartet "PART"/"MINIFIG"/"SET"
        var id = lot.itemType.id
        if (id === "P") return "PART"
        if (id === "M") return "MINIFIG"
        if (id === "S") return "SET"
        return null  // Book/Gear/Instruction/etc. -- Tracker kennt nur diese drei
    }

    function completenessCode(lot) {
        // Nur bei SETs relevant. BrickStore Status: 0=Incl, 1=Excl -- interessiert
        // uns nicht. Fuer Completeness: 0=Complete, 1=Incomplete, 2=Sealed
        // (falls die Property so heisst; sonst NULL default 'C' im Tracker).
        if (itemTypeCode(lot) !== "SET") return null
        // lot.itemTypeId oder lot.completeness -- Property ist in QML nicht in
        // allen BrickStore-Versionen verfuegbar. Wir defaulten auf Complete.
        return "C"
    }

    function makeKey(partNo, colorId, condition, completeness) {
        return partNo + "|" + colorId + "|" + condition + "|" + (completeness || "")
    }

    function syncPrices() {
        if (!isConfigured()) {
            throw new Error(qsTr(
                "Extension nicht konfiguriert.\n\n" +
                "Bitte in der Datei bricklink-price-tracker.bs.qml die\n" +
                "Werte 'trackerUrl' und 'trackerToken' setzen und die\n" +
                "Extension neu laden (Extras -> Reload user scripts)."
            ))
        }

        var doc = BrickStore.activeDocument
        if (!doc) {
            throw new Error(qsTr("Kein Dokument geoeffnet."))
        }
        if (doc.lotCount === 0) {
            throw new Error(qsTr("Keine Lots im Dokument."))
        }

        // Selection-Support:
        // - doc.selectedLots liefert schreibgeschuetzte Kopien ("Cannot modify
        //   a const Lot") -- read-only Properties gehen aber
        // - Wir sammeln aus selectedLots die BL-InventoryIDs (oder Fallback-
        //   Hash) und iterieren dann doc.lots.at(i) fuer schreibbare Refs.
        // - Keine Selektion vorhanden -> alle Lots im Dokument.
        var selectedKeys = null  // null = alle Lots
        if (doc.selectedLots && doc.selectedLots.length > 0) {
            selectedKeys = {}
            for (var s = 0; s < doc.selectedLots.length; s++) {
                var sl = doc.selectedLots[s]
                if (!sl.item || sl.item.isNull) continue
                // Key: bevorzugt lotId, sonst partNo|colorId|condition
                var key = sl.lotId > 0
                    ? "id:" + sl.lotId
                    : "pcc:" + sl.item.id + "|" + sl.color.id + "|" + conditionCode(sl)
                selectedKeys[key] = true
            }
        }

        // Nur unterstuetzte Item-Types + gueltige Refs
        // Wir speichern INDEX statt Lot-Referenz -- beim Schreiben holen wir
        // die schreibbare Instanz nochmal per doc.lots.at(index).
        var eligible = []
        var skipped = { badType: 0, noItem: 0, notSelected: 0 }
        for (var j = 0; j < doc.lotCount; j++) {
            var l = doc.lots.at(j)
            if (!l.item || l.item.isNull) { skipped.noItem++; continue }
            var it = itemTypeCode(l)
            if (!it) { skipped.badType++; continue }

            // Selection-Filter
            if (selectedKeys !== null) {
                var lkey = l.lotId > 0
                    ? "id:" + l.lotId
                    : "pcc:" + l.item.id + "|" + l.color.id + "|" + conditionCode(l)
                if (!selectedKeys[lkey]) { skipped.notSelected++; continue }
            }

            eligible.push({
                index: j,
                request: {
                    partNo: l.item.id,
                    colorId: l.color.id,
                    itemType: it,
                    condition: conditionCode(l),
                    completeness: completenessCode(l),
                    blInventoryId: l.lotId > 0 ? l.lotId : null
                }
            })
        }

        if (eligible.length === 0) {
            throw new Error(qsTr(
                "Keine passenden Lots gefunden.\n" +
                "Nur PART / MINIFIG / SET mit gueltiger Item-Referenz koennen abgefragt werden."
            ))
        }

        // Progress-Overlay -- kann vom User abgebrochen werden
        var aborted = false
        doc.startBlockingOperation(
            qsTr("Preise werden aus Tracker geholt..."),
            function() { aborted = true }
        )

        var stats = { updated: 0, priceLockedUsed: 0, skippedNoPrice: 0, errors: 0 }
        var errorSamples = []
        var totalBatches = Math.ceil(eligible.length / batchSize)

        function runBatch(batchIdx) {
            if (aborted) {
                doc.endBlockingOperation()
                return
            }
            doc.blockingOperationTitle = qsTr("Batch %1 / %2...").arg(batchIdx + 1).arg(totalBatches)

            var start = batchIdx * batchSize
            var end = Math.min(start + batchSize, eligible.length)
            var batch = eligible.slice(start, end)
            var items = batch.map(function(e) { return e.request })

            var xhr = new XMLHttpRequest()
            xhr.open("POST", trackerUrl + "/api/external/price/batch")
            xhr.setRequestHeader("Content-Type", "application/json")
            xhr.setRequestHeader("Authorization", "Bearer " + trackerToken)
            xhr.onreadystatechange = function() {
                if (xhr.readyState !== XMLHttpRequest.DONE) return
                if (xhr.status !== 200) {
                    doc.endBlockingOperation()
                    showInfo(qsTr(
                        "Tracker-API antwortete mit HTTP %1:\n%2"
                    ).arg(xhr.status).arg(xhr.responseText.slice(0, 300)))
                    return
                }

                try {
                    var resp = JSON.parse(xhr.responseText)
                } catch (e) {
                    doc.endBlockingOperation()
                    showInfo(qsTr("Antwort ist kein gueltiges JSON"))
                    return
                }

                // Response: {count, items: [...], apiUsage: {...}}
                // Response-Items in Map fuer Key-Lookup
                var byKey = {}
                for (var k = 0; k < resp.items.length; k++) {
                    var r = resp.items[k]
                    if (r.error) {
                        stats.errors++
                        if (errorSamples.length < 5) {
                            errorSamples.push(r.partNo + "/" + r.colorId + ": " + r.error)
                        }
                        continue
                    }
                    byKey[makeKey(r.partNo, r.colorId, r.condition, r.completeness)] = r
                }

                // Fuer jeden Lot im Batch: Preis + Sale schreiben
                // WICHTIG: schreibbare Lot-Referenz per doc.lots.at(index)
                // holen -- die im Batch gespeicherte war nur ein Index.
                for (var b = 0; b < batch.length; b++) {
                    var entry = batch[b]
                    var reqKey = makeKey(
                        entry.request.partNo, entry.request.colorId,
                        entry.request.condition, entry.request.completeness
                    )
                    var priceInfo = byKey[reqKey]
                    if (!priceInfo) continue  // Fehler-Fall, schon in stats

                    // Preis-Wahl: locked -> myPrice, sonst suggestedPrice
                    // WICHTIG: nur Preise > 0 uebernehmen! Sonst wird bei
                    // Locked-Lots ohne myPrice oder bei Marktdaten-losen
                    // Parts der Preis auf 0.000 gesetzt und der User
                    // veroeffentlicht versehentlich Gratis-Angebote.
                    var priceToWrite = null
                    if (priceInfo.priceLocked === true
                            && priceInfo.myPrice !== null
                            && priceInfo.myPrice > 0) {
                        priceToWrite = priceInfo.myPrice
                        stats.priceLockedUsed++
                    } else if (priceInfo.suggestedPrice !== null
                            && priceInfo.suggestedPrice > 0) {
                        priceToWrite = priceInfo.suggestedPrice
                    } else {
                        stats.skippedNoPrice++
                        continue
                    }

                    // Belt-and-Suspenders -- niemals 0 oder negativ schreiben
                    if (!(priceToWrite > 0)) {
                        stats.skippedNoPrice++
                        continue
                    }

                    var lot = doc.lots.at(entry.index)  // schreibbare Referenz
                    lot.price = priceToWrite
                    if (priceInfo.saleRate !== null && priceInfo.saleRate !== undefined) {
                        lot.sale = priceInfo.saleRate
                    }
                    stats.updated++
                }

                // Naechster Batch oder Ende
                if (batchIdx + 1 < totalBatches) {
                    Qt.callLater(function() { runBatch(batchIdx + 1) })
                } else {
                    doc.endBlockingOperation()
                    showSummary(stats, skipped, errorSamples, resp.apiUsage)
                }
            }
            xhr.onerror = function() {
                doc.endBlockingOperation()
                showInfo(qsTr("Netzwerk-Fehler beim Kontakt mit dem Tracker."))
            }
            xhr.send(JSON.stringify({ items: items }))
        }

        runBatch(0)
    }

    function showSummary(stats, skipped, errorSamples, apiUsage) {
        var msg = qsTr("Preis-Update fertig.\n\n")
        msg += qsTr("Aktualisiert: %1 Lots").arg(stats.updated) + "\n"
        if (stats.priceLockedUsed > 0) {
            msg += qsTr("  davon %1 mit gesperrtem Preis (myPrice aus Tracker)").arg(stats.priceLockedUsed) + "\n"
        }
        if (stats.skippedNoPrice > 0) {
            msg += qsTr("Uebersprungen (kein Preis im Tracker): %1").arg(stats.skippedNoPrice) + "\n"
        }
        if (stats.errors > 0) {
            msg += qsTr("Fehler (kein Preis vom Tracker): %1").arg(stats.errors) + "\n"
            if (errorSamples.length > 0) {
                msg += qsTr("Beispiele:\n  ") + errorSamples.join("\n  ") + "\n"
            }
        }
        if (skipped.badType > 0) {
            msg += qsTr("Uebersprungen (Item-Typ nicht unterstuetzt): %1").arg(skipped.badType) + "\n"
        }
        if (skipped.noItem > 0) {
            msg += qsTr("Uebersprungen (kein Item): %1").arg(skipped.noItem) + "\n"
        }
        if (skipped.notSelected > 0) {
            msg += qsTr("Uebersprungen (nicht selektiert): %1").arg(skipped.notSelected) + "\n"
        }
        if (apiUsage) {
            msg += qsTr("\nBrickLink-API-Budget: %1/%2 (Rest %3)")
                .arg(apiUsage.used).arg(apiUsage.limit).arg(apiUsage.remaining)
        }
        showInfo(msg)  // async-safe -- MessageDialog wird sichtbar
    }
}
