"use strict";
// Branding and main tuning values live in config.js; palette lives in theme.css.
const CONFIG = window.BK_CONFIG;
document.title = CONFIG.name;
document.querySelector("link[rel=icon]").href = CONFIG.favicon;
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const route =
  location.pathname.slice(1) ||
  (matchMedia("(max-width:700px)").matches &&
  !location.search.includes("editor")
    ? "controller"
    : "editor");
let state,
  clients = [],
  status = {},
  myId,
  ws,
  connected = false,
  clockOffset = 0,
  clockReady = false,
  bestRTT = Infinity,
  lastContact = 0,
  retry = 0,
  seq = 0;
let customDraft = {},
  presetListKey = "";
let selectedEditorId = null,
  programContext = null,
  menuProjectId = null,
  menuKey = "";
let editorId = null,
  editorVersion = 0,
  dirty = false,
  saving = false,
  conflict = false,
  saveTimer,
  draftPromise = null,
  shellKey = "",
  layoutKey = "",
  lastLayoutSent = "",
  chapters = [],
  maxPosition = 0,
  freezeAt = 0,
  holdActive = false;
const pending = new Map();
let stage,
  content,
  viewport,
  guide,
  ruler,
  fontsReady = false;
const browserIdentity =
  localStorage.getItem("bk-client-identity") ||
  crypto.randomUUID?.() ||
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
localStorage.setItem("bk-client-identity", browserIdentity);
const clientName =
  localStorage.getItem("bk-name") ||
  `Klient · ${/Android|iPhone|iPad/.test(navigator.userAgent) ? "Mobil" : "Skjerm"}`;
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").style.display = "none"), 6000);
}
function send(data) {
  if (!connected || ws.readyState !== 1)
    throw Error("Ingen forbindelse til serveren.");
  ws.send(JSON.stringify(data));
}
function request(data) {
  return new Promise((resolve, reject) => {
    const requestId = ++seq;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(Error("Serveren svarte ikke."));
    }, 5000);
    pending.set(requestId, { resolve, reject, timeout });
    try {
      send({ ...data, requestId });
    } catch (e) {
      clearTimeout(timeout);
      pending.delete(requestId);
      reject(e);
    }
  });
}
function command(action, value) {
  return request({ type: "control", action, value }).catch((e) =>
    toast(e.message),
  );
}
function permitted() {
  return connected && (!state?.lock || state.lock.owner === myId);
}
function current() {
  const p = state?.projects.find((x) => x.id === state.selection.project),
    e = p?.episodes.find((x) => x.id === state.selection.episode),
    s = e?.scripts.find((x) => x.id === state.selection.script);
  return { p, e, s };
}
function position() {
  if (!state) return 0;
  if (!connected) return freezeAt;
  const t = state.transport;
  return Math.max(
    0,
    Math.min(
      maxPosition || 1e7,
      t.position +
        (t.playing && !t.holding
          ? ((performance.now() + clockOffset - t.at) * t.speed) / 1000
          : 0),
    ),
  );
}
function connect() {
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`,
  );
  ws.onopen = () => {
    connected = true;
    retry = 0;
    clockReady = false;
    bestRTT = Infinity;
    lastContact = performance.now();
    send({
      type: "hello",
      identity: browserIdentity,
      name: localStorage.getItem("bk-name") || clientName,
      role: route,
    });
    ping();
    updateConnection();
  };
  ws.onmessage = (event) => {
    lastContact = performance.now();
    let msg = JSON.parse(event.data);
    if (msg.type === "welcome") myId = msg.id;
    if (msg.type === "pong") {
      const rtt = performance.now() - msg.sent;
      if (rtt < bestRTT + 3) {
        bestRTT = Math.min(bestRTT, rtt);
        const next = msg.server - (msg.sent + performance.now()) / 2;
        clockOffset = clockReady ? clockOffset * 0.8 + next * 0.2 : next;
        clockReady = true;
      }
      return;
    }
    if (msg.type === "transport") {
      if (state) {
        state.transport = msg.transport;
        renderOutputStatus();
        for (const el of $$(".play"))
          el.textContent = state.transport.playing ? "Ⅱ Pause" : "▶ Start";
        $("#hold")?.classList.toggle("held", state.transport.holding);
      }
      return;
    }
    if (msg.type === "state") {
      if (!clockReady) clockOffset = msg.state.transport.at - performance.now();
      state = msg.state;
      clients = msg.clients;
      status = msg.status;
      render();
      return;
    }
    if (msg.type === "redirect") {
      const u = new URL(location.href);
      u.port = msg.port;
      setTimeout(() => (location.href = u.href), 700);
      return;
    }
    if (msg.type === "ack" || msg.type === "error") {
      const p = pending.get(msg.requestId);
      if (p) {
        clearTimeout(p.timeout);
        pending.delete(msg.requestId);
        msg.type === "ack" ? p.resolve() : p.reject(Error(msg.message));
      } else if (msg.type === "error") toast(msg.message);
    }
  };
  ws.onclose = () => {
    freezeAt = position();
    connected = false;
    clockReady = false;
    lastLayoutSent = "";
    holdActive = false;
    for (const p of pending.values()) {
      clearTimeout(p.timeout);
      p.reject(Error("Forbindelsen ble brutt."));
    }
    pending.clear();
    updateConnection();
    setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
  };
  ws.onerror = () => ws.close();
}
function ping() {
  if (connected) send({ type: "ping", sent: performance.now() });
}
setInterval(() => {
  ping();
  if (connected && performance.now() - lastContact > 4000) ws.close();
}, 1000);
function editingScript() {
  return current().e?.scripts.find((s) => s.id === selectedEditorId);
}
function openEditor(id) {
  selectedEditorId = id;
  editorId = null;
  dirty = false;
  conflict = false;
  savedRange = null;
  shellKey = "";
  render();
}
function header() {
  return `<header><a class="menu-link" href="/projects" title="Prosjekter og programmer" aria-label="Prosjekter og programmer">▦</a><a class="brand" href="/?editor"><img class="brand-symbol" src="${esc(CONFIG.logoSymbol)}" alt="Bedehuskanalen">${esc(CONFIG.shortName)} <small>${esc(CONFIG.badge)}</small></a><nav>${[
    ["editor", "Editor", "/?editor"],
    ["controller", "Kontroll", "/controller"],
    ["display", "Skjermer", "/display"],
    ["settings", "Innstillinger", "/settings"],
  ]
    .map(
      ([id, label, url]) =>
        `<a href="${url}" class="${route === id ? "active" : ""}">${label}</a>`,
    )
    .join(
      "",
    )}</nav><div class="spacer"></div><a href="/projects" class="global-context" aria-label="Innlastet prosjekt og program"></a><span class="connection"><i class="dot"></i>TILKOBLET</span><div class="clients"><button class="flat avatars" id="clients-toggle" aria-label="Klienter og kontrollås"></button><div class="clients-panel" hidden></div></div></header>`;
}
function preview() {
  return '<div class="preview-box"><div class="stage-viewport"><div class="stage-transform"><div class="stage"><div class="prompt-content"></div></div><div class="guide"></div></div></div></div>';
}
function renderOutputStatus() {
  if (!state) return;
  const { p, e, s } = current();
  for (const button of $$('[data-control="blackout"]')) {
    button.classList.toggle("active", !!state.transport.blackout);
    button.setAttribute("aria-pressed", String(!!state.transport.blackout));
    button.textContent = state.transport.blackout ? "Blackout · På" : "Blackout";
  }
  const wrapper = $(".stage-transform");
  if (!wrapper) return;
  let card = $(".standby-card", wrapper);
  if (!card) {
    card = document.createElement("div");
    card.className = "standby-card";
    wrapper.append(card);
    const black = document.createElement("div");
    black.className = "blackout-cover";
    wrapper.append(black);
  }
  const key = JSON.stringify([p?.name, e?.name, p?.logo]);
  if (card.dataset.key !== key) {
    card.dataset.key = key;
    card.innerHTML = `${p?.logo ? `<img src="${esc(p.logo)}" alt="">` : ""}<strong>${esc(p?.name || "")}</strong><span>${esc(e?.name || "")}</span>`;
  }
  card.hidden = !!s;
  wrapper.classList.toggle("standby", !s);
  wrapper.classList.toggle("blacked-out", !!state.transport.blackout);
}
function transport() {
  return `<button class="blackout-button" data-control="blackout" aria-pressed="false">Blackout</button><div class="transport-row"><button data-control="reset" title="Til starten" aria-label="Til starten">↶</button><button class="primary play" data-control="toggle">▶ Start</button><button data-control="next" title="Neste manus" aria-label="Neste manus">↦</button></div><div class="speed-heading"><div><span class="eyebrow">Hastighet</span><div class="speed-value"><span data-speed contenteditable="true" role="textbox" inputmode="decimal" aria-label="Hastighet, tallverdi">60</span><small>px / sek</small></div></div><div class="speed-step"><button data-step="-${CONFIG.speedStep}" aria-label="Saktere">−</button><button data-step="${CONFIG.speedStep}" aria-label="Raskere">+</button></div></div><input id="speed" aria-label="Hastighet" type="range" min="${CONFIG.speedMin}" max="${CONFIG.speedMax}" step="1"><div class="speed-hints"><span>Oppover</span><span>Nedover</span></div><div class="position-line"><span>Posisjon</span><span id="position-label" contenteditable="true" role="textbox" inputmode="decimal" aria-label="Posisjon, prosent">0 %</span></div><input id="position" aria-label="Posisjon i manus" type="range" min="0" max="1000" step="1"><button class="hold" id="hold">Hold for pause<small>Slipp for å fortsette</small></button>`;
}
function build() {
  if (route === "output") {
    document.body.classList.add("output");
    $("#app").innerHTML =
      `${preview()}<div class="output-warning" hidden>Frakoblet — avspilling fryst</div>`;
  } else {
    let body = "";
    if (route === "editor")
      body = `<div class="program-strip"><a href="/projects" class="program-exit">← Prosjekter</a><span id="breadcrumb"><span class="breadcrumb-project"></span><span class="breadcrumb-program"></span></span><span class="spacer"></span><span class="eyebrow">PROGRAM INNLASTET</span></div><main class="workspace rundown-workspace"><aside class="live-sidebar"><div class="live-rail"><button id="toggle-live" class="flat" aria-label="Skjul livevisning" aria-expanded="true">‹</button></div><div class="live-body"><div class="section-title"><span class="live-badge pane-live">● LIVE</span></div><h2 id="live-title"></h2>${preview()}<div class="preview-label"><span>FELLES UTGANG</span><a href="/output" target="_blank">Åpne utgang ↗</a></div>${transport()}<div class="control-divider"></div><div class="section-title"><span class="eyebrow">Kapitler</span><button data-control="chapter" title="Neste kapittel">↦</button></div><div class="chapter-list"></div><div class="keyboard-hint">Mellomrom: start / pause · ↑ ↓: hastighet</div></div></aside><section class="rundown-pane"><div class="rundown-heading"><div><span class="eyebrow">Kjøreplan</span><h1 id="program-title">Manus</h1></div><span id="script-count" class="count-badge"></span></div><div class="rundown-tools"><button class="primary" data-create="Script">+ Nytt manus</button><button id="import">↥ Importer</button><input type="file" id="file" accept=".docx,.txt,.rtf,.md,.html,.htm" hidden></div><div class="script-list"></div><div class="rundown-footer"><span>Trykk på en blokk for å redigere</span><span class="version-label"></span></div></section><section class="editor-pane no-selection"><div class="inspector-heading"><div><span class="eyebrow">Redigering</span><h2 id="editing-title">Velg et manus</h2></div><button id="close-editor" class="flat" aria-label="Lukk redigering">×</button></div><div class="editor-empty"><span class="empty-icon">≡</span><h3>Ingen manus valgt</h3><p>Trykk på en manusblokk for å redigere.<br>Den innlastede teksten fortsetter på prompteren.</p></div><div class="editor-content"><div class="script-meta"><label for="script-name">TITTEL</label><input id="script-name" aria-label="Manusnavn" placeholder="Gi manuset en tittel"><div class="metadata-row"><div><label for="osc-id">OSC-ID</label><input id="osc-id" placeholder="intro" aria-label="OSC-ID"></div><div><label for="script-color">BLOKKFARGE</label><div class="color-options"><input id="script-color" type="color" aria-label="Blokkfarge" value="#32c6cb">${CONFIG.scriptColors.map((c) => `<button class="color-swatch" data-color="${c}" style="--swatch:${c}" aria-label="Velg farge ${c}"></button>`).join("")}</div></div></div></div>${scriptSettingsPanel()}<div class="toolbar"><select id="block-format" aria-label="Teksttype"><option value="p">Normal tekst</option><option value="h1">Tittel</option><option value="h3">Undertittel</option></select><span class="separator"></span><button data-format="bold" title="Fet"><b>B</b></button><button data-format="italic" title="Kursiv"><i>I</i></button><button data-format="underline" title="Understrek"><u>U</u></button><label title="Tekstfarge">A <input type="color" id="text-color" value="#ffffff" aria-label="Tekstfarge"></label><label title="Uthevingsfarge">▰ <input type="color" id="highlight" value="#e34f54" aria-label="Uthevingsfarge"></label><button id="remove-highlight" title="Fjern uthevingsfarge">▱</button><button data-format="removeFormat" title="Fjern formatering">Tx</button></div><div class="chapter-tools"><button id="add-chapter">+ Legg til kapittel</button><span>Settes inn ved tekstmarkøren</span></div><div id="editor-chapters"></div><div id="editor" contenteditable="true" role="textbox" aria-label="Manustekst" aria-multiline="true" spellcheck="true"></div><div class="editor-bottom"><span id="word-count"></span><button id="discard-draft" class="flat" style="font-size:11px;padding:0">Reset tekst</button><button id="clear-text" class="flat danger">Tøm tekst</button></div><div class="publish-bar"><div><span class="save-status">Lagret og synkronisert</span><small>Bare teksten venter på oppdatering.</small></div><button class="primary publish" id="save">Oppdater manus</button></div></div></section></main>`;
    else if (route === "projects")
      body = `<main class="project-menu"><div class="menu-heading"><div><img id="menu-logo" class="project-logo" alt="Prosjektlogo" hidden><h1 id="menu-title">Prosjekter</h1></div><button class="primary" id="menu-create" data-create="Project">+ Nytt prosjekt</button></div><div class="menu-breadcrumb"><button id="menu-back" class="back-button" hidden>← Alle prosjekter</button></div><div class="project-grid"></div></main>`;
    else if (route === "controller")
      body = `<main class="mobile-control"><span class="eyebrow">Fjernkontroll</span><h1 id="controller-title">Prompter</h1><span class="muted" id="controller-program"></span>${preview()}${transport()}<div class="control-divider"></div><div class="transport-row"><button data-control="previous">← Forrige manus</button><button data-control="chapter">Neste kapittel →</button></div><div class="chapter-list" style="margin-top:20px"></div><a class="mobile-editor-link" href="/?editor">Åpne manusredigering →</a><a class="mobile-editor-link" href="/display">Skjermer →</a></main>`;
    else if (route === "display") body = displayWorkspace();
    else body = settingsWorkspace();
    $("#app").innerHTML = header() + body;
  }
  ruler = document.createElement("div");
  ruler.className = "ruler prompt-content";
  document.body.append(ruler);
  viewport = $(".stage-viewport");
  stage = $(".stage");
  content = stage ? $(".prompt-content", stage) : null;
  guide = $(".guide");
  bind();
}
function rangeField(id, label, min, max, step) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" data-setting="${id}"><output for="${id}" contenteditable="true" role="textbox" inputmode="decimal" aria-label="${label}, tallverdi" data-number-setting="${id}"></output></div>`;
}
function checkField(id, label) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="checkbox" data-setting="${id}"></div>`;
}
function guideOptionDisabled(el) {
  return !!el.closest("#guide-options") && (!state || !visualSettings().guide);
}
function updateConnection() {
  $("#guide-options")?.classList.toggle("options-disabled", !state || !visualSettings().guide);

  for (const el of $$('[data-number-setting], [data-speed], #position-label')) {
    const enabled = connected && (!state?.lock || state.lock.owner === myId) && (!el.dataset.numberSetting || !displayFieldsLocked()) && !guideOptionDisabled(el);
    el.contentEditable = String(enabled);
    el.setAttribute("aria-disabled", String(!enabled));
  }

  for (const el of $$(".connection")) {
    el.classList.toggle("offline", !connected);
    el.innerHTML = `<i class="dot"></i>${connected ? (state?.lock ? "KONTROLL LÅST" : "TILKOBLET") : "KOBLER TIL …"}`;
  }
  if ($(".output-warning")) {
    const missing = connected && state && !outputScreen();
    $(".output-warning").hidden = connected && !missing;
    $(".output-warning").textContent = missing
      ? "Skjerm-ID finnes ikke. Velg en skjerm i Skjermer."
      : "Frakoblet — avspilling fryst";
    if (stage) stage.style.visibility = missing ? "hidden" : "visible";
  }
  for (const el of $$(
    "[data-control],[data-step],#speed,#position,#hold,[data-setting],#save-network",
  ))
    el.disabled =
      !permitted() ||
      (el.hasAttribute("data-setting") && displayFieldsLocked()) || guideOptionDisabled(el);
  if ($("#editor"))
    $("#editor").contentEditable = String(permitted() && !!editingScript());
}
function render() {
  if (!state) return;
  const { p, e, s } = current();
  renderOutputStatus();
  if ($(".global-context"))
    $(".global-context").textContent =
      [p?.name, e?.name].filter(Boolean).join(" / ") ||
      "Ingen program innlastet";
  document.title = [CONFIG.name, p?.name, e?.name].filter(Boolean).join(" · ");
  const nextContext = `${p?.id}/${e?.id}`;
  if (route === "editor" && programContext !== nextContext) {
    programContext = nextContext;
    selectedEditorId = null;
    editorId = null;
    dirty = false;
    conflict = false;
  }
  if (route === "projects") renderMenu();
  if (route === "editor") {
    $(".breadcrumb-project").textContent = p?.name || "Prosjekt";
    $(".breadcrumb-program").textContent = e?.name || "Velg program";
    $("#program-title").textContent = e?.name || "Velg et program";
    $("#live-title").textContent = s?.name || "Ingen manus innlastet";
    $("#script-count").textContent = String(e?.scripts.length || 0).padStart(
      2,
      "0",
    );
    const key = JSON.stringify([
      e?.scripts,
      selectedEditorId,
      state.selection.script,
    ]);
    if (key !== shellKey) {
      shellKey = key;
      renderRundown(e);
    }
  }
  if (route === "editor") {
    const s = editingScript();
    $(".editor-pane").classList.toggle("no-selection", !s);
    $("#editing-title").textContent = s?.name || "Velg et manus";
    if (!s) selectedEditorId = null;
    if (editorId !== s?.id) {
      editorId = s?.id;
      editorVersion = s?.version || 0;
      dirty = false;
      conflict = false;
      clearTimeout(saveTimer);
      $("#editor").innerHTML =
        s?.html || "<p>Opprett et prosjekt, program og manus for å starte.</p>";
      $("#script-name").value = s?.name || "";
      $("#osc-id").value = s?.oscId || "";
      $("#script-color").value = s?.color || CONFIG.scriptColors[0];
      setScriptSettings(s);
      $("#editor").scrollTop = 0;
      savedRange = null;
    } else if (s && s.version !== editorVersion && !saving) {
      if (!dirty) {
        editorVersion = s.version;
        $("#editor").innerHTML = s.html;
        $("#script-name").value = s.name;
        $("#osc-id").value = s.oscId;
        $("#script-color").value = s.color || CONFIG.scriptColors[0];
        setScriptSettings(s);
      } else conflict = true;
    }
    syncMetadata(s);
    renderEditorChapters();
    $(".save-status").textContent = conflict
      ? "Konflikt · kopier utkast"
      : saving
        ? "Lagrer …"
        : dirty
          ? "Lokale endringer · ikke sendt"
          : "Lagret og synkronisert";
    $("#word-count").textContent =
      `${($("#editor").textContent.trim().match(/\S+/g) || []).length} ord`;
  }
  if (route === "controller") {
    $("#controller-title").textContent = s?.name || "Ingen manus valgt";
    $("#controller-program").textContent =
      e?.name || "Velg program i manusrommet";
  }
  renderPresetOptions();
  if (route === "display") renderDisplayWorkspace();
  if (route === "display")
    for (const el of $$("[data-setting]")) {
      if (document.activeElement !== el) {
        if (el.type === "checkbox")
          el.checked = visualSettings()[el.dataset.setting];
        else el.value = visualSettings()[el.dataset.setting];
      }
      let o = $(`output[for="${el.id}"]`);
      if (o && document.activeElement !== o) o.textContent = visualSettings()[el.dataset.setting];
    }
  if (route === "settings") {
    renderSystemSettings();
    if (document.activeElement !== $("#osc-port"))
      $("#osc-port").value = state.network.oscPort;
    if (document.activeElement !== $("#osc-enabled"))
      $("#osc-enabled").checked = state.network.oscEnabled;
    $("#osc-status").textContent = status.oscStatus;
    $("#network-addresses").innerHTML = status.interfaces
      .map(
        (n) =>
          `<p><span class="muted">${esc(n.name)}</span><br><a href="${esc(n.url)}">${esc(n.url)}</a></p>`,
      )
      .join("");
  }
  for (let el of $$(".version-label"))
    el.textContent = `BK Prompter v${status.version}`;
  updateClients();
  updateConnection();
  updateLayout();
  reportLayout();
  for (const el of $$("[data-speed]")) if (document.activeElement !== el) el.textContent = state.transport.speed;
  for (const el of $$(".play"))
    el.textContent = state.transport.playing ? "Ⅱ Pause" : "▶ Start";
  if ($("#speed") && document.activeElement !== $("#speed"))
    $("#speed").value = state.transport.speed;
  $("#hold")?.classList.toggle("held", state.transport.holding);
}
function scriptSettingsPanel() {
  const numeric = [
    ["fontSize", "Skriftstørrelse", 20, 120, 1],
    ["lineHeight", "Linjeavstand", 0.5, 2.5, 0.05],
    ["margin", "Sidemarger", 20, 400, 10],
    ["guidePosition", "Lesepunkt (%)", 5, 80, 1],
  ];
  return `<details class="script-display-panel"><summary>Prompter ved innlasting <span id="script-display-summary">Behold gjeldende</span></summary><div class="script-display-body"><label for="script-display-mode">NÅR DETTE MANUSET LASTES</label><select id="script-display-mode"><option value="keep">Behold gjeldende innstillinger</option><option value="preset">Bruk forhåndsinnstilling</option><option value="custom">Egne innstillinger for dette manuset</option></select><div id="script-preset-row" hidden><label for="script-preset">FORHÅNDSINNSTILLING</label><select id="script-preset"></select><a href="/display" target="_blank">Administrer forhåndsinnstillinger ↗</a></div><div id="script-custom-row" hidden><p>Gjelder bare dette manuset. Ingen forhåndsinnstilling opprettes.</p><div class="custom-grid">${numeric.map(([id, label, min, max, step]) => `<label>${label}<input type="number" data-custom-setting="${id}" min="${min}" max="${max}" step="${step}" aria-label="Egen ${label.toLowerCase()}"></label>`).join("")}<label>Tekstfarge<input type="color" data-custom-setting="color" aria-label="Egen tekstfarge"></label><label>Bakgrunn<input type="color" data-custom-setting="background" aria-label="Egen bakgrunn"></label><label>Justering<select data-custom-setting="align"><option value="left">Venstre</option><option value="center">Midtstilt</option><option value="right">Høyre</option></select></label>${[
    ["guide", "Vis lesemarkør"],
  ]
    .map(
      ([id, label]) =>
        `<label class="custom-check"><input type="checkbox" data-custom-setting="${id}">${label}</label>`,
    )
    .join(
      "",
    )}</div></div><p class="script-display-hint">Brukes ved «Last inn», neste manus og OSC. Valget lagres automatisk.</p></div></details>`;
}
function readScriptSettings() {
  return {
    displayMode: $("#script-display-mode").value,
    presetId:
      $("#script-display-mode").value === "preset"
        ? $("#script-preset").value
        : null,
    customSettings:
      $("#script-display-mode").value === "custom" ? { ...customDraft } : null,
  };
}
function toggleScriptSettings() {
  const mode = $("#script-display-mode").value;
  $("#script-preset-row").hidden = mode !== "preset";
  $("#script-custom-row").hidden = mode !== "custom";
  $("#script-display-summary").textContent = {
    keep: "Behold gjeldende",
    preset: "Forhåndsinnstilling",
    custom: "Egne innstillinger",
  }[mode];
}
function setScriptSettings(script) {
  if (!$("#script-display-mode")) return;
  renderPresetOptions(true);
  $("#script-display-mode").value = script?.displayMode || "keep";
  $("#script-preset").value = script?.presetId || "";
  customDraft = {
    ...settingsForScreen(state.screens.find((s) => s.id === "1")),
    ...script?.customSettings,
  };
  for (const input of $$("[data-custom-setting]")) {
    const value = customDraft[input.dataset.customSetting];
    if (input.type === "checkbox") input.checked = !!value;
    else input.value = value;
  }
  toggleScriptSettings();
}
function renderPresetOptions(force = false) {
  const key = JSON.stringify(state.displayPresets || []);
  if (!force && key === presetListKey) return;
  presetListKey = key;
  for (const select of [$("#script-preset"), $("#display-preset")].filter(
    Boolean,
  )) {
    const selected = select.value;
    select.innerHTML =
      '<option value="">Velg forhåndsinnstilling</option>' +
      (state.displayPresets || [])
        .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
        .join("");
    select.value = selected;
  }
}
function scriptSummary(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const block of template.content.querySelectorAll("p,div,h1,h2,h3,li,br"))
    block.append(document.createTextNode(" "));
  const text = (template.content.textContent || "").replace(/\s+/g, " ").trim();
  return { text, words: (text.match(/\S+/g) || []).length };
}
function renderRundown(episode) {
  $(".script-list").innerHTML =
    (episode?.scripts || [])
      .map((script, i) => {
        const summary = scriptSummary(script.html),
          live = script.id === state.selection.script,
          selected = script.id === selectedEditorId;
        const color = /^#[0-9a-f]{6}$/i.test(script.color)
          ? script.color
          : CONFIG.scriptColors[0];
        return `${insertionSlot(script.id, i)}<article data-script-card="${script.id}" class="script-card ${selected ? "selected" : ""} ${live ? "on-air" : ""}" style="--script-color:${color}"><div class="script-order"><span>${String(i + 1).padStart(2, "0")}</span><span class="order-line"></span><button data-move="-1" data-id="${script.id}" aria-label="Flytt ${esc(script.name)} opp" ${i === 0 ? "disabled" : ""}>↑</button><button data-move="1" data-id="${script.id}" aria-label="Flytt ${esc(script.name)} ned" ${i === episode.scripts.length - 1 ? "disabled" : ""}>↓</button></div><div class="script-block-main"><button class="script-open" data-script="${script.id}" aria-pressed="${selected}"><div class="script-block-top"><span>${script.oscId ? `<span class="osc-chip">ID / ${esc(script.oscId)}</span>` : ""}</span><span class="script-state ${live ? "live-badge" : ""}">${live ? "● LIVE" : selected ? "REDIGERER" : "MANUS"}</span></div><h2>${esc(script.name)}</h2><p>${esc(summary.text.slice(0, 100))}${summary.text.length > 100 ? "…" : ""}</p></button><div class="script-block-bottom"><span>${summary.words} ord · ${{ keep: "Behold visning", preset: "Forhåndsinnstilling", custom: "Egen visning" }[script.displayMode || "keep"]}</span><span class="spacer"></span><button data-delete="${script.id}" class="flat" aria-label="Slett ${esc(script.name)}">${trashIcon()}</button><button data-load="${script.id}" class="load-script" title="Last på prompteren fra start">${loadIcon()} Last inn</button></div></div></article>`;
      })
      .join("") +
      (episode?.scripts.length
        ? insertionSlot("", episode.scripts.length)
        : "") ||
    `<div class="rundown-empty"><span class="empty-icon">≡</span><h2>${episode ? "Ingen manus" : "Ingen program innlastet"}</h2><p>${episode ? "Legg til et manus eller importer en fil for å komme i gang." : "Gå til prosjektmenyen og velg et program."}</p>${episode ? '<button class="primary" data-create="Script">+ Nytt manus</button>' : '<a href="/projects">Velg program →</a>'}</div>`;
}
function updateClients() {
  let toggle = $("#clients-toggle");
  if (!toggle) return;
  const me = clients.find((c) => c.id === myId),
    others = clients.filter((c) => c.id !== myId);
  toggle.innerHTML = `<span class="other-avatars">${others
    .slice(0, 4)
    .map(
      (c) =>
        `<span title="${esc(c.name)} · ${c.windows || 1} vinduer" class="avatar">${esc(c.name.slice(0, 2).toUpperCase())}</span>`,
    )
    .join(
      "",
    )}${others.length > 4 ? `<small>+${others.length - 4}</small>` : ""}</span><span class="self-avatar" title="${esc(me?.name || clientName)}"><span class="avatar">${esc((me?.name || clientName).slice(0, 2).toUpperCase())}</span><small>DEG</small></span>`;
  const panel = $(".clients-panel");
  const key = JSON.stringify([clients, state.lock]);
  if (panel.dataset.key === key) return;
  panel.dataset.key = key;
  panel.innerHTML = `<form id="client-name-form"><label for="client-name">Ditt klientnavn</label><div class="client-name-row"><input id="client-name" maxlength="80" value="${esc(clients.find((c) => c.id === myId)?.name || clientName)}"><button>Lagre</button></div></form><div class="eyebrow">Tilkoblede klienter</div>${[...clients, { id: "osc", name: "OSC · Automatisering", role: "osc" }].map((c) => `<div class="client-row"><span>${esc(c.name)}${c.id === myId ? " (deg)" : ""}<br><small class="muted">${esc(c.roles?.join(" · ") || c.role)}${c.windows ? ` · ${c.windows} vinduer` : ""}</small></span><button data-lock="${esc(c.id)}">${state.lock?.owner === c.id ? "🔒 Låst" : "Gi kontroll"}</button></div>`).join("")}<button data-lock="" style="width:100%">Frigi til alle</button>`;
}
function applyStyle(el, c = visualSettings()) {
  Object.assign(el.style, {
    fontSize: c.fontSize + "px",
    lineHeight: c.lineHeight,
    padding: `0 ${c.margin}px`,
    color: c.color,
    textAlign: c.align,
  });
}
function updateLayout() {
  if (!fontsReady) return;
  const { s } = current(),
    key = JSON.stringify([
      s?.id,
      s?.version,
      state.settings,
      visualSettings(),
      route === "output" ? outputScreen() : null,
    ]);
  if (key === layoutKey) return;
  layoutKey = key;
  ruler.style.width = CONFIG.logicalWidth + "px";
  ruler.innerHTML = s?.html || "";
  applyStyle(ruler, state.settings);
  if (content) {
    stage.style.width = CONFIG.logicalWidth + "px";
    content.style.width = CONFIG.logicalWidth + "px";
    content.innerHTML = s?.html || "";
    applyStyle(content);
    viewport.style.background = visualSettings().background;
    $(".stage-transform").style.transform =
      `scale(${route === "output" && outputScreen()?.mirror ? -1 : 1},${route === "output" && outputScreen()?.flip ? -1 : 1})`;
    guide.style.display = visualSettings().guide ? "" : "none";
    guide.style.top = visualSettings().guidePosition + "%";
    guide.style.setProperty("--guide-thickness", (visualSettings().guideThickness ?? 1) + "px");
    guide.style.setProperty("--guide-size", (visualSettings().guideSize ?? 10) + "px");
    const lineColor = visualSettings().guideLineColor || "#32c6cb";
    const channels = [1, 3, 5].map(i => parseInt(lineColor.slice(i, i + 2), 16));
    guide.style.setProperty("--guide-line-color", `rgba(${channels.join(",")}, ${(visualSettings().guideOpacity ?? 20) / 100})`);
    guide.style.setProperty("--guide-color", visualSettings().guideColor || "#32c6cb");
  }
  maxPosition = Math.max(0, ruler.getBoundingClientRect().height);
  buildDisplayPositionMap();
  chapters = $$("h2", ruler).map((el) => ({
    name: el.textContent,
    position: Math.max(0, el.offsetTop),
  }));
  for (let list of $$(".chapter-list"))
    list.innerHTML =
      chapters
        .map(
          (c, i) =>
            `<button data-chapter="${i}"><span class="muted">${String(i + 1).padStart(2, "0")}　</span>${esc(c.name)}</button>`,
        )
        .join("") || '<span class="muted">Ingen kapitler ennå</span>';
  reportLayout();
}
function reportLayout() {
  const { s } = current();
  if (!s || !fontsReady || !connected || lastLayoutSent === layoutKey) return;
  lastLayoutSent = layoutKey;
  send({
    type: "layout",
    script: s.id,
    version: s.version,
    key: JSON.stringify(state.settings),
    max: maxPosition,
    chapters: chapters.map((c) => c.position),
  });
}
function animate() {
  if (state) {
    let p = position();
    if (stage && viewport) {
      const width = viewport.clientWidth,
        height = viewport.clientHeight;
      stage.style.transform = `translate3d(0,${(height * visualSettings().guidePosition) / 100 - (displayPosition(p) * width) / CONFIG.logicalWidth}px,0) scale(${width / CONFIG.logicalWidth})`;
    }
    if ($("#position") && document.activeElement !== $("#position"))
      $("#position").value = maxPosition ? (p / maxPosition) * 1000 : 0;
    if ($("#position-label") && document.activeElement !== $("#position-label"))
      $("#position-label").textContent =
        `${Math.round(maxPosition ? (p / maxPosition) * 100 : 0)} %`;
  }
  requestAnimationFrame(animate);
}
async function saveDraft() {
  if (draftPromise) await draftPromise;
  if (!dirty) return;
  draftPromise = persistDraft();
  try {
    await draftPromise;
  } finally {
    draftPromise = null;
  }
}
async function persistDraft() {
  if (!dirty || saving || !editorId) return;
  if (conflict)
    throw Error(
      "En annen klient har endret manuset. Kopier utkastet før du laster siden på nytt.",
    );
  saving = true;
  const id = editorId,
    version = editorVersion,
    html = $("#editor").innerHTML;
  try {
    await request({
      type: "edit",
      action: "saveText",
      id,
      version,
      html,
    });
    if (editorId === id) {
      editorVersion = version + 1;
      dirty = $("#editor").innerHTML !== html;
    }
  } catch (e) {
    if (editorId === id && editingScript()?.version !== version)
      conflict = true;
    throw e;
  } finally {
    saving = false;
    render();
  }
}
function markDirty() {
  renderEditorChapters();
  dirty = true;
  $(".save-status").textContent = "Lokale endringer · ikke sendt";
  clearTimeout(saveTimer);
}
async function edit(data) {
  try {
    const creates = data.action.startsWith("create");
    const beforeProjects = state.projects.map((x) => x.id);
    const beforeScripts = current().e?.scripts.map((x) => x.id) || [];
    await request({
      type: "edit",
      ...data,
      ...(creates ? { background: true } : {}),
      ...(data.action === "createEpisode" ? { projectId: menuProjectId } : {}),
    });
    if (data.action === "createProject") {
      menuProjectId = state.projects.find(
        (x) => !beforeProjects.includes(x.id),
      )?.id;
      menuKey = "";
      renderMenu();
    }
    if (data.action === "createScript") {
      openEditor(
        current().e?.scripts.find((x) => !beforeScripts.includes(x.id))?.id,
      );
    }
  } catch (e) {
    toast(e.message);
  }
}
function nameDialog(kind, beforeId) {
  if (kind !== "Script") return organizationDialog(kind);
  const labels = { Project: "prosjekt", Episode: "program", Script: "manus" };
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<form><h2>Nytt ${labels[kind]}</h2><label for="new-name">Navn</label><input id="new-name" required maxlength="120" autofocus placeholder="Gi ${labels[kind]}et et navn"><div class="dialog-actions"><button type="button" data-cancel>Avbryt</button><button class="primary">Opprett</button></div></form>`;
  document.body.append(dialog);
  dialog.showModal();
  $("[data-cancel]", dialog).onclick = () => dialog.close();
  $("form", dialog).onsubmit = (event) => {
    event.preventDefault();
    edit({ action: "create" + kind, name: $("input", dialog).value, beforeId });
    dialog.close();
  };
  dialog.onclose = () => dialog.remove();
}
let savedRange;
function rememberRange() {
  const sel = getSelection();
  if (sel.rangeCount && $("#editor")?.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
    syncSelectionColors(sel);
  }
}
function format(cmd, value) {
  $("#editor").focus();
  if (savedRange) {
    let sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  document.execCommand("styleWithCSS", false, true);
  document.execCommand(cmd, false, value);
  rememberRange();
  markDirty();
}
function bind() {
  for (const el of $$('[data-number-setting], [data-speed], #position-label')) {
    el.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); el.blur(); }
      if (event.key === "Escape") { event.preventDefault(); el.dataset.cancel = "1"; el.blur(); }
    });
    el.addEventListener("blur", () => {
      const value = Number(el.textContent.replace("%", "").replace(",", ".").trim());
      const allowed = connected && (!state.lock || state.lock.owner === myId);
      if (!el.dataset.cancel && allowed && Number.isFinite(value)) {
        if (el.dataset.numberSetting && !displayFieldsLocked() && !guideOptionDisabled(el)) {
          const slider = document.getElementById(el.dataset.numberSetting);
          if (value >= Number(slider.min) && value <= Number(slider.max)) {
            slider.value = value;
            slider.dispatchEvent(new Event("input"));
          } else toast("Verdien må være mellom " + slider.min + " og " + slider.max);
        } else if (el.hasAttribute("data-speed") && Math.abs(value) <= 500) command("speed", value);
        else if (el.id === "position-label" && value >= 0 && value <= 100) command("seek", maxPosition * value / 100);
      }
      delete el.dataset.cancel;
      render();
    });
  }

  document.addEventListener("selectionchange", rememberRange);
  document.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) {
      const card = event.target.closest("[data-script-card]");
      if (card && !event.target.closest("a,input,select,textarea"))
        openEditor(card.dataset.scriptCard);
      return;
    }
    if (b.dataset.control) command(b.dataset.control);
    if (b.dataset.step)
      command(
        "speed",
        Math.max(
          -500,
          Math.min(500, state.transport.speed + Number(b.dataset.step)),
        ),
      );
    if (b.dataset.create) nameDialog(b.dataset.create);
    if (b.dataset.script) openEditor(b.dataset.script);
    if (b.dataset.load) command("load", b.dataset.load);
    if (b.dataset.color) {
      $("#script-color").value = b.dataset.color;
      saveMetadata({ color: b.dataset.color });
    }
    if (b.dataset.project) {
      menuProjectId = b.dataset.project;
      menuKey = "";
      renderMenu();
    }
    if (b.dataset.program)
      request({
        type: "edit",
        action: "loadProgram",
        projectId: menuProjectId,
        episodeId: b.dataset.program,
      })
        .then(() => (location.href = "/?editor"))
        .catch((e) => toast(e.message));
    if (b.dataset.delete)
      confirmGUI(
        "Slette dette manuset?",
        "Manuset fjernes fra programmet. Dette kan ikke angres.",
        () => edit({ action: "deleteScript", id: b.dataset.delete }),
        b,
      );
    if (b.dataset.chapter)
      command("seek", chapters[Number(b.dataset.chapter)].position);
    if (b.dataset.lock !== undefined)
      request({ type: "lock", owner: b.dataset.lock || null }).catch((e) =>
        toast(e.message),
      );
    if (b.dataset.move)
      edit({
        action: "moveScript",
        id: b.dataset.id || editorId,
        direction: Number(b.dataset.move),
      });
    if (b.dataset.format) format(b.dataset.format);
  });
  $("#script-display-mode")?.addEventListener("change", () => {
    toggleScriptSettings();
    saveDisplayMetadata();
  });
  $("#script-preset")?.addEventListener("change", saveDisplayMetadata);
  for (const input of $$("[data-custom-setting]"))
    input.addEventListener("input", () => {
      customDraft[input.dataset.customSetting] =
        input.type === "checkbox"
          ? input.checked
          : input.type === "number"
            ? Number(input.value)
            : input.value;
      saveDisplayMetadata();
    });
  $("#save-preset")?.addEventListener("click", async () => {
    try {
      await request({
        type: "edit",
        action: "savePreset",
        name: $("#preset-name").value,
        value: visualSettings(),
      });
      $("#preset-name").value = "";
      toast("Forhåndsinnstillingen er lagret.");
    } catch (e) {
      toast(e.message);
    }
  });
  $("#apply-preset")?.addEventListener("click", () =>
    request({
      type: "edit",
      action: "applyPreset",
      id: displayPresetId,
      screenId: selectedScreenId,
    }).catch((e) => toast(e.message)),
  );
  $("#delete-preset")?.addEventListener("click", () => {
    confirmGUI(
      "Slette forhåndsinnstillingen?",
      "Oppsettet fjernes fra biblioteket.",
      () =>
        request({
          type: "edit",
          action: "deletePreset",
          id: displayPresetId,
        }).catch((e) => toast(e.message)),
    );
  });
  $("#close-editor")?.addEventListener("click", () => openEditor(null));
  $("#menu-back")?.addEventListener("click", () => {
    menuProjectId = null;
    menuKey = "";
    renderMenu();
  });
  const sidebarCollapsed = localStorage.getItem("bk-live-collapsed") === "true";
  function setSidebar(collapsed) {
    $(".rundown-workspace")?.classList.toggle("live-collapsed", collapsed);
    const b = $("#toggle-live");
    if (b) {
      b.textContent = collapsed ? "›" : "‹";
      b.setAttribute("aria-expanded", String(!collapsed));
      b.setAttribute(
        "aria-label",
        collapsed ? "Vis livevisning" : "Skjul livevisning",
      );
    }
  }
  setSidebar(sidebarCollapsed);
  $("#toggle-live")?.addEventListener("click", () => {
    const collapsed =
      !$(".rundown-workspace").classList.contains("live-collapsed");
    setSidebar(collapsed);
    localStorage.setItem("bk-live-collapsed", String(collapsed));
  });
  $("#clients-toggle")?.addEventListener(
    "click",
    () => ($(".clients-panel").hidden = !$(".clients-panel").hidden),
  );
  $("#project")?.addEventListener("change", (event) =>
    edit({ action: "selectProject", id: event.target.value }),
  );
  $("#episode")?.addEventListener("change", (event) =>
    edit({ action: "selectEpisode", id: event.target.value }),
  );
  $("#editor")?.addEventListener("input", markDirty);
  for (const [selector, key] of [
    ["#script-name", "name"],
    ["#osc-id", "oscId"],
    ["#script-color", "color"],
  ])
    $(selector)?.addEventListener("input", (event) =>
      saveMetadata({ [key]: event.target.value }),
    );
  bindWorkspace();
  bindSystemSettings();
  $("#editor")?.addEventListener("paste", (event) => {
    event.preventDefault();
    format("insertText", event.clipboardData.getData("text/plain"));
  });
  $("#discard-draft")?.addEventListener("click", () => {
    dirty = false;
    conflict = false;
    editorId = null;
    render();
  });
  $("#save")?.addEventListener("click", async () => {
    try {
      await saveDraft();
      toast("Manuset er oppdatert på alle skjermer.");
    } catch (e) {
      toast(e.message);
    }
  });
  for (let el of $$("[data-format]"))
    el.addEventListener("pointerdown", (e) => e.preventDefault());
  $("#block-format")?.addEventListener("change", (event) =>
    format("formatBlock", event.target.value),
  );
  $("#text-color")?.addEventListener("input", (event) =>
    format("foreColor", event.target.value),
  );
  $("#highlight")?.addEventListener("input", (event) =>
    format("hiliteColor", event.target.value),
  );
  $("#speed")?.addEventListener("input", (event) =>
    command("speed", Number(event.target.value)),
  );
  $("#position")?.addEventListener("input", (event) =>
    command("seek", (Number(event.target.value) / 1000) * maxPosition),
  );
  const hold = $("#hold");
  if (hold) {
    hold.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (!permitted()) return;
      hold.setPointerCapture(event.pointerId);
      holdActive = true;
      command("hold");
    });
    for (let ev of ["pointerup", "pointercancel", "lostpointercapture"])
      hold.addEventListener(ev, releaseHold);
    hold.addEventListener("keydown", (event) => {
      if ([" ", "Enter"].includes(event.key)) {
        event.preventDefault();
        if (!holdActive) {
          holdActive = true;
          command("hold");
        }
      }
    });
    hold.addEventListener("keyup", releaseHold);
    hold.addEventListener("contextmenu", (event) => event.preventDefault());
  }
  window.addEventListener("blur", releaseHold);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseHold();
    else {
      ping();
      bestRTT = Infinity;
    }
  });
  setInterval(() => {
    if (holdActive && connected) command("hold");
  }, 650);
  for (let el of $$("[data-setting]"))
    el.addEventListener("input", () => {
      if (el.disabled) return;
      const value =
        el.type === "checkbox"
          ? el.checked
          : el.type === "range"
            ? Number(el.value)
            : el.value;
      request({
        type: "edit",
        action:
          route === "display" && displayPresetId
            ? "updatePreset"
            : "screenSettings",
        id: displayPresetId,
        screenId: selectedScreenId,
        value: { [el.dataset.setting]: value },
      }).catch((e) => toast(e.message));
    });
  $("#save-network")?.addEventListener("click", async () => {
    try {
      await request({
        type: "network",
        oscEnabled: $("#osc-enabled").checked,
        oscPort: Number($("#osc-port").value),
      });
      toast("OSC-oppsettet er lagret.");
    } catch (e) {
      toast(e.message);
    }
  });
  $("#import-projects")?.addEventListener("click", () =>
    $("#project-file").click(),
  );
  $("#project-file")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 15000000) throw Error("Maksimal filstørrelse er 15 MB.");
      const value = JSON.parse(await file.text());
      await request({ type: "edit", action: "importProjects", value });
      toast("Prosjektene er importert som nye kopier.");
    } catch (e) {
      toast(e.message);
    }
    event.target.value = "";
  });
  $("#import")?.addEventListener("click", () => {
    if (!current().e) {
      toast("Opprett et program først.");
      return;
    }
    $("#file").click();
  });
  $("#file")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    try {
      const res = await fetch("/api/import", { method: "POST", body: data });
      const result = await res.json();
      if (!res.ok) throw Error(result.error);
      await edit({
        action: "createScript",
        name: result.name,
        html: result.html,
      });
    } catch (e) {
      toast(e.message);
    }
    event.target.value = "";
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.target.closest("input,select,button,[contenteditable=true],dialog")
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      command("toggle");
    }
    if (event.code === "ArrowUp") {
      event.preventDefault();
      command("speed", Math.min(500, state.transport.speed + CONFIG.speedStep));
    }
    if (event.code === "ArrowDown") {
      event.preventDefault();
      command(
        "speed",
        Math.max(-500, state.transport.speed - CONFIG.speedStep),
      );
    }
    if (event.code === "Home") command("reset");
  });
  if (route === "output") {
    document.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (permitted())
          command(
            "seek",
            position() +
              (event.deltaY * CONFIG.logicalWidth) / window.innerWidth,
          );
      },
      { passive: false },
    );
  }
  if (route === "output")
    document.addEventListener("dblclick", () => {
      if (!document.fullscreenElement)
        document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.();
    });
}
function releaseHold() {
  if (holdActive) {
    holdActive = false;
    if (connected) command("release");
  }
}
build();
Promise.all(
  [500, 600, 750].map((weight) =>
    document.fonts.load(`${weight} 56px Prompter`),
  ),
).then(() => {
  fontsReady = true;
  layoutKey = "";
  if (state) updateLayout();
});
connect();
animate();
