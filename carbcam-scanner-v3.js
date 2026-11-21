(function (global) {
  "use strict";

  const currentScriptEl = document.currentScript;
  const defaultDialogUrl =
    (currentScriptEl && currentScriptEl.getAttribute("data-dialog-url")) ||
    "carbcam-dialog-v3.html";

  const SYSTEM_PROMPT = [
    "Du bist ein präziser Ernährungs- und Diabetes-Assistent. Analysiere die Mahlzeit auf den übergebenen Fotos (1 bis 3 Perspektiven derselben Mahlzeit) und berechne die verwertbaren Kohlenhydrate in Gramm.",
    "",
    "WICHTIGE REGELN:",
    "1. MEHRERE PERSPEKTIVEN: Wenn mehrere Fotos übergeben werden, zeigen sie DIESELBE Mahlzeit aus verschiedenen Blickwinkeln (z. B. Draufsicht und 45°-Winkel). Nutze die zusätzlichen Winkel nur zur besseren Volumen- und Tiefenschätzung. Zähle Speisen NIEMALS doppelt oder dreifach!",
    "2. VERZEHRFERTIGES GEWICHT & NÄHRWERTE: Rechne immer mit verzehrfertigen, gegarten Gewichten (nicht Trockenmehl-Werte).",
    "   - Gebackener Pizzateig / Flammkuchen: Zerlege Pizza IMMER in Teigboden und Belag! Rechne für gebackenen Hefeteig ca. 36–42 g KH pro 100 g (nicht 50–70 g wie rohes Mehl).",
    "   - Gekochte Nudeln / Reis: ca. 24–28 g KH pro 100 g Kochgewicht.",
    "   - Gekochte Kartoffeln: ca. 15–17 g KH pro 100 g.",
    "   - Kuchen & Gebäck: Nutze Kuchenteller und Besteck als Größenmaßstab, um kleine Stücke nicht zu überschätzen.",
    "3. TROCKENGEWICHT: Gib bei Sättigungsbeilagen (Nudeln, Reis, Kartoffeln, Haferflocken, Hülsenfrüchte) zusätzlich das geschätzte Roh-/Trockengewicht in Gramm im Feld trockengewicht_gramm an (sonst null).",
    "4. ZUSATZHINWEISE: Berücksichtige optionale Hinweise des Nutzers (z. B. zuckerfreie Getränke, Soßenbinder, Teigdicke) vorrangig.",
    "",
    "Antworte AUSSCHLIESSLICH mit validem JSON in exakt diesem Format (ohne Markdown-Codeblöcke):",
    "{",
    '  "zutaten": [',
    "    {",
    '      "name": "Bezeichnung der Zutat",',
    '      "gewicht_gramm": 200,',
    '      "trockengewicht_gramm": 80,',
    '      "kohlenhydrate_gramm": 52',
    "    }",
    "  ],",
    '  "gesamt_kohlenhydrate_gramm": 52,',
    '  "hinweis": "Kurze Begründung zur Schätzung"',
    "}"
  ].join("\n");

  const CarbCamScanner = {
    config: {
      triggerSelector: "#openCarbsScannerBtn",
      targetInputSelector: "#mainCarbsInput",
      dialogUrl: defaultDialogUrl,
      groqKeyStorageName: "carbs_groq_api_key",
      geminiKeyStorageName: "carbs_gemini_api_key",
      customUrlStorageName: "carbs_custom_api_url",
      customKeyStorageName: "carbs_custom_api_key",
      customModelStorageName: "carbs_custom_api_model",
      defaultCustomModel: "claude-haiku-5-5-20261001",
      onApply: null
    },

    state: {
      provider: "groq",
      images: [],
      items: [],
      timerInterval: null,
      startTime: 0,
      dialogInjected: false,
      eventsBound: false
    },

    async init(userConfig = {}) {
      this.config = { ...this.config, ...userConfig };
      this.bindTriggerEarly();
      try {
        await this.injectDialogHtml();
        this.bindDialogEvents();
      } catch (err) {
        console.error("[CarbCamScanner] Fehler beim Laden des Dialogs:", err);
      }
    },

    bindTriggerEarly() {
      if (this._triggerBound) return;
      this._triggerBound = true;

      document.addEventListener("click", async (e) => {
        const trigger = e.target.closest(this.config.triggerSelector);
        if (!trigger) return;

        e.preventDefault();
        try {
          if (!this.state.dialogInjected) {
            await this.injectDialogHtml();
          }
          this.bindDialogEvents();
          const modal = document.getElementById("carbcamModal");
          if (modal) {
            this.resetDialog();
            this.updateCustomCardLabel();
            modal.showModal();
          }
        } catch (err) {
          alert(
            "Der CarbCam-Dialog konnte nicht geladen werden.\n\n" +
            "Hinweis: Bitte die Seite über einen lokalen Server (z. B. http://localhost) oder GitHub Pages öffnen, nicht direkt per file://.\n\n" +
            "Details: " + err.message
          );
        }
      });
    },

    async injectDialogHtml() {
      if (this.state.dialogInjected || document.getElementById("carbcamModal")) {
        this.state.dialogInjected = true;
        return;
      }
      const response = await fetch(this.config.dialogUrl);
      if (!response.ok) {
        throw new Error("Dialog-Template nicht gefunden (" + this.config.dialogUrl + "): HTTP " + response.status);
      }
      const html = await response.text();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      while (wrapper.firstChild) {
        document.body.appendChild(wrapper.firstChild);
      }
      this.state.dialogInjected = true;
    },

    updateCustomCardLabel() {
      const sub = document.getElementById("ccCustomSubLabel");
      if (!sub) return;
      const url = this.getStoredKey(this.config.customUrlStorageName);
      const model = this.getStoredKey(this.config.customModelStorageName);
      if (url) {
        try {
          const host = new URL(url).hostname;
          sub.textContent = model ? host + " (" + model + ")" : host;
        } catch (e) {
          sub.textContent = model || url;
        }
      } else {
        sub.textContent = "Eigene API-URL & Key";
      }
    },

    bindDialogEvents() {
      if (this.state.eventsBound) return;
      const modal = document.getElementById("carbcamModal");
      if (!modal) return;
      this.state.eventsBound = true;

      document.getElementById("ccCloseTopBtn").addEventListener("click", () => modal.close());
      document.getElementById("ccCancelBtn").addEventListener("click", () => modal.close());

      modal.querySelectorAll(".cc-model-card").forEach((card) => {
        card.addEventListener("click", () => {
          modal.querySelectorAll(".cc-model-card").forEach((c) => c.classList.remove("active"));
          card.classList.add("active");
          const radio = card.querySelector("input[type='radio']");
          if (radio) {
            radio.checked = true;
            this.state.provider = radio.value;
          }
        });
      });

      const cameraInput = document.getElementById("ccCameraInput");
      const galleryInput = document.getElementById("ccGalleryInput");

      document.getElementById("ccCameraBtn").addEventListener("click", () => {
        if (this.state.images.length >= 3) {
          this.showStatus("Maximal 3 Bilder pro Analyse möglich.", true);
          return;
        }
        cameraInput.value = "";
        cameraInput.click();
      });

      document.getElementById("ccGalleryBtn").addEventListener("click", () => {
        if (this.state.images.length >= 3) {
          this.showStatus("Maximal 3 Bilder pro Analyse möglich.", true);
          return;
        }
        galleryInput.value = "";
        galleryInput.click();
      });

      cameraInput.addEventListener("change", (e) => this.handleFiles(e.target.files));
      galleryInput.addEventListener("change", (e) => this.handleFiles(e.target.files));

      document.getElementById("ccAnalyzeBtn").addEventListener("click", () => this.runAnalysis());
      document.getElementById("ccAddRowBtn").addEventListener("click", () => {
        this.state.items.push({
          name: "Weitere Zutat",
          gewicht_gramm: 100,
          trockengewicht_gramm: null,
          dryRatio: null,
          kohlenhydrate_gramm: 10,
          carbsPerGram: 0.1
        });
        this.renderItems();
      });

      document.getElementById("ccApplyBtn").addEventListener("click", () => {
        const totalCarbs = this.calculateTotalCarbs();
        if (this.config.targetInputSelector) {
          const targetEl = document.querySelector(this.config.targetInputSelector);
          if (targetEl) {
            targetEl.value = totalCarbs;
            targetEl.dispatchEvent(new Event("input", { bubbles: true }));
            targetEl.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        if (typeof this.config.onApply === "function") {
          this.config.onApply({
            totalCarbs,
            items: this.state.items,
            provider: this.state.provider
          });
        }
        modal.close();
      });
    },

    resetDialog() {
      this.state.images = [];
      this.state.items = [];
      this.renderPreviews();
      document.getElementById("ccUserTip").value = "";
      document.getElementById("ccStatusBox").hidden = true;
      document.getElementById("ccResultSection").hidden = true;
      document.getElementById("ccApplyBtn").hidden = true;
      document.getElementById("ccAnalyzeBtn").disabled = false;
    },

    async handleFiles(fileList) {
      if (!fileList || !fileList.length) return;
      const remaining = 3 - this.state.images.length;
      const filesToProcess = Array.from(fileList).slice(0, remaining);

      for (const file of filesToProcess) {
        const compressed = await this.compressImage(file, 768, 0.8);
        this.state.images.push(compressed);
      }

      if (fileList.length > remaining) {
        this.showStatus("Es wurden nur die ersten 3 Bilder übernommen.", true);
      } else {
        document.getElementById("ccStatusBox").hidden = true;
      }

      this.renderPreviews();
    },

    compressImage(file, maxDim = 768, quality = 0.8) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
        reader.onload = (ev) => {
          const img = new Image();
          img.onerror = () => reject(new Error("Bild konnte nicht dekodiert werden."));
          img.onload = () => {
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL("image/jpeg", quality);
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
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      });
    },

    renderPreviews() {
      const grid = document.getElementById("ccPreviewGrid");
      grid.innerHTML = "";
      this.state.images.forEach((img, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "cc-thumb-wrap";
        wrap.innerHTML =
          '<img src="' + img.dataUrl + '" alt="Perspektive ' + (idx + 1) + '" />' +
          '<span class="cc-thumb-badge">Bild ' + (idx + 1) + " (" + img.sizeKB + " KB)</span>" +
          '<button type="button" class="cc-thumb-remove" aria-label="Entfernen">&times;</button>';
        wrap.querySelector(".cc-thumb-remove").addEventListener("click", () => {
          this.state.images.splice(idx, 1);
          this.renderPreviews();
        });
        grid.appendChild(wrap);
      });
    },

    getStoredKey(storageName) {
      if (!storageName) return "";
      return (localStorage.getItem(storageName) || "").trim();
    },

    startTimer(label) {
      this.state.startTime = performance.now();
      const statusBox = document.getElementById("ccStatusBox");
      statusBox.classList.remove("error");
      statusBox.hidden = false;
      statusBox.textContent = label + " läuft... 0.0 s";

      clearInterval(this.state.timerInterval);
      this.state.timerInterval = setInterval(() => {
        const elapsed = ((performance.now() - this.state.startTime) / 1000).toFixed(1);
        statusBox.textContent = label + " läuft... " + elapsed + " s";
      }, 100);
    },

    stopTimer() {
      clearInterval(this.state.timerInterval);
      return ((performance.now() - this.state.startTime) / 1000).toFixed(2);
    },

    showStatus(msg, isError = false) {
      clearInterval(this.state.timerInterval);
      const statusBox = document.getElementById("ccStatusBox");
      statusBox.hidden = false;
      statusBox.classList.toggle("error", isError);
      statusBox.textContent = msg;
    },

    buildUserPrompt() {
      const tip = document.getElementById("ccUserTip").value.trim();
      const count = this.state.images.length;
      let text =
        "Analysiere diese " +
        (count > 1 ? count + " Perspektiven derselben Mahlzeit" : "Mahlzeit") +
        " und gib das Ergebnis als JSON zurück.";
      if (tip) {
        text += '\nZusätzlicher Hinweis des Nutzers: "' + tip + '"';
      }
      return text;
    },

    async runAnalysis() {
      if (this.state.images.length === 0) {
        this.showStatus("Bitte zuerst mindestens ein Foto aufnehmen oder auswählen.", true);
        return;
      }

      const analyzeBtn = document.getElementById("ccAnalyzeBtn");
      analyzeBtn.disabled = true;
      document.getElementById("ccResultSection").hidden = true;
      document.getElementById("ccApplyBtn").hidden = true;

      const selected = this.state.provider;
      let usedModelLabel = "";

      try {
        if (selected === "groq") {
          this.startTimer("Blitz-Scan (Groq)");
          try {
            usedModelLabel = "GROQ / qwen/qwen3.8-27b";
            const parsed = await this.callGroq();
            this.displayResult(parsed, usedModelLabel);
          } catch (groqErr) {
            const geminiKey = this.getStoredKey(this.config.geminiKeyStorageName);
            if (geminiKey) {
              usedModelLabel = "GEMINI Fallback / gemini-3-flash-preview";
              const parsed = await this.callGemini();
              this.displayResult(parsed, usedModelLabel);
            } else {
              throw groqErr;
            }
          }
        } else if (selected === "gemini") {
          this.startTimer("Detail-Scan (Gemini 3 Flash)");
          usedModelLabel = "GEMINI / gemini-3-flash-preview";
          const parsed = await this.callGemini();
          this.displayResult(parsed, usedModelLabel);
        } else if (selected === "custom") {
          const customModel = this.getStoredKey(this.config.customModelStorageName) || this.config.defaultCustomModel;
          this.startTimer("Benutzerdefiniert (" + customModel + ")");
          usedModelLabel = "BENUTZERDEFINIERT / " + customModel;
          const parsed = await this.callCustom();
          this.displayResult(parsed, usedModelLabel);
        }
      } catch (err) {
        const dur = this.stopTimer();
        this.showStatus("Fehler nach " + dur + " s: " + err.message, true);
      } finally {
        analyzeBtn.disabled = false;
      }
    },

    async callGroq() {
      const apiKey = this.getStoredKey(this.config.groqKeyStorageName);
      if (!apiKey) {
        throw new Error("Kein Groq API-Key im localStorage hinterlegt.");
      }

      const contentParts = [{ type: "text", text: this.buildUserPrompt() }];
      for (const img of this.state.images) {
        contentParts.push({
          type: "image_url",
          image_url: { url: "data:" + img.mimeType + ";base64," + img.base64 }
        });
      }

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
          model: "qwen/qwen3.8-27b",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: contentParts }
          ]
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error((data.error && data.error.message) || "Groq HTTP " + res.status);
      }
      return this.parseJsonSafe(data.choices[0].message.content);
    },

    async callGemini() {
      const apiKey = this.getStoredKey(this.config.geminiKeyStorageName);
      if (!apiKey) {
        throw new Error("Kein Gemini API-Key im localStorage hinterlegt.");
      }

      const parts = [{ text: SYSTEM_PROMPT + "\n\n" + this.buildUserPrompt() }];
      for (const img of this.state.images) {
        parts.push({
          inline_data: { mime_type: img.mimeType, data: img.base64 }
        });
      }

      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=" +
        encodeURIComponent(apiKey);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error((data.error && data.error.message) || "Gemini HTTP " + res.status);
      }
      const rawText = data.candidates[0].content.parts[0].text;
      return this.parseJsonSafe(rawText);
    },

    async callCustom() {
      const customUrl = this.getStoredKey(this.config.customUrlStorageName);
      if (!customUrl) {
        throw new Error("Keine benutzerdefinierte API-URL im localStorage hinterlegt.");
      }
      const apiKey = this.getStoredKey(this.config.customKeyStorageName);
      const modelName = this.getStoredKey(this.config.customModelStorageName) || this.config.defaultCustomModel;

      // Automatische Erkennung: Anthropic Messages API vs. OpenAI-kompatible Chat-Completions API
      if (customUrl.toLowerCase().includes("anthropic.com")) {
        const headers = {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        };
        if (apiKey) {
          headers["x-api-key"] = apiKey;
        }

        const contentParts = [];
        for (const img of this.state.images) {
          contentParts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mimeType,
              data: img.base64
            }
          });
        }
        contentParts.push({ type: "text", text: this.buildUserPrompt() });

        const res = await fetch(customUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName,
            max_tokens: 1024,
            temperature: 0.2,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: contentParts }]
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error((data.error && data.error.message) || "Custom Anthropic HTTP " + res.status);
        }
        const textBlock = data.content.find((b) => b.type === "text");
        return this.parseJsonSafe(textBlock ? textBlock.text : "");
      }

      // OpenAI-kompatibler Standard (OpenAI, OpenRouter, Mistral, Ollama, eigene Proxys)
      const headers = { "Content-Type": "application/json" };
      if (apiKey) {
        const cleanKey = apiKey.replace(/^Bearer\s+/i, "");
        headers["Authorization"] = "Bearer " + cleanKey;
      }

      const contentParts = [{ type: "text", text: this.buildUserPrompt() }];
      for (const img of this.state.images) {
        contentParts.push({
          type: "image_url",
          image_url: { url: "data:" + img.mimeType + ";base64," + img.base64 }
        });
      }

      const res = await fetch(customUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelName,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: contentParts }
          ]
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error((data.error && data.error.message) || "Custom API HTTP " + res.status);
      }
      return this.parseJsonSafe(data.choices[0].message.content);
    },

    parseJsonSafe(rawText) {
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      return JSON.parse(cleaned);
    },

    displayResult(parsed, modelLabel) {
      const duration = this.stopTimer();
      document.getElementById("ccStatusBox").hidden = true;

      const list = Array.isArray(parsed.zutaten) ? parsed.zutaten : [];
      this.state.items = list.map((z) => {
        const w = Number(z.gewicht_gramm) || 0;
        const c = Number(z.kohlenhydrate_gramm) || 0;
        const dry = z.trockengewicht_gramm != null ? Number(z.trockengewicht_gramm) : null;
        return {
          name: z.name || "Zutat",
          gewicht_gramm: w,
          trockengewicht_gramm: dry,
          dryRatio: w > 0 && dry != null ? dry / w : null,
          kohlenhydrate_gramm: Math.round(c),
          carbsPerGram: w > 0 ? c / w : 0
        };
      });

      this.renderItems();

      document.getElementById("ccAnalysisNote").textContent = parsed.hinweis || "";
      const totalKB = this.state.images.reduce((acc, i) => acc + i.sizeKB, 0);
      document.getElementById("ccTimingInfo").textContent =
        "Modell: " + modelLabel + " • Dauer: " + duration + " s • " + this.state.images.length + " Bild(er) (" + totalKB + " KB)";

      document.getElementById("ccResultSection").hidden = false;
      document.getElementById("ccApplyBtn").hidden = false;
    },

    renderItems() {
      const container = document.getElementById("ccItemsList");
      container.innerHTML = "";

      this.state.items.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "cc-item-row";

        const dryText =
          item.trockengewicht_gramm != null && item.trockengewicht_gramm > 0
            ? "(tr: " + Math.round(item.trockengewicht_gramm) + "g)"
            : "";

        row.innerHTML =
          '<input type="text" class="cc-in-name" value="' + this.escapeHtml(item.name) + '" aria-label="Zutat" />' +
          '<div class="cc-weight-cell">' +
          '<input type="number" class="cc-in-weight" value="' + Math.round(item.gewicht_gramm) + '" min="0" step="1" aria-label="Gewicht in g" />' +
          '<span class="cc-dry-tag">' + dryText + "</span>" +
          "</div>" +
          '<div class="cc-carbs-cell">' +
          '<input type="number" class="cc-in-carbs" value="' + Math.round(item.kohlenhydrate_gramm) + '" min="0" step="1" aria-label="Kohlenhydrate in g" />' +
          '<span style="font-size:0.75rem;">g</span>' +
          "</div>" +
          '<button type="button" class="cc-del-row" title="Zeile löschen">&times;</button>';

        row.querySelector(".cc-in-name").addEventListener("input", (e) => {
          item.name = e.target.value;
        });

        row.querySelector(".cc-in-weight").addEventListener("input", (e) => {
          const newWeight = Math.max(0, Number(e.target.value) || 0);
          item.gewicht_gramm = newWeight;
          if (item.carbsPerGram > 0) {
            item.kohlenhydrate_gramm = Math.round(newWeight * item.carbsPerGram);
            row.querySelector(".cc-in-carbs").value = item.kohlenhydrate_gramm;
          }
          if (item.dryRatio != null) {
            item.trockengewicht_gramm = Math.round(newWeight * item.dryRatio);
            row.querySelector(".cc-dry-tag").textContent =
              item.trockengewicht_gramm > 0 ? "(tr: " + item.trockengewicht_gramm + "g)" : "";
          }
          this.updateTotalDisplay();
        });

        row.querySelector(".cc-in-carbs").addEventListener("input", (e) => {
          const newCarbs = Math.max(0, Number(e.target.value) || 0);
          item.kohlenhydrate_gramm = newCarbs;
          if (item.gewicht_gramm > 0) {
            item.carbsPerGram = newCarbs / item.gewicht_gramm;
          }
          this.updateTotalDisplay();
        });

        row.querySelector(".cc-del-row").addEventListener("click", () => {
          this.state.items.splice(index, 1);
          this.renderItems();
        });

        container.appendChild(row);
      });

      this.updateTotalDisplay();
    },

    calculateTotalCarbs() {
      return Math.round(
        this.state.items.reduce((sum, item) => sum + (Number(item.kohlenhydrate_gramm) || 0), 0)
      );
    },

    updateTotalDisplay() {
      document.getElementById("ccTotalCarbs").textContent = this.calculateTotalCarbs();
    },

    escapeHtml(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
  };

  global.CarbCamScanner = CarbCamScanner;
  global.CarbsScanner = CarbCamScanner;
})(window);
