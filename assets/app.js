(function () {
  const client = ZAFClient.init();

  // --------- UI ---------
  const statusEl = document.getElementById("status");
  const debugEl = document.getElementById("debug");
  const debugDetails = document.getElementById("debugDetails");

  const btnEnsureFolder = document.getElementById("btnEnsureFolder");
  const btnOpenFolder = document.getElementById("btnOpenFolder");
  const btnGenerate = document.getElementById("btnGenerate");
  const btnCreateNote = document.getElementById("btnCreateNote");
  const templateSelect = document.getElementById("templateSelect");

  const DEFAULT_BACKEND_BASE_URL = "https://sell-medinet-backend.onrender.com";

  const FIELD_IDS = {
    rut: 2540090,
    birthDate: 2618055,
    emailPrimary: 2533760,
    emailSecondary: 2567316,
    direccion: 2567323,
    comuna: 2547816,
    telA: 2528872,
    telB: 2567315,
    telC: 2577564,
    tramoModalidad: 2758483,
  };

  const FIELD_KEYS = {
    rut: [FIELD_IDS.rut, "RUT o ID", "RUT O ID"],
    birthDate: [FIELD_IDS.birthDate, "Fecha Nacimiento", "Fecha de nacimiento"],
    emailPrimary: [FIELD_IDS.emailPrimary, "Correo electrónico", "Correo"],
    emailSecondary: [FIELD_IDS.emailSecondary, "correo electrónico", "Correo"],
    direccion: [FIELD_IDS.direccion, "Dirección", "Direccion"],
    comuna: [FIELD_IDS.comuna, "Comuna", "Ciudad"],
    telA: [FIELD_IDS.telA, "Teléfono", "Telefono"],
    telB: [FIELD_IDS.telB, "Numero de teléfono", "Número de teléfono", "Telefono"],
    telC: [FIELD_IDS.telC, "Telefono", "Teléfono"],
    tramoModalidad: [FIELD_IDS.tramoModalidad, "Tramo/Modalidad"],
  };

  const state = {
    settings: null,
    deal: null,
    contact: null,
    payload: null,
    drive_folder_url: null,
    drive_folder_id: null,
    last_doc_url: null,
    templates: [],
  };

  // --------- helpers ---------
  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
    scheduleResize();
  }

  function setDebug(obj) {
    if (!debugEl) return;
    debugEl.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
    scheduleResize();
  }

  function isObject(x) {
    return x && typeof x === "object" && !Array.isArray(x);
  }

  function toStringValue(val) {
    if (val === null || val === undefined) return "";
    if (isObject(val)) {
      const line1 = val.line1 || val.street || "";
      const city = val.city || "";
      const state = val.state || "";
      const postal = val.postal_code || val.postalCode || "";
      const parts = [line1, city, state, postal]
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      return parts.join(", ");
    }
    return String(val).trim();
  }

  function getField(entity, keys) {
    if (!entity) return "";
    const keyList = (Array.isArray(keys) ? keys : [keys]).filter(
      (k) => k !== undefined && k !== null
    );

    const candidateMaps = [
      entity.custom_fields,
      entity.customFields,
      entity.custom_field_values,
      entity.customFieldValues,
    ];

    for (const key of keyList) {
      const keyStr = String(key);
      for (const map of candidateMaps) {
        if (map && isObject(map)) {
          if (Object.prototype.hasOwnProperty.call(map, keyStr)) return map[keyStr];
          if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
        }
      }
    }

    if (Array.isArray(entity.custom_fields)) {
      for (const key of keyList) {
        const id = String(key);
        const hit = entity.custom_fields.find(
          (x) => String(x.id) === id || String(x.custom_field_id) === id
        );
        if (hit) return hit.value;
      }
    }
    return "";
  }

  async function getSettings() {
    const metadata = await client.metadata().catch(() => ({}));
    let settings =
      (metadata && metadata.settings) ||
      (metadata && metadata.installationSettings) ||
      (metadata && metadata.config) ||
      {};

    const got = await client.get("settings").catch(() => ({}));
    if (got && Object.keys(got).length) {
      const fromGet = got.settings && Object.keys(got.settings).length ? got.settings : got;
      settings = Object.assign({}, settings, fromGet);
    }

    const baseUrl =
      settings.backend_base_url ||
      settings.backendBaseUrl ||
      settings.base_url ||
      settings.baseUrl ||
      DEFAULT_BACKEND_BASE_URL;

    const rootFolderId =
      settings.drive_root_folder_id ||
      settings.driveRootFolderId ||
      settings.root_folder_id ||
      settings.rootFolderId ||
      "";

    const sharedDriveId =
      settings.drive_shared_drive_id ||
      settings.driveSharedDriveId ||
      settings.shared_drive_id ||
      settings.sharedDriveId ||
      "";

    const timeout =
      settings.backend_timeout_ms ||
      settings.backendTimeoutMs ||
      settings.timeout_ms ||
      settings.timeoutMs ||
      20000;

    return {
      backend_base_url: String(baseUrl || "").trim().replace(/\/$/, ""),
      drive_root_folder_id: String(rootFolderId || "").trim(),
      drive_shared_drive_id: String(sharedDriveId || "").trim(),
      backend_timeout_ms: Number(timeout || 20000),
    };
  }

  async function getDealContext() {
    const sources = [];
    const tryPush = (value) => {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) sources.push(n);
    };

    const fromGet = await client
      .get(["deal.id", "deal", "currentDeal.id", "currentDeal", "dealId", "context.dealId"])
      .catch(() => ({}));

    tryPush(fromGet["deal.id"]);
    tryPush(fromGet["currentDeal.id"]);
    tryPush(fromGet.dealId);
    tryPush(fromGet["context.dealId"]);
    if (fromGet.deal && fromGet.deal.id) tryPush(fromGet.deal.id);
    if (fromGet.currentDeal && fromGet.currentDeal.id) tryPush(fromGet.currentDeal.id);

    const ctx = await client.context().catch(() => ({}));
    tryPush(ctx.dealId);
    tryPush(ctx.entityId);
    tryPush(ctx.resource_id);

    const urlParams = new URLSearchParams(window.location.search);
    tryPush(urlParams.get("deal_id"));
    tryPush(urlParams.get("dealId"));

    const dealId = sources.find((x) => Number.isFinite(x) && x > 0);
    if (!dealId) throw new Error("No fue posible determinar el Deal actual.");

    const dealResponse = await client.request({
      url: `/v2/deals/${dealId}`,
      type: "GET",
      contentType: "application/json",
    });

    const deal = dealResponse && dealResponse.data ? dealResponse.data : dealResponse;
    if (!deal || !deal.id) throw new Error("No se pudo cargar el Deal.");

    return deal;
  }

  async function getContactContext(deal) {
    const contactId = deal.contact_id || (deal.contact && deal.contact.id);
    if (!contactId) throw new Error("El Deal no tiene contacto asociado.");

    const contactResponse = await client.request({
      url: `/v2/contacts/${contactId}`,
      type: "GET",
      contentType: "application/json",
    });

    const contact = contactResponse && contactResponse.data ? contactResponse.data : contactResponse;
    if (!contact || !contact.id) throw new Error("No se pudo cargar el Contact.");

    return contact;
  }

  function normalizePhone(phone) {
    const digits = String(phone || "").replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.startsWith("56") && digits.length >= 11) return digits.slice(2);
    return digits;
  }

  function pickTel1Tel2(contact) {
    const candidates = [
      toStringValue(getField(contact, FIELD_KEYS.telA)),
      toStringValue(getField(contact, FIELD_KEYS.telB)),
      toStringValue(getField(contact, FIELD_KEYS.telC)),
      toStringValue(contact.phone),
      toStringValue(contact.mobile_phone),
      toStringValue(contact.work_phone),
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const tel1 = candidates[0] || "";
    if (!tel1) return { tel1: "", tel2: "" };

    const normalizedTel1 = normalizePhone(tel1);
    const tel2Distinct = candidates.find(
      (tel) => normalizePhone(tel) && normalizePhone(tel) !== normalizedTel1
    );

    return { tel1, tel2: tel2Distinct || tel1 };
  }

  function selectEmail(contact) {
    const emailA = toStringValue(getField(contact, FIELD_KEYS.emailPrimary));
    const emailB = toStringValue(getField(contact, FIELD_KEYS.emailSecondary));
    const emailStd = toStringValue(contact.email);
    return (emailA || emailB || emailStd || "").trim();
  }

  async function resolveTramoModalidadName(deal) {
    const rawValue = getField(deal, FIELD_KEYS.tramoModalidad);
    if (!rawValue) return "";

    if (typeof rawValue === "string" && Number.isNaN(Number(rawValue))) {
      return rawValue.trim();
    }

    const selectedId = String(rawValue);
    const endpoints = [
      `/v2/custom_fields/deals/${FIELD_IDS.tramoModalidad}`,
      `/v2/deal_custom_fields/${FIELD_IDS.tramoModalidad}`,
      `/v2/custom_fields/${FIELD_IDS.tramoModalidad}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const definitionResponse = await client.request({
          url: endpoint,
          type: "GET",
          contentType: "application/json",
        });

        const definition =
          definitionResponse && definitionResponse.data ? definitionResponse.data : definitionResponse;

        const options =
          (definition && (definition.options || definition.choices || definition.values)) || [];

        if (Array.isArray(options)) {
          const hit = options.find(
            (opt) => String(opt.id) === selectedId || String(opt.value) === selectedId
          );
          if (hit) return String(hit.name || hit.label || hit.value || "").trim();
        }
      } catch (_e) {
        // intenta siguiente
      }
    }

    return String(rawValue).trim();
  }

  function requestWithTimeout(options, timeoutMs) {
    return Promise.race([
      client.request(options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout de backend")), Number(timeoutMs || 20000))
      ),
    ]);
  }

  function backendRequest(path, { method = "GET", data = null, qs = "" } = {}) {
    const s = state.settings;
    const url = `${s.backend_base_url}${path}${qs || ""}`;

    const options = {
      url,
      type: method,
      contentType: "application/json",
      headers: {
        "X-API-Key": "{{setting.backend_api_key}}",
      },
      secure: true,
    };

    if (data) options.data = JSON.stringify(data);
    return requestWithTimeout(options, s.backend_timeout_ms);
  }

  function setButtonsEnabled(enabled) {
    const on = Boolean(enabled);
    if (btnEnsureFolder) btnEnsureFolder.disabled = !on;
    if (btnCreateNote) btnCreateNote.disabled = !on;
    // generate/open dependen de status
  }

  function populateTemplates(templates) {
    state.templates = Array.isArray(templates) ? templates : [];

    if (!templateSelect) return;

    templateSelect.innerHTML = "";

    if (!state.templates.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(Sin plantillas)";
      templateSelect.appendChild(opt);
      templateSelect.disabled = true;
      if (btnGenerate) btnGenerate.disabled = true;
      return;
    }

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "(Selecciona plantilla)";
    templateSelect.appendChild(opt0);

    for (const t of state.templates) {
      const opt = document.createElement("option");
      opt.value = t.key || t.id || "";
      opt.textContent = t.name || t.label || t.key || "(sin nombre)";
      templateSelect.appendChild(opt);
    }

    templateSelect.disabled = false;
    if (btnGenerate) btnGenerate.disabled = false;
  }

  function openUrlSafely(url) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function preopenWindow() {
    try {
      return window.open("about:blank", "_blank", "noopener,noreferrer");
    } catch (_e) {
      return null;
    }
  }

  // --------- resize ---------
  let resizeTimer = null;
  function scheduleResize() {
    if (resizeTimer) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      try {
        const h = Math.max(document.body.scrollHeight, 200);
        client.invoke("resize", { height: h });
      } catch (_e) {
        // ignore
      }
    }, 30);
  }

  // --------- actions ---------
  async function refreshStatus() {
    const debug = {
      action: "status",
      timestamp: new Date().toISOString(),
      request: null,
      response: null,
      error: null,
    };

    try {
      setStatus("Cargando estado...");

      const dealId = state.deal ? Number(state.deal.id) : null;
      if (!dealId) throw new Error("No hay deal_id");

      debug.request = { deal_id: dealId };
      const res = await backendRequest("/sell/status", {
        method: "GET",
        qs: `?deal_id=${encodeURIComponent(String(dealId))}`,
      });

      debug.response = res;

      const data = res && res.data ? res.data : res;
      state.drive_folder_url = data.drive_folder_url || data.folder_url || null;
      state.drive_folder_id = data.drive_folder_id || data.folder_id || null;
      state.last_doc_url = data.last_doc_url || data.doc_url || null;

      populateTemplates(data.templates || []);

      if (btnOpenFolder) btnOpenFolder.disabled = !state.drive_folder_url;
      if (btnCreateNote) btnCreateNote.disabled = false;

      setStatus("Listo ✅");
      setDebug(debug);
    } catch (e) {
      debug.error = { name: e && e.name, message: e && e.message };
      // No bloqueamos la app si el status no existe; igual se puede asegurar carpeta.
      setStatus("Listo ✅ (sin status)");
      setDebug(debug);

      // permitir acciones manuales
      if (btnCreateNote) btnCreateNote.disabled = false;
    }
  }

  async function onEnsureFolder() {
    const debug = {
      action: "drive_folder_ensure",
      timestamp: new Date().toISOString(),
      payload: null,
      response: null,
      error: null,
    };

    try {
      if (!state.settings.drive_root_folder_id) {
        throw new Error("Falta setting: drive_root_folder_id.");
      }

      if (!state.payload) {
        throw new Error("No se pudo construir payload.");
      }

      setStatus("Creando/asegurando carpeta Drive...");

      const payload = Object.assign({}, state.payload, {
        drive_root_folder_id: state.settings.drive_root_folder_id,
        drive_shared_drive_id: state.settings.drive_shared_drive_id || undefined,
      });

      debug.payload = payload;

      const res = await backendRequest("/drive/folder/ensure", {
        method: "POST",
        data: payload,
      });

      debug.response = res;
      const data = res && res.data ? res.data : res;

      state.drive_folder_url = data.drive_folder_url || data.folder_url || state.drive_folder_url;
      state.drive_folder_id = data.drive_folder_id || data.folder_id || state.drive_folder_id;

      if (btnOpenFolder) btnOpenFolder.disabled = !state.drive_folder_url;

      setStatus("Carpeta lista ✅");
      setDebug(debug);

      // refrescar status para cargar templates/links si backend lo soporta
      refreshStatus();
    } catch (e) {
      debug.error = { name: e && e.name, message: e && e.message };
      setStatus(e && e.message ? e.message : "Error");
      setDebug(debug);
    }
  }

  function onOpenFolder() {
    openUrlSafely(state.drive_folder_url || state.last_doc_url);
  }

  async function onGenerate() {
    const debug = {
      action: "drive_doc_generate",
      timestamp: new Date().toISOString(),
      payload: null,
      response: null,
      error: null,
    };

    let win = null;

    try {
      const templateKey = templateSelect ? String(templateSelect.value || "") : "";
      if (!templateKey) throw new Error("Selecciona una plantilla.");
      if (!state.payload) throw new Error("No se pudo construir payload.");

      win = preopenWindow();

      setStatus("Generando documento...");

      const payload = Object.assign({}, state.payload, {
        template_key: templateKey,
        drive_folder_id: state.drive_folder_id || undefined,
        drive_root_folder_id: state.settings.drive_root_folder_id,
        drive_shared_drive_id: state.settings.drive_shared_drive_id || undefined,
      });

      debug.payload = payload;

      const res = await backendRequest("/drive/doc/generate", {
        method: "POST",
        data: payload,
      });

      debug.response = res;
      const data = res && res.data ? res.data : res;

      const url = data.doc_url || data.url || data.download_url || data.webViewLink || null;
      state.last_doc_url = url || state.last_doc_url;

      if (url) {
        if (win && !win.closed) {
          try {
            win.location.href = url;
          } catch (_e) {
            openUrlSafely(url);
          }
        } else {
          openUrlSafely(url);
        }
      }

      setStatus("Documento generado ✅");
      setDebug(debug);

      refreshStatus();
    } catch (e) {
      debug.error = { name: e && e.name, message: e && e.message };
      if (win && !win.closed) {
        try {
          win.close();
        } catch (_e) {
          // ignore
        }
      }
      setStatus(e && e.message ? e.message : "Error");
      setDebug(debug);
    }
  }

  async function onCreateNote() {
    const debug = {
      action: "sell_note_create",
      timestamp: new Date().toISOString(),
      payload: null,
      response: null,
      error: null,
    };

    try {
      if (!state.deal || !state.deal.id) throw new Error("No hay Deal");

      setStatus("Creando nota en Sell...");

      const links = [];
      if (state.drive_folder_url) links.push({ label: "📁 Carpeta Drive", url: state.drive_folder_url });
      if (state.last_doc_url) links.push({ label: "📄 Último documento", url: state.last_doc_url });

      const payload = {
        deal_id: Number(state.deal.id),
        contact_id: state.contact ? Number(state.contact.id) : undefined,
        links,
        source: "zendesk_sell_deal_card_generate_exams",
      };

      debug.payload = payload;

      const res = await backendRequest("/sell/note/create", {
        method: "POST",
        data: payload,
      });

      debug.response = res;
      setStatus("Nota creada ✅");
      setDebug(debug);
    } catch (e) {
      debug.error = { name: e && e.name, message: e && e.message };
      setStatus(e && e.message ? e.message : "Error");
      setDebug(debug);
    }
  }

  // --------- boot ---------
  async function boot() {
    setStatus("Cargando...");
    setButtonsEnabled(false);

    const debug = {
      action: "boot",
      timestamp: new Date().toISOString(),
      settings: null,
      deal_id: null,
      contact_id: null,
      payload: null,
      warnings: [],
      error: null,
    };

    try {
      state.settings = await getSettings();
      debug.settings = state.settings;

      // Validaciones suaves (sin TypeError)
      if (!state.settings.backend_base_url) {
        debug.warnings.push("backend_base_url vacío; usando default");
        state.settings.backend_base_url = DEFAULT_BACKEND_BASE_URL;
      }
      if (!state.settings.drive_root_folder_id) {
        debug.warnings.push("Falta drive_root_folder_id (requerido para Drive)");
      }

      state.deal = await getDealContext();
      debug.deal_id = state.deal.id;

      state.contact = await getContactContext(state.deal);
      debug.contact_id = state.contact.id;

      const tramoModalidad = await resolveTramoModalidadName(state.deal);
      const phones = pickTel1Tel2(state.contact);

      const payload = {
        deal_id: Number(state.deal.id),
        contact_id: Number(state.contact.id),
        rut: toStringValue(getField(state.contact, FIELD_KEYS.rut)),
        first_name: toStringValue(state.contact.first_name),
        last_name: toStringValue(state.contact.last_name),
        birth_date: toStringValue(getField(state.contact, FIELD_KEYS.birthDate)),
        email: selectEmail(state.contact),
        telefono1: phones.tel1,
        telefono2: phones.tel2 || phones.tel1,
        direccion: toStringValue(getField(state.contact, FIELD_KEYS.direccion)) || toStringValue(state.contact.address || {}),
        comuna: toStringValue(getField(state.contact, FIELD_KEYS.comuna)) || toStringValue((state.contact.address || {}).city),
        tramo_modalidad: tramoModalidad,
        source: "zendesk_sell_deal_card_generate_exams",
      };

      state.payload = payload;
      debug.payload = payload;

      // Habilitar acciones base
      setButtonsEnabled(true);

      // Si falta root folder, deshabilitar acciones Drive que lo requieren
      if (!state.settings.drive_root_folder_id) {
        if (btnEnsureFolder) btnEnsureFolder.disabled = true;
        if (btnGenerate) btnGenerate.disabled = true;
        if (templateSelect) {
          templateSelect.disabled = true;
          templateSelect.innerHTML = "<option value=\"\">(Configura drive_root_folder_id)</option>";
        }
        setStatus("Configura drive_root_folder_id para habilitar Drive.");
      } else {
        // cargar status y templates si existe
        await refreshStatus();
      }

      setDebug(debug);

      scheduleResize();
    } catch (e) {
      debug.error = { name: e && e.name, message: e && e.message };
      setStatus(e && e.message ? e.message : "Error al iniciar");
      setDebug(debug);
      setButtonsEnabled(false);
    }
  }

  // --------- bindings ---------
  if (btnEnsureFolder) btnEnsureFolder.addEventListener("click", onEnsureFolder);
  if (btnOpenFolder) btnOpenFolder.addEventListener("click", onOpenFolder);
  if (btnGenerate) btnGenerate.addEventListener("click", onGenerate);
  if (btnCreateNote) btnCreateNote.addEventListener("click", onCreateNote);

  if (debugDetails) {
    debugDetails.addEventListener("toggle", scheduleResize);
  }

  window.addEventListener("load", () => {
    boot();
  });
})();
