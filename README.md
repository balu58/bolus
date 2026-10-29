# Bolusrechner

Bolusrechner für schnell wirksames Insulin als Web-App für das iPhone. Läuft nach dem ersten Öffnen offline vom Home-Bildschirm.

> **Hinweis:** Eigenes Hilfsmittel für den privaten Gebrauch, **kein zugelassenes Medizinprodukt**.
> Alle Vorschläge vor der Anwendung prüfen und mit der eigenen Therapie bzw. dem Diabetes-Team abgleichen.

## Screenshots

| Rechner | Essen | Verlauf | Einstellungen |
|:---:|:---:|:---:|:---:|
| <img src="screenshots/1-rechner.png" width="200" alt="Rechner mit Bolusvorschlag"> | <img src="screenshots/2-essen.png" width="200" alt="Mahlzeit zusammenstellen"> | <img src="screenshots/3-verlauf.png" width="200" alt="Injektionen der letzten 3 Tage"> | <img src="screenshots/4-einstellungen.png" width="200" alt="Insulin/Kohlenhydrat-Verhältnisse und Einstellungen"> |

*Beispieldaten: 7,5 IE um 11:02, Abfrage um 12:40, BZ 172, KE als Formel `4,2*0,88`.*

## Funktionen

- **Bolusvorschlag** aus BZ, KE und Profil (BZ-Ziel, Korrekturfaktor, KE-Faktor)
  - aktives Insulin (IOB) wird nur vom Korrekturanteil abgezogen (wie bei gängigen Bolusrechnern)
  - zusätzlich: Vorschlag mit Auf-/Abschlag in % und Vorschlag minus gesamtes IOB
  - „Übernehmen“ rundet auf die kleinste Pen-Einheit (0,1 / 0,5 / 1 IE)
- **Aktives Insulin** mit Verlaufskurve (−2 bis +2 Std.)
  - benutzerdefinierte Wirkkurve: gemessene Werte, linear interpoliert, nach 240 Min. = 0
  - Formel nach Juggluco für Fiasp
  - Standardmodell (wie Loop/OpenAPS) mit Vorlagen für Rapid- und Ultra-rapid-Insuline,
    Wirkmaximum und Wirkdauer einstellbar – für einen Insulinwechsel ohne eigene Messreihe
  - Umschalter „Eigene | Fiasp | Standard“, Vergleichstabelle aller drei Modelle in den Einstellungen
- **Insulin/Kohlenhydrat-Verhältnisse** je Tageszeit frei benennbar, hinzufügen/entfernen, automatische Auswahl nach Uhrzeit
- **KE-Eingabe mit Formeln**, z. B. `4,2*0,88`
- **Lebensmittelliste**, Mahlzeiten-Korb und Rezeptrechner (KE pro Stück)
- **Synchronisation** zwischen Geräten über ein privates GitHub-Repository (Tab **Zugang** – Zugangsdaten sind getrennt von den gesicherten Daten)
- **Sicherung** aller Daten als JSON-Datei (z. B. nach OneDrive), Wiederherstellen per Datei

## Synchronisation zwischen Geräten (GitHub)

Die App kann ihre Daten automatisch über ein **zweites, privates** Repository abgleichen
(z. B. Smartphone ↔ Zweitgerät ↔ PC). Jedes Gerät behält eine lokale Kopie und funktioniert offline;
Änderungen werden hochgeladen, sobald wieder Internet da ist.

### Einmalig einrichten

1. **Privates Daten-Repository anlegen:** GitHub → „+“ → *New repository*, Name z. B. `bolus-daten`,
   Sichtbarkeit **Private**, Haken bei *Add a README file*.
