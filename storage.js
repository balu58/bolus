(function(global) {
  "use strict";

  var API_KEY_NAMES = [
    "carbs_groq_api_key",
    "carbs_gemini_api_key",
    "carbs_custom_api_url",
    "carbs_custom_api_key",
    "carbs_custom_api_model"
  ];

  var FIELD_KEYS = {
    cfgGroqKey: "carbs_groq_api_key",
    cfgGeminiKey: "carbs_gemini_api_key",
    cfgCustomUrl: "carbs_custom_api_url",
    cfgCustomKey: "carbs_custom_api_key",
    cfgCustomModel: "carbs_custom_api_model"
  };

  function loadApiConfig() {
    var result = {};
    Object.keys(FIELD_KEYS).forEach(function(fieldId) {
      var key = FIELD_KEYS[fieldId];
      result[fieldId] = localStorage.getItem(key) || "";
    });
    return result;
  }

  function saveApiConfig(values) {
    Object.keys(FIELD_KEYS).forEach(function(fieldId) {
      var key = FIELD_KEYS[fieldId];
      var value = typeof values[fieldId] === "string" ? values[fieldId].trim() : "";
      if (value) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    });
  }

  function importEntries(entries, onlyApiKeys) {
    if (!Array.isArray(entries)) {
      throw new Error("Ungültige Sicherung");
    }

    var validEntries = entries.map(function(entry) {
      if (!entry || typeof entry.key !== "string" || typeof entry.value !== "string") {
        throw new Error("Ungültiger Sicherungseintrag");
      }
      return entry;
    });

    var imported = 0;
    validEntries.forEach(function(entry) {
      if (!onlyApiKeys || API_KEY_NAMES.indexOf(entry.key) !== -1) {
        localStorage.setItem(entry.key, entry.value);
        imported++;
      }
    });
    return imported;
  }

  function base64ToBytes(value) {
    var binary = atob(String(value).replace(/\s/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function deriveBackupKey(password, salt) {
    var material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {name: "PBKDF2", salt: salt, iterations: 250000, hash: "SHA-256"},
      material,
      {name: "AES-GCM", length: 256},
      false,
      ["decrypt"]
    );
  }

  async function readLocalBackup(text, password) {
    var envelope;
    try {
      envelope = JSON.parse(text);
    } catch (error) {
      throw new Error("invalid");
    }

    if (envelope.kind === "localStorage") {
      if (envelope.app !== "bolusrechner" || !Array.isArray(envelope.entries)) {
        throw new Error("invalid");
      }
      return envelope;
    }
    if (envelope.kind !== "localStorage-encrypted") {
      if (envelope.app === "bolusrechner" && envelope.data) {
        throw new Error("no-api-config");
      }
      throw new Error("invalid");
    }
    if (envelope.cipher !== "AES-GCM" || envelope.kdf !== "PBKDF2-SHA256") {
      throw new Error("invalid");
    }
    if (!password) {
      throw new Error("password");
    }
    if (!global.crypto || !global.crypto.subtle) {
      throw new Error("unsupported");
    }

    try {
      var key = await deriveBackupKey(password, base64ToBytes(envelope.salt));
      var decrypted = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv: base64ToBytes(envelope.iv)},
        key,
        base64ToBytes(envelope.data)
      );
      var payload = JSON.parse(new TextDecoder().decode(decrypted));
      if (payload.app !== "bolusrechner" ||
          payload.kind !== "localStorage" ||
          !Array.isArray(payload.entries)) {
        throw new Error("invalid");
      }
      return payload;
    } catch (error) {
      if (error.message === "invalid") {
        throw error;
      }
      if (error.name === "OperationError") {
        throw new Error("password");
      }
      throw error;
    }
  }

  global.BolusStorage = {
    apiKeyNames: API_KEY_NAMES,
    fieldKeys: FIELD_KEYS,
    loadApiConfig: loadApiConfig,
    saveApiConfig: saveApiConfig,
    importEntries: importEntries,
    readLocalBackup: readLocalBackup
  };
})(window);
