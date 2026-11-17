/**
 * Eigenständiges Modul: Kohlenhydrat-Foto-Scanner
 * Kann per <script src="carbs-scanner.js"></script> in jede HTML-Seite eingebunden werden.
 * Liest API-Keys aus dem localStorage (oder optional über einen Backend-Proxy).
 */
(function () {
  const SYSTEM_PROMPT = `Du bist ein erfahrener Ernährungs-Assistent für Kohlenhydratschätzung. Analysiere das Foto der Mahlzeit, identifiziere alle sichtbaren Komponenten einzeln und schätze realistisch:
1. Das verzehrfertige Gewicht auf dem Teller in Gramm ("gewicht_gramm").
2. Falls es sich um gegarte/gequollene Beilagen handelt (z. B. gekochte Nudeln, Reis, Kartoffeln, Haferflocken, Hülsenfrüchte), zusätzlich das entsprechende ungefähre Trocken- bzw. Rohgewicht in Gramm ("trockengewicht_gramm", bei Zutaten ohne Trockengewicht 0 angeben).
3. Die enthaltenen Kohlenhydrate in Gramm ("kohlenhydrate_gramm").

WICHTIGE REGELN FÜR DIE NÄHRWERTBERECHNUNG:
- Rechne die Kohlenhydrate IMMER passend zum verzehrfertigen Gewicht (Nudeln/Reis/Kartoffeln gekocht ca. 15–26 g KH/100 g; Brot/Panade ca. 45–55 g KH/100 g; Kuchen/Gebäck ca. 35–45 g KH/100 g, achte auf kleine Kuchenteller als Größenmaßstab).
- Zerlege zusammengesetzte Gerichte wie Pizza oder Flammkuchen IMMER in Boden und Belag (NIEMALS pauschal 30 g KH auf das Gesamtgewicht der ganzen Pizza rechnen! Eine normale 28–30 cm Pizza hat ca. 200–240 g gebackenen Teigboden = ca. 85–100 g KH; Käse/Schinken/Gemüse haben 0–4 g KH/100 g).
- Achte auf versteckte Kohlenhydrate in gebundenen Soßen, Dressings oder Balsamico-Creme.
- Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt (ohne Markdown-Codeblöcke) in exakt dieser Struktur:
{
  "zutaten": [
    { "name": "Name der Zutat", "gewicht_gramm": 200, "trockengewicht_gramm": 80, "kohlenhydrate_gramm": 50 }
  ],
  "gesamt_kohlenhydrate_gramm": 50,
  "hinweis": "Kurzer Hinweis zur Schätzgenauigkeit"
}`;

  const DEFAULT_CONFIG = {
    triggerSelector: "#openCarbsScannerBtn",
    targetInputSelector: "#mainCarbsInput",
    groqKeyStorageName: "carbs_groq_api_key",
    geminiKeyStorageName: "carbs_gemini_api_key",
    backendProxyUrl: "", // Leer = Direkter Aufruf aus dem Browser (ideal für GitHub Pages / Static Hosting)
    onApply: null
  };

  let config = { ...DEFAULT_CONFIG };
  let isInitialized = false;
  let liveTimerInterval = null;
  let currentTotalCarbs = 0;

  function injectStyles() {
    if (document.getElementById("carbs-scanner-styles")) return;
    const style = document.createElement("style");
    style.id = "carbs-scanner-styles";
    style.textContent = `
      dialog#carbsScannerDialog {
        border: none;
        border-radius: 16px;
        padding: 20px;
        max-width: 600px;
        width: 95%;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
        text-align: left;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #1f2937;
      }
      dialog#carbsScannerDialog::backdrop {
        background: rgba(17, 24, 39, 0.65);
      }
      .cs-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .cs-header h2 {
        margin: 0;
        font-size: 1.18rem;
      }
      .cs-close-x {
        background: none;
        border: none;
        font-size: 1.6rem;
        line-height: 1;
        cursor: pointer;
        color: #6b7280;
        padding: 0 4px;
      }
      .cs-mode-switch {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }
      .cs-mode-option {
        border: 2px solid #e2e8f0;
        border-radius: 10px;
        padding: 9px 10px;
        cursor: pointer;
        background: #f8fafc;
        transition: all 0.15s;
      }
      .cs-mode-option.active {
        border-color: #2563eb;
        background: #eff6ff;
      }
      .cs-mode-option input {
        display: none;
      }
      .cs-mode-title {
        font-weight: 700;
        font-size: 0.88rem;
        color: #1e293b;
        display: block;
      }
      .cs-mode-desc {
        font-size: 0.75rem;
        color: #64748b;
        display: block;
        margin-top: 2px;
      }
      .cs-upload-box {
        border: 2px dashed #cbd5e1;
        border-radius: 12px;
        padding: 14px;
        text-align: center;
        background-color: #f8fafc;
        margin-bottom: 12px;
      }
      .cs-capture-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
        flex-wrap: wrap;
      }
      .cs-btn-cam {
        background-color: #0f172a;
        color: #ffffff;
        border: none;
        padding: 10px 16px;
        font-size: 0.9rem;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .cs-btn-cam:hover {
        background-color: #1e293b;
      }
      .cs-btn-gallery {
        background-color: #e2e8f0;
        color: #1e293b;
        border: none;
        padding: 10px 16px;
        font-size: 0.9rem;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
      }
      .cs-btn-gallery:hover {
        background-color: #cbd5e1;
      }
      #csPreviewImg {
        max-width: 100%;
        max-height: 180px;
        border-radius: 8px;
        margin-top: 12px;
        display: none;
        object-fit: contain;
      }
      .cs-status {
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        background-color: #eff6ff;
        border: 1px solid #bfdbfe;
        font-size: 0.88rem;
        color: #1d4ed8;
        font-weight: 500;
        display: none;
      }
      .cs-error {
        margin-top: 10px;
        padding: 11px 12px;
        border-radius: 8px;
        background-color: #fee2e2;
        color: #991b1b;
        font-size: 0.86rem;
        display: none;
        line-height: 1.4;
      }
      .cs-result-card {
        margin-top: 14px;
        padding: 14px;
        border-radius: 10px;
        background-color: #f0fdf4;
        border: 1px solid #bbf7d0;
        display: none;
      }
      .cs-total-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        flex-wrap: wrap;
        gap: 6px;
      }
      .cs-total-carbs {
        font-size: 1.25rem;
        font-weight: 700;
        color: #166534;
      }
      .cs-edit-hint {
        font-size: 0.76rem;
        color: #15803d;
      }
      .cs-table-wrap {
        overflow-x: auto;
      }
      .cs-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.86rem;
        margin-bottom: 8px;
      }
      .cs-table th, .cs-table td {
        text-align: left;
        padding: 6px 4px;
        border-bottom: 1px solid #dcfce7;
        vertical-align: middle;
      }
      .cs-table th {
        color: #15803d;
        font-weight: 600;
        font-size: 0.78rem;
        white-space: nowrap;
      }
      .cs-table td input[type="text"] {
        width: 100%;
        min-width: 110px;
        padding: 5px 6px;
        border: 1px solid #86efac;
        border-radius: 6px;
        font-size: 0.84rem;
        background: #ffffff;
      }
      .cs-weight-cell {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 5px;
        white-space: nowrap;
      }
      .cs-table td input[type="number"] {
        width: 62px;
        padding: 5px 5px;
        border: 1px solid #86efac;
        border-radius: 6px;
        font-size: 0.84rem;
        text-align: right;
        background: #ffffff;
      }
      .cs-dry-badge {
        font-size: 0.75rem;
        color: #166534;
        background: #dcfce7;
        padding: 2px 5px;
        border-radius: 4px;
        font-weight: 500;
      }
      .cs-del-btn {
        background: none;
        border: none;
        color: #dc2626;
        font-weight: 700;
        cursor: pointer;
        font-size: 1.05rem;
        padding: 2px 6px;
      }
      .cs-btn-add {
        background: #dcfce7;
        border: 1px solid #86efac;
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 0.8rem;
        cursor: pointer;
        color: #166534;
        font-weight: 600;
      }
      .cs-note {
        font-size: 0.8rem;
        color: #374151;
        margin-top: 8px;
      }
      .cs-timing {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed #86efac;
        font-size: 0.75rem;
        color: #166534;
        line-height: 1.4;
      }
      .cs-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 14px;
        flex-wrap: wrap;
      }
      .cs-btn-primary {
        background-color: #2563eb;
        color: #ffffff;
        border: none;
        padding: 10px 16px;
        font-size: 0.92rem;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
      }
      .cs-btn-primary:disabled {
        background-color: #93c5fd;
        cursor: not-allowed;
      }
      .cs-btn-success {
        background-color: #16a34a;
        color: #ffffff;
        border: none;
        padding: 10px 16px;
        font-size: 0.92rem;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
      }
      .cs-btn-secondary {
        background-color: #e5e7eb;
        color: #374151;
        border: none;
        padding: 10px 14px;
        font-size: 0.9rem;
        font-weight: 500;
        border-radius: 8px;
        cursor: pointer;
      }
      .cs-disclaimer {
        margin-top: 12px;
        font-size: 0.72rem;
        color: #6b7280;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }

  function injectDialogHtml() {
    if (document.getElementById("carbsScannerDialog")) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <dialog id="carbsScannerDialog">
        <div class="cs-header">
          <h2>Mahlzeit per Foto erfassen</h2>
          <button type="button" id="csCloseXBtn" class="cs-close-x" aria-label="Schließen">&times;</button>
        </div>

        <div class="cs-mode-switch">
          <label class="cs-mode-option active" id="csModeFastLabel">
            <input type="radio" name="csScanMode" value="fast" checked />
            <span class="cs-mode-title">Blitz-Scan (~1,5 s)</span>
            <span class="cs-mode-desc">Groq Qwen 3.8 + Gemini-Fallback</span>
          </label>
          <label class="cs-mode-option" id="csModeDetailLabel">
            <input type="radio" name="csScanMode" value="detail" />
            <span class="cs-mode-title">Detail-Scan (~8–10 s)</span>
            <span class="cs-mode-desc">Gemini 3 Flash (Soßen &amp; Extras)</span>
          </label>
        </div>

        <div class="cs-upload-box">
          <!-- Zwei versteckte Inputs für optimale iOS Web-App / Safari Unterstützung -->
          <input type="file" id="csCameraInput" accept="image/*" capture="environment" style="display:none;" />
          <input type="file" id="csGalleryInput" accept="image/*" style="display:none;" />

          <div class="cs-capture-buttons">
            <button type="button" id="csTakePhotoBtn" class="cs-btn-cam">Foto aufnehmen</button>
            <button type="button" id="csChooseFileBtn" class="cs-btn-gallery">Aus Mediathek / Datei</button>
          </div>
          <img id="csPreviewImg" alt="Vorschau der Mahlzeit" />
        </div>

        <div id="csStatusBox" class="cs-status">Analysiere... (0.0 s)</div>
        <div id="csErrorBox" class="cs-error"></div>

        <div id="csResultCard" class="cs-result-card">
          <div class="cs-total-header">
            <div id="csTotalCarbsText" class="cs-total-carbs">Gesamt: 0 g KH</div>
            <span class="cs-edit-hint">Werte direkt bearbeitbar</span>
          </div>

          <div class="cs-table-wrap">
            <table class="cs-table">
              <thead>
                <tr>
                  <th>Zutat</th>
                  <th style="text-align:right;">Menge (Trocken)</th>
                  <th style="text-align:right;">KH (g)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="csIngredientsBody"></tbody>
            </table>
          </div>

          <button type="button" id="csAddRowBtn" class="cs-btn-add">+ Zutat hinzufügen</button>
          <div id="csNoteText" class="cs-note"></div>
          <div id="csTimingText" class="cs-timing"></div>
        </div>

        <div class="cs-actions">
          <button type="button" id="csCloseBtn" class="cs-btn-secondary">Abbrechen</button>
          <button type="button" id="csAnalyzeBtn" class="cs-btn-primary">Analysieren</button>
          <button type="button" id="csApplyBtn" class="cs-btn-success" style="display:none;">Werte übernehmen</button>
        </div>

        <div class="cs-disclaimer">
          This is for informational purposes only. For medical advice or diagnosis, consult a professional. AI responses may include mistakes.
        </div>
      </dialog>
    `;
    document.body.appendChild(wrapper.firstElementChild);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function extractJsonObject(rawText) {
    const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    return JSON.parse(cleaned);
  }

  async function callGeminiDirect(apiKey, model, imgData) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const payload = {
      contents: [
        {
          parts: [
            { text: SYSTEM_PROMPT },
            { inline_data: { mime_type: imgData.mimeType, data: imgData.base64 } }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Gemini HTTP-Fehler ${response.status}`);
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Keine Antwort von Gemini erhalten.");
    return extractJsonObject(text);
  }

  async function callGroqDirect(apiKey, model, imgData) {
    const cleanKey = apiKey.replace(/^Bearer\s+/i, "").trim();
    const payload = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: SYSTEM_PROMPT },
            { type: "image_url", image_url: { url: imgData.dataUrl } }
          ]
        }
      ],
      temperature: 0.2
    };

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cleanKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Groq HTTP-Fehler ${response.status}`);
    }
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Keine Antwort von Groq erhalten.");
    return extractJsonObject(text);
  }

  function resizeImageToBase64(file, maxDimension = 768) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          const base64 = dataUrl.split(",")[1];
          const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
          resolve({
            dataUrl,
            base64,
            mimeType: "image/jpeg",
            width,
            height,
            sizeKB
          });
        };
        img.onerror = reject;
        img.src = event.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function bindEvents() {
    const dialog = document.getElementById("carbsScannerDialog");
    const closeBtn = document.getElementById("csCloseBtn");
    const closeXBtn = document.getElementById("csCloseXBtn");
    const cameraInput = document.getElementById("csCameraInput");
    const galleryInput = document.getElementById("csGalleryInput");
    const takePhotoBtn = document.getElementById("csTakePhotoBtn");
    const chooseFileBtn = document.getElementById("csChooseFileBtn");
    const previewImg = document.getElementById("csPreviewImg");
    const analyzeBtn = document.getElementById("csAnalyzeBtn");
    const applyBtn = document.getElementById("csApplyBtn");
    const addRowBtn = document.getElementById("csAddRowBtn");
    const statusBox = document.getElementById("csStatusBox");
    const errorBox = document.getElementById("csErrorBox");
    const resultCard = document.getElementById("csResultCard");
    const totalCarbsText = document.getElementById("csTotalCarbsText");
    const ingredientsBody = document.getElementById("csIngredientsBody");
    const noteText = document.getElementById("csNoteText");
    const timingText = document.getElementById("csTimingText");

    let selectedFile = null;

    // Trigger-Button aus der Haupt-App verknüpfen
    document.querySelectorAll(config.triggerSelector).forEach((btn) => {
      btn.addEventListener("click", () => dialog.showModal());
    });

    const closeModal = () => {
      if (liveTimerInterval) {
        clearInterval(liveTimerInterval);
        liveTimerInterval = null;
      }
      dialog.close();
    };
    closeBtn.addEventListener("click", closeModal);
    closeXBtn.addEventListener("click", closeModal);

    // Modus-Umschalter
    document.querySelectorAll('input[name="csScanMode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        document.getElementById("csModeFastLabel").classList.toggle("active", radio.value === "fast" && radio.checked);
        document.getElementById("csModeDetailLabel").classList.toggle("active", radio.value === "detail" && radio.checked);
      });
    });

    // iOS Kamera vs. Mediathek
    takePhotoBtn.addEventListener("click", () => {
      cameraInput.value = "";
      cameraInput.click();
    });
    chooseFileBtn.addEventListener("click", () => {
      galleryInput.value = "";
      galleryInput.click();
    });

    const handleFileSelected = (file) => {
      errorBox.style.display = "none";
      resultCard.style.display = "none";
      applyBtn.style.display = "none";
      selectedFile = file || null;
      if (!selectedFile) {
        previewImg.style.display = "none";
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        previewImg.src = e.target.result;
        previewImg.style.display = "inline-block";
      };
      reader.readAsDataURL(selectedFile);
    };

    cameraInput.addEventListener("change", () => handleFileSelected(cameraInput.files[0]));
    galleryInput.addEventListener("change", () => handleFileSelected(galleryInput.files[0]));

    function recalculateTotal() {
      let sum = 0;
      ingredientsBody.querySelectorAll(".cs-carb-input").forEach((inp) => {
        const val = parseFloat(inp.value);
        if (!isNaN(val)) sum += val;
      });
      currentTotalCarbs = Math.round(sum);
      totalCarbsText.textContent = `Gesamt: ${currentTotalCarbs} g KH`;
    }

    function addIngredientRow(name = "", weight = 100, dryWeight = 0, carbs = 0) {
      const row = document.createElement("tr");
      const safeWeight = Math.max(1, Math.round(weight));
      const safeDry = Math.max(0, Math.round(dryWeight || 0));
      const safeCarbs = Math.round(carbs);

      let carbRatio = safeWeight > 0 ? safeCarbs / safeWeight : 0;
      let dryRatio = safeWeight > 0 && safeDry > 0 ? safeDry / safeWeight : 0;

      const dryHtml = safeDry > 0
        ? `<span class="cs-dry-badge" title="Geschätztes Trocken-/Rohgewicht">(tr: ${safeDry}g)</span>`
        : "";

      row.innerHTML = `
        <td><input type="text" class="cs-name-input" value="${escapeHtml(name)}" placeholder="Zutat" /></td>
        <td>
          <div class="cs-weight-cell">
            <input type="number" class="cs-weight-input" value="${safeWeight}" min="0" step="5" />
            ${dryHtml}
          </div>
        </td>
        <td style="text-align:right;"><input type="number" class="cs-carb-input" value="${safeCarbs}" min="0" step="1" /></td>
        <td style="text-align:center;"><button type="button" class="cs-del-btn" title="Entfernen">&times;</button></td>
      `;

      const weightInput = row.querySelector(".cs-weight-input");
      const carbInput = row.querySelector(".cs-carb-input");
      const dryBadge = row.querySelector(".cs-dry-badge");
      const delBtn = row.querySelector(".cs-del-btn");

      weightInput.addEventListener("input", () => {
        const newWeight = parseFloat(weightInput.value) || 0;
        carbInput.value = Math.round(newWeight * carbRatio);
        if (dryBadge && dryRatio > 0) {
          dryBadge.textContent = `(tr: ${Math.round(newWeight * dryRatio)}g)`;
        }
        recalculateTotal();
      });

      carbInput.addEventListener("input", () => {
        const currentWeight = parseFloat(weightInput.value) || 0;
        const newCarbs = parseFloat(carbInput.value) || 0;
        if (currentWeight > 0) {
          carbRatio = newCarbs / currentWeight;
        }
        recalculateTotal();
      });

      delBtn.addEventListener("click", () => {
        row.remove();
        recalculateTotal();
      });

      ingredientsBody.appendChild(row);
      recalculateTotal();
    }

    addRowBtn.addEventListener("click", () => addIngredientRow("Weitere Zutat", 50, 0, 10));

    analyzeBtn.addEventListener("click", async () => {
      errorBox.style.display = "none";
      resultCard.style.display = "none";
      applyBtn.style.display = "none";

      if (!selectedFile) {
        errorBox.textContent = "Bitte nimm zuerst ein Foto auf oder wähle ein Bild aus.";
        errorBox.style.display = "block";
        return;
      }

      // Geheime API-Keys aus dem lokalen Webspeicher (localStorage) lesen
      const groqKey = (localStorage.getItem(config.groqKeyStorageName) || "").trim();
      const geminiKey = (localStorage.getItem(config.geminiKeyStorageName) || "").trim();

      if (!config.backendProxyUrl && !groqKey && !geminiKey) {
        errorBox.textContent = `Keine API-Keys im Webspeicher gefunden. Bitte hinterlege deinen Groq- oder Gemini-Key in den Einstellungen deiner App (localStorage: "${config.groqKeyStorageName}" / "${config.geminiKeyStorageName}").`;
        errorBox.style.display = "block";
        return;
      }

      const mode = document.querySelector('input[name="csScanMode"]:checked').value;
      analyzeBtn.disabled = true;
      const t0 = performance.now();

      statusBox.style.display = "block";
      statusBox.textContent = "Starte Analyse... (0.0 s)";
      liveTimerInterval = setInterval(() => {
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        statusBox.textContent = `Bild wird analysiert... (${elapsed} s)`;
      }, 100);

      try {
        const imgData = await resizeImageToBase64(selectedFile, 768);
        const t1 = performance.now();
        const resizeSec = ((t1 - t0) / 1000).toFixed(2);

        let parsed = null;
        let usedProvider = "";
        let fallbackNote = "";

        if (config.backendProxyUrl) {
          // Optionaler Backend-Proxy
          const res = await fetch(config.backendProxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, imgData })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `Server-Fehler ${res.status}`);
          parsed = data.result;
          usedProvider = data.usedProvider || "Backend-Proxy";
          fallbackNote = data.fallbackNote || "";
        } else {
          // Direkter Aufruf aus dem Browser (für GitHub Pages / Static Hosting)
          if (mode === "fast") {
            if (groqKey) {
              try {
                parsed = await callGroqDirect(groqKey, "qwen/qwen3.8-27b", imgData);
                usedProvider = "Groq (qwen/qwen3.8-27b)";
              } catch (err) {
                if (!geminiKey) throw err;
                parsed = await callGeminiDirect(geminiKey, "gemini-3-flash-preview", imgData);
                usedProvider = "Gemini 3 Flash Preview (Fallback)";
                fallbackNote = `Groq nicht erreichbar (${err.message}) -> auf Gemini ausgewichen.`;
              }
            } else {
              parsed = await callGeminiDirect(geminiKey, "gemini-3-flash-preview", imgData);
              usedProvider = "Gemini 3 Flash Preview";
            }
          } else {
            if (geminiKey) {
              try {
                parsed = await callGeminiDirect(geminiKey, "gemini-3-flash-preview", imgData);
                usedProvider = "Gemini 3 Flash Preview";
              } catch (err) {
                if (!groqKey) throw err;
                parsed = await callGroqDirect(groqKey, "qwen/qwen3.8-27b", imgData);
                usedProvider = "Groq qwen/qwen3.8-27b (Fallback)";
                fallbackNote = `Gemini nicht erreichbar (${err.message}) -> auf Groq ausgewichen.`;
              }
            } else {
              parsed = await callGroqDirect(groqKey, "qwen/qwen3.8-27b", imgData);
              usedProvider = "Groq (qwen/qwen3.8-27b)";
            }
          }
        }

        const t2 = performance.now();
        const apiSec = ((t2 - t1) / 1000).toFixed(2);
        const totalSec = ((t2 - t0) / 1000).toFixed(2);

        ingredientsBody.innerHTML = "";
        (parsed.zutaten || []).forEach((item) => {
          addIngredientRow(
            item.name,
            item.gewicht_gramm,
            item.trockengewicht_gramm || 0,
            item.kohlenhydrate_gramm
          );
        });

        noteText.textContent = [parsed.hinweis, fallbackNote].filter(Boolean).join(" | ");
        timingText.innerHTML = `
          <strong>Modell:</strong> ${escapeHtml(usedProvider)} &bull;
          <strong>Zeit:</strong> ${totalSec} s (Bild: ${resizeSec} s, API: ${apiSec} s, ${imgData.sizeKB} KB)
        `;

        resultCard.style.display = "block";
        applyBtn.style.display = "inline-block";
      } catch (err) {
        const failSec = ((performance.now() - t0) / 1000).toFixed(1);
        errorBox.textContent = `Fehler nach ${failSec} s: ${err.message}`;
        errorBox.style.display = "block";
      } finally {
        if (liveTimerInterval) {
          clearInterval(liveTimerInterval);
          liveTimerInterval = null;
        }
        statusBox.style.display = "none";
        analyzeBtn.disabled = false;
      }
    });

    applyBtn.addEventListener("click", () => {
      // 1. Ziel-Input in der Haupt-App befüllen (falls konfiguriert)
      if (config.targetInputSelector) {
        const targetEl = document.querySelector(config.targetInputSelector);
        if (targetEl) {
          targetEl.value = currentTotalCarbs / 10;
          targetEl.dispatchEvent(new Event("input", { bubbles: true }));
          targetEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      // 2. Detaildaten sammeln und optionales Callback aufrufen
      const items = [];
      ingredientsBody.querySelectorAll("tr").forEach((tr) => {
        const name = tr.querySelector(".cs-name-input").value.trim();
        const weight = parseFloat(tr.querySelector(".cs-weight-input").value) || 0;
        const carbs = parseFloat(tr.querySelector(".cs-carb-input").value) || 0;
        const dryBadge = tr.querySelector(".cs-dry-badge");
        const dryMatch = dryBadge ? dryBadge.textContent.match(/\d+/) : null;
        const dryWeight = dryMatch ? parseInt(dryMatch[0], 10) : 0;

        if (name) {
          items.push({ name, weight, dryWeight, carbs });
        }
      });

      if (typeof config.onApply === "function") {
        config.onApply({
          totalCarbs: currentTotalCarbs,
          items
        });
      }

      closeModal();
    });
  }

  window.CarbsScanner = {
    init(userConfig = {}) {
      config = { ...DEFAULT_CONFIG, ...userConfig };
      if (!isInitialized) {
        injectStyles();
        injectDialogHtml();
        bindEvents();
        isInitialized = true;
      }
    },
    open() {
      const dialog = document.getElementById("carbsScannerDialog");
      if (dialog) dialog.showModal();
    }
  };
})();