2. **Token erstellen** – siehe [Token generieren](#token-generieren) weiter unten.
3. **In der App:** Tab **Zugang** (Schlüssel-Symbol) → *Synchronisation (GitHub)* → Repository `benutzername/bolus-daten`
   und Token eintragen → **Verbinden**. Auf jedem Gerät wiederholen (gleicher oder eigener Token).

### Token generieren

Der Token ist der Zugangsschlüssel der App zum Daten-Repository. Er darf **nur dieses eine
Repository** lesen und schreiben.

1. Auf GitHub oben rechts auf das **Profilbild** → **Settings**.
2. Links ganz unten **Developer settings** → **Personal access tokens** → **Fine-grained tokens**.
3. **Generate new token** (ggf. Passwort bzw. Zwei-Faktor-Code bestätigen).
4. Angaben ausfüllen:
   - **Token name:** z. B. `Bolusrechner`
   - **Description** (optional): z. B. `Sync Smartphone, Zweitgerät, PC`
   - **Resource owner:** dein eigenes Konto
   - **Expiration:** z. B. **366 days** (siehe [Ablaufdatum](#ablaufdatum-und-erneuerung))
5. **Repository access:** **Only select repositories** wählen und im Auswahlfeld
   **nur** `bolus-daten` auswählen.
6. **Permissions** (Berechtigungen):
   1. Unter *Repository permissions* auf **Add permissions** klicken.
   2. In der Liste den Haken bei **Contents** setzen (oder „Contents“ ins Suchfeld tippen)
      und die Liste mit einem Klick daneben schließen.
   3. In der neuen Zeile **Contents** rechts das Auswahlfeld von *Read-only* auf
      **Read and write** umstellen.
   4. Die Zeile **Metadata: Read-only** erscheint automatisch und bleibt so.
   5. Keine weiteren Berechtigungen hinzufügen.
7. Unten **Generate token** → kontrollieren, dass in der Übersicht *Contents: Read and write*
   und *Metadata: Read-only* für `bolus-daten` stehen → **Generate token** bestätigen.
8. Den angezeigten Token (`github_pat_…`) **sofort kopieren** – er wird nur dieses eine Mal angezeigt.
   Am besten direkt in die App eintragen; zum Aufbewahren nur in einem Passwort-Manager,
   **nicht** in Notizen, Mails oder im Repository.

> Ein Token kann auf mehreren Geräten verwendet werden. Wer es übersichtlicher mag,
> erstellt pro Gerät einen eigenen Token (z. B. `Bolusrechner Smartphone`, `… PC`) –
> dann lässt sich bei Verlust gezielt nur einer löschen.

### Ablaufdatum und Erneuerung

- Ein Ablaufdatum begrenzt den Schaden, falls ein Token unbemerkt in falsche Hände gerät.
  1 Jahr ist ein guter Kompromiss zwischen Sicherheit und Aufwand.
- GitHub schickt einige Tage vor Ablauf eine **Erinnerungs-E-Mail**.
- Nach Ablauf läuft die App normal weiter, nur der Abgleich stoppt
  (Tab Zugang: „Token ungültig oder abgelaufen“, oben: „Sync-Fehler“). Es gehen keine Daten verloren.
- Erneuern: neuen Token wie oben erstellen (oder beim alten Token **Regenerate token**),
  auf jedem Gerät in der App eintragen → **Verbinden**.

### Token sperren (z. B. bei Verlust eines Geräts)

Profilbild → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
Token auswählen → **Delete**. Danach auf den übrigen Geräten ggf. einen neuen Token eintragen.

### So wird abgeglichen

- Beim Start, beim Zurückkehren in die App, nach jeder Änderung und alle 2 Minuten.
- **Injektionen** werden zusammengeführt; gelöschte Einträge werden auf allen Geräten gelöscht.
- **Einstellungen** und **Lebensmittel**: die zuletzt geänderte Fassung gewinnt.
- Die Daten liegen als `bolus-daten.json` im Daten-Repository; jede Änderung ist ein Commit
  (dadurch gibt es dort auch eine Versionsgeschichte).
- Der Token bleibt nur auf dem Gerät und ist **nicht** in der JSON-Sicherung enthalten.
- Bei Verlust eines Geräts: Token unter *Fine-grained tokens* löschen.

> Das App-Repository bleibt öffentlich, das Daten-Repository muss **privat** sein.
> Die App warnt, wenn das Daten-Repository öffentlich ist.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | die komplette App (HTML, CSS, JavaScript) |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `manifest.webmanifest` | Name und Symbol für den Home-Bildschirm |
| `icon-*.png` | App-Symbole |
| `screenshots/` | Bilder für diese README (werden von der App nicht benötigt) |

## Veröffentlichen mit GitHub Pages

1. Repository auf GitHub anlegen (öffentlich) und alle Dateien hochladen.
2. **Settings → Pages → Source:** „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
3. Nach 1–2 Minuten erreichbar unter `https://<benutzername>.github.io/<repository>/`.
4. Auf dem iPhone in Firefox oder Safari öffnen → Teilen → **Zum Home-Bildschirm**.
5. Einmal vom Home-Bildschirm starten, danach funktioniert die App auch im Flugmodus.

## Neue Version veröffentlichen

1. Änderungen an `index.html` vornehmen.
2. In `index.html` die Versionsnummer anpassen: `var APP_VERSION = "11";`
   - **neue Funktionen:** nächste ganze Zahl, z. B. `"11"` → `"12"`
   - **Fehlerkorrekturen:** Unterversion, z. B. `"11"` → `"11.1"` → `"11.2"`
   Die Nummer wird oben in der App angezeigt und sorgt dafür, dass das iPhone die neue Fassung lädt
   (`sw.js` muss dafür nicht geändert werden).
3. Commit und Push. GitHub Pages aktualisiert die Seite automatisch.

## Lokal testen

Am einfachsten mit einem lokalen Webserver, da beim Öffnen per Doppelklick (`file://`)
Manifest und Service Worker nicht funktionieren:

- VS Code: Erweiterung **Live Server** → Rechtsklick auf `index.html` → „Open with Live Server“
- oder: `python -m http.server` im Projektordner, dann `http://localhost:8000`

iPhone-Größen in den Browser-Entwicklertools (F12 → Strg+Umschalt+M):
iPhone 17 = 402 × 874, iPhone XR = 414 × 896.

## Datenschutz

Alle Daten (Einstellungen, Injektionen, Lebensmittel) liegen im Browser des Geräts.
Nur wenn die Synchronisation eingerichtet ist, werden sie zusätzlich in **dein privates
Daten-Repository** auf GitHub geschrieben – sonst sendet die App nichts an einen Server. Sicherungsdateien (`bolusrechner-*.json`) gehören
**nicht** ins Repository und sind deshalb in `.gitignore` ausgeschlossen.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
