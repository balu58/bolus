# Dexcom G7 Live Monitor (Test-Setup)

Dieses Projekt ermöglicht es dir, deine Dexcom G7 Blutzuckerwerte (BZ) ohne die 3-stündige Verzögerung der offiziellen API in Echtzeit (alle 5 Minuten) auf einer lokalen Webseite darzustellen.

## Inhalt der ZIP-Datei
- `anzeige.html`: Das Frontend für deinen Browser (aufrufen über `/anzeige.html`). Zeigt den aktuellen Wert, Trendpfeil und die Uhrzeit der Messung.
- `server.js`: Das Node.js-Backend, welches die Live-Daten über die Dexcom-Share Schnittstelle abruft.
- `.env.example`: Vorlage für deine geheimen Dexcom-Zugangsdaten.
- `.gitignore`: Schützt deine Passwörter vor dem versehentlichen Hochladen auf GitHub.
- `package.json`: Definiert die benötigten Node.js-Pakete.

## Schnellanleitung zur Inbetriebnahme

1. **Voraussetzung:** Stelle sicher, dass [Node.js](https://nodejs.org/) auf deinem Computer installiert ist.
2. **Dexcom Share aktivieren:** Öffne die Dexcom G7 App auf deinem Smartphone -> *Verbindungen* -> *Share* aktivieren (mindestens einen Test-Empfänger einrichten).
3. **Zugangsdaten hinterlegen:** Benenne die Datei `.env.example` um in genau `.env` und trage dort deinen Dexcom-Benutzernamen sowie dein Passwort ein.
4. **Abhängigkeiten installieren:** Öffne ein Terminal/Eingabeaufforderung in diesem Ordner und führe folgenden Befehl aus:
   ```bash
   npm install
   ```
5. **Backend-Server starten:** Starte das Node.js-Backend mit:
   ```bash
   npm start
   ```
6. **Webseite öffnen:** Im Browser `http://localhost:3000/anzeige.html` aufrufen.

## Endpunkte

| Adresse | Inhalt | Schlüssel nötig* |
|---|---|---|
| `/` und `/api/live-glucose` | aktueller Wert als JSON | ja |
| `/anzeige.html` | Anzeigeseite (enthält selbst keine Daten) | nein |
| `/health` | `{"ok":true}` – Lebenszeichen ohne Dexcom-Abruf | nein |

\* nur wenn `API_KEY` gesetzt ist.

Antwortformat (unverändert):
```json
{ "success": true, "value": 112, "trend": "fortyfiveup", "time": 1792999887923 }
```
Fehler: `{ "success": false, "error": "…" }` mit Status 401, 404 oder 500.

## Umgebungsvariablen (render.com → Environment)

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `DEXCOM_USER`, `DEXCOM_PASSWORD` | ja | Dexcom-Share-Zugang |
| `API_KEY` | nein | wenn gesetzt, muss jeder Datenabruf den Schlüssel mitschicken |
| `CACHE_SECONDS` | nein | Zwischenspeicher in Sekunden (Standard 60) |

## API-Schlüssel

Ist `API_KEY` gesetzt, wird der Schlüssel erwartet als
- Header **`X-Api-Key: <schlüssel>`** (empfohlen), oder
- Parameter **`?key=<schlüssel>`** (Notlösung, landet leichter in Logs).

Ohne `API_KEY` ist der Dienst offen wie bisher. Umstellung ohne Unterbrechung:
1. Neuen Code deployen (noch ohne `API_KEY`) – alles läuft wie bisher.
2. Alle Clients mit Schlüssel versorgen (siehe unten).
3. `API_KEY` bei render.com setzen.

**Clients:**
- **Bolusrechner-App:** Tab *Zugang* → *API-Schlüssel*.
- **anzeige.html:** einmalig `https://…/anzeige.html?key=<schlüssel>` aufrufen; der Schlüssel wird im Browser gemerkt und aus der Adresszeile entfernt.
- **WinForms (C#):** `client.DefaultRequestHeaders.Add("X-Api-Key", key);`

Schlüssel erzeugen (PowerShell, kryptografisch sicher, nur 0–9/a–f – dadurch auch in `?key=` unproblematisch):
```powershell
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

## Zwischenspeicher

Mehrere Clients (App, Anzeige, WinForms) lösen innerhalb von `CACHE_SECONDS` nur **einen**
Abruf bei Dexcom aus. Gleichzeitige Anfragen teilen sich denselben Abruf.
